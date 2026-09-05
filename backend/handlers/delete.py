"""
handlers/delete.py — DELETE /files/{doc_id} handler for Employee Document Vault
"""

import os
import time
import logging
from typing import Any, Dict, Optional
import boto3

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
from shared.s3 import delete_s3_object
from shared.errors import success, bad_request, unauthorized, forbidden, not_found, internal_error

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
    Handle DELETE /files/{doc_id}:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Extract doc_id from path parameters.
    3. Look up document metadata from DocumentsTable.
    4. Authorize caller for document's employee_id via checkAccess().
    5. Delete S3 object preserving versioning (creates S3 delete marker).
    6. Delete document metadata record from DocumentsTable.
    7. Audit log FILE_DELETED.
    """
    try:
        # 1. Authentication
        caller = event.get("requestContext", {}).get("authorizer", {}).get("claims")
        if not caller or not isinstance(caller, dict):
            return unauthorized("Missing or invalid authentication token")

        caller_employee_id = caller.get("custom:employee_id", caller.get("sub", "UNKNOWN"))

        # 2. Extract doc_id
        path_params = event.get("pathParameters") or {}
        doc_id = path_params.get("doc_id")
        if not doc_id or not isinstance(doc_id, str) or not doc_id.strip():
            return bad_request("doc_id path parameter is required")

        doc_id = doc_id.strip()

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

        target_employee_id = item.get("employee_id")
        s3_key = item.get("s3_key")
        if not target_employee_id or not s3_key:
            logger.error("Corrupt document metadata for doc_id=%s: missing employee_id or s3_key", doc_id)
            return internal_error("Document metadata is invalid")

        # 5. Authorization
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("Delete access denied for doc_id=%s: %s", doc_id, ade)
            return forbidden("You are not authorized to delete this document")

        # 6. S3 Delete (version-safe: creates a delete marker, does not purge versions)
        try:
            s3_resp = delete_s3_object(s3_client=s3_client, bucket=bucket, key=s3_key)
        except Exception as s3_err:
            logger.error("S3 delete failed for key=%s: %s", s3_key, s3_err)
            return internal_error("Failed to delete document from storage")

        # 7. DynamoDB Metadata Soft Delete (preserves metadata and S3 version history)
        now_ms = int(time.time() * 1000)
        delete_marker_version_id = s3_resp.get("VersionId", "NONE") if isinstance(s3_resp, dict) else "NONE"
        documents_table.update_item(
            Key={"document_id": doc_id},
            UpdateExpression="SET #s = :status, deleted_at = :del_at, deleted_by = :del_by, delete_marker_version_id = :ver",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":status": "DELETED",
                ":del_at": now_ms,
                ":del_by": caller_employee_id,
                ":ver": delete_marker_version_id,
            },
        )

        # 8. Audit Log
        write_audit_log(
            audit_table=audit_table,
            action="FILE_DELETED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=f"document_id={doc_id}",
            cognito_sub=caller.get("sub", "UNKNOWN"),
        )

        return success({
            "message": "Document deleted successfully",
            "document_id": doc_id,
        })

    except Exception as exc:
        logger.error("Unexpected error in delete handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while deleting the document")
