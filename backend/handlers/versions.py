"""
handlers/versions.py — GET /files/{doc_id}/versions handler for Employee Document Vault
Retrieves real S3 object version history with RBAC enforcement and audit logging.
"""

import os
import logging
from typing import Any, Dict, Optional, List
import boto3

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
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
    Handle GET /files/{doc_id}/versions:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Extract doc_id from path parameters.
    3. Look up document metadata from DocumentsTable to obtain s3_key and employee_id.
    4. Authorize caller via checkAccess().
    5. Call S3 ListObjectVersions for the document's s3_key.
    6. Transform and sort versions and delete markers.
    7. Audit log VERSIONS_LISTED.
    8. Return structured version history.
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
        if not item:
            return not_found("Document not found")

        target_employee_id = item.get("employee_id")
        s3_key = item.get("s3_key")
        if not target_employee_id or not s3_key:
            logger.error("Corrupt document metadata for doc_id=%s: missing employee_id or s3_key", doc_id)
            return internal_error("Document metadata is invalid")

        # 5. Access Control
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("Version history access denied for doc_id=%s: %s", doc_id, ade)
            return forbidden("You are not authorized to view versions for this document")

        # 6. Retrieve versions from S3 ListObjectVersions
        try:
            s3_resp = s3_client.list_object_versions(Bucket=bucket, Prefix=s3_key)
        except Exception as s3_err:
            logger.error("S3 ListObjectVersions failed for key=%s: %s", s3_key, s3_err)
            return internal_error("Failed to retrieve version history from storage")

        raw_versions = s3_resp.get("Versions", [])
        raw_delete_markers = s3_resp.get("DeleteMarkers", [])

        versions_list: List[Dict[str, Any]] = []

        # Process active versions
        for v in raw_versions:
            if v.get("Key") == s3_key:
                lm = v.get("LastModified")
                iso_time = lm.isoformat() if hasattr(lm, "isoformat") else str(lm) if lm else None
                versions_list.append({
                    "version_id": v.get("VersionId") or "null",
                    "last_modified": iso_time,
                    "is_latest": bool(v.get("IsLatest", False)),
                    "is_delete_marker": False,
                    "size": int(v.get("Size", 0)),
                })

        # Process delete markers
        for dm in raw_delete_markers:
            if dm.get("Key") == s3_key:
                lm = dm.get("LastModified")
                iso_time = lm.isoformat() if hasattr(lm, "isoformat") else str(lm) if lm else None
                versions_list.append({
                    "version_id": dm.get("VersionId") or "null",
                    "last_modified": iso_time,
                    "is_latest": bool(dm.get("IsLatest", False)),
                    "is_delete_marker": True,
                    "size": 0,
                })

        # Sort descending by last_modified (newest first)
        versions_list.sort(key=lambda x: x.get("last_modified") or "", reverse=True)

        # 7. Audit Log
        write_audit_log(
            audit_table=audit_table,
            action="VERSIONS_LISTED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=f"document_id={doc_id} count={len(versions_list)}",
            cognito_sub=caller.get("sub", "UNKNOWN"),
        )

        return success({
            "document_id": doc_id,
            "filename": item.get("filename", ""),
            "s3_key": s3_key,
            "versions": versions_list,
            "count": len(versions_list),
        })

    except Exception as exc:
        logger.error("Unexpected error in versions handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while retrieving version history")
