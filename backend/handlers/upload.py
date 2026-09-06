"""
handlers/upload.py — POST /upload handler for Employee Document Vault
"""

import os
import json
import uuid
import time
import logging
from typing import Any, Dict, Optional
import boto3

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
from shared.s3 import build_s3_key, generate_presigned_upload_url
from shared.errors import success, bad_request, unauthorized, forbidden, internal_error

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
        "kms_key_id": os.environ.get("KMS_KEY_ID"),
    }


def handler(event: Dict[str, Any], context: Any, resources: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Handle POST /upload:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Parse request body for filename and document_type (and optional target employee_id).
    3. Authorize caller for target employee via checkAccess().
    4. Generate presigned S3 PUT URL and store metadata in Documents table.
    5. Audit log UPLOAD_REQUESTED.
    """
    try:
        # 1. Authentication
        caller = event.get("requestContext", {}).get("authorizer", {}).get("claims")
        if not caller or not isinstance(caller, dict):
            return unauthorized("Missing or invalid authentication token")

        caller_employee_id = caller.get("custom:employee_id", caller.get("sub", "UNKNOWN"))

        # 2. Parse body
        body_raw = event.get("body")
        if not body_raw:
            return bad_request("Request body is required")

        try:
            body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
        except Exception:
            return bad_request("Request body must be valid JSON")

        if not isinstance(body, dict):
            return bad_request("Request body must be a JSON object")

        filename = body.get("filename")
        document_type = body.get("document_type")
        if not filename or not isinstance(filename, str) or not filename.strip():
            return bad_request("filename is required and must be a non-empty string")
        if not document_type or not isinstance(document_type, str) or not document_type.strip():
            return bad_request("document_type is required and must be a non-empty string")

        filename = filename.strip()
        document_type = document_type.strip()

        # Target employee defaults to caller if not specified
        target_employee_id = body.get("employee_id") or caller.get("custom:employee_id")
        if not target_employee_id:
            return bad_request("employee_id is required")

        # 3. Resources
        res = resources or _get_resources()
        employees_table = res["employees_table"]
        audit_table = res["audit_table"]
        documents_table = res["documents_table"]
        s3_client = res["s3_client"]
        bucket = res["bucket"]
        kms_key_id = res.get("kms_key_id")

        # 4. Access Control
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("Upload access denied: %s", ade)
            return forbidden("You are not authorized to upload documents for this employee")

        # 5. Build S3 key & metadata
        document_id = str(uuid.uuid4())
        s3_key = build_s3_key(target_employee_id, document_type, filename)
        upload_url = generate_presigned_upload_url(
            s3_client=s3_client,
            bucket=bucket,
            key=s3_key,
            expires_in=900,
            kms_key_id=kms_key_id,
        )

        now_ms = int(time.time() * 1000)
        doc_item = {
            "document_id": document_id,
            "employee_id": target_employee_id,
            "upload_timestamp": now_ms,
            "document_type": document_type,
            "filename": filename,
            "s3_key": s3_key,
            "uploaded_by": caller_employee_id,
            "status": "AVAILABLE",
        }
        documents_table.put_item(Item=doc_item)

        # 6. Audit Log
        write_audit_log(
            audit_table=audit_table,
            action="UPLOAD_REQUESTED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=f"document_id={document_id}",
            cognito_sub=caller.get("sub", "UNKNOWN"),
        )

        return success(
            {
                "document_id": document_id,
                "upload_url": upload_url,
                "s3_key": s3_key,
                "expires_in": 900,
            },
            status_code=201,
        )

    except Exception as exc:
        logger.error("Unexpected error in upload handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while processing the upload request")
