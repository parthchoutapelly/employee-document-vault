"""
handlers/download.py — GET /download/{doc_id} handler for Employee Document Vault
"""

import os
import logging
from typing import Any, Dict, Optional
import boto3

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
from shared.s3 import generate_presigned_download_url
from shared.errors import success, bad_request, unauthorized, forbidden, not_found, conflict, internal_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _get_resources() -> Dict[str, Any]:
    dynamodb = boto3.resource("dynamodb")
    s3_client = boto3.client("s3")
    return {
        "documents_table": dynamodb.Table(os.environ["DOCUMENTS_TABLE"]),
        "employees_table": dynamodb.Table(os.environ["EMPLOYEES_TABLE"]),
        "audit_table": dynamodb.Table(os.environ["AUDIT_LOG_TABLE"]),
        "s3_client": s3_client,
        "bucket": os.environ["DOCUMENTS_BUCKET"],
    }


def handler(event: Dict[str, Any], context: Any, resources: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Handle GET /download/{doc_id}:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Extract doc_id from path parameters.
    3. Look up document metadata from DocumentsTable.
    4. Authorize caller for document's employee_id via checkAccess().
    5. Generate presigned S3 GET URL ONLY AFTER authorization succeeds.
    6. Audit log FILE_DOWNLOADED.
    """
    try:
        # 1. Authentication
        caller = event.get("requestContext", {}).get("authorizer", {}).get("claims")
        if not caller or not isinstance(caller, dict):
            return unauthorized("Missing or invalid authentication token")

        caller_employee_id = caller.get("custom:employee_id", caller.get("sub", "UNKNOWN"))

        # 2. Extract doc_id and optional version_id
        path_params = event.get("pathParameters") or {}
        doc_id = path_params.get("doc_id")
        if not doc_id or not isinstance(doc_id, str) or not doc_id.strip():
            return bad_request("doc_id path parameter is required")

        doc_id = doc_id.strip()

        query_params = event.get("queryStringParameters") or {}
        version_id = None
        if isinstance(query_params, dict):
            raw_version = query_params.get("version_id")
            if isinstance(raw_version, str) and raw_version.strip():
                version_id = raw_version.strip()

        # 3. Resources
        res = resources or _get_resources()
        employees_table = res["employees_table"]
        audit_table = res["audit_table"]
        documents_table = res["documents_table"]
        s3_client = res["s3_client"]
        bucket = res["bucket"]

        # 4. Fetch document metadata
        resp = documents_table.get_item(Key={"document_id": doc_id})
        item = resp.get("Item")
        if not item or item.get("status") == "DELETED":
            return not_found("Document not found")

        if item.get("status") == "PENDING_UPLOAD":
            return conflict("Document upload is pending and not yet available for download")

        target_employee_id = item.get("employee_id")
        s3_key = item.get("s3_key")
        if not target_employee_id or not s3_key:
            logger.error("Corrupt document metadata for doc_id=%s: missing employee_id or s3_key", doc_id)
            return internal_error("Document metadata is invalid")

        # 5. Authorization (MUST occur before generating presigned URL)
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("Download access denied for doc_id=%s: %s", doc_id, ade)
            return forbidden("You are not authorized to download this document")

        # 6. Generate presigned download URL
        filename = item.get("filename")
        download_url = generate_presigned_download_url(
            s3_client=s3_client,
            bucket=bucket,
            key=s3_key,
            expires_in=900,
            filename=filename,
            version_id=version_id,
        )

        # 7. Audit Log
        reason_str = f"document_id={doc_id}"
        if version_id:
            reason_str += f" version_id={version_id}"

        write_audit_log(
            audit_table=audit_table,
            action="FILE_DOWNLOADED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=reason_str,
            cognito_sub=caller.get("sub", "UNKNOWN"),
        )

        resp_payload: Dict[str, Any] = {
            "document_id": doc_id,
            "download_url": download_url,
            "filename": filename,
            "document_type": item.get("document_type"),
            "expires_in": 900,
        }
        if version_id:
            resp_payload["version_id"] = version_id

        return success(resp_payload)

    except Exception as exc:
        logger.error("Unexpected error in download handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while processing download request")
