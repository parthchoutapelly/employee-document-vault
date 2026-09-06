"""
handlers/tags.py — PATCH /files/{doc_id} handler for Employee Document Vault
Updates document tags with validation, RBAC enforcement, and audit logging.
"""

import os
import time
import json
import logging
from typing import Any, Dict, Optional, List
import boto3

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
from shared.errors import success, bad_request, unauthorized, forbidden, not_found, internal_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_TAGS_PER_DOC = 5
MAX_TAG_LENGTH = 30


def validate_and_sanitize_tags(raw_tags: Any) -> List[str]:
    """
    Validate and sanitize the tags list.
    Rules:
      - Must be a list of strings
      - At most 5 tags
      - Each tag string max 30 chars, min 1 char (trimmed)
      - Trim whitespace
      - Reject control characters or newlines
      - Prevent duplicate tags (case-insensitive deduplication, preserving first casing)
    """
    if not isinstance(raw_tags, list):
        raise ValueError("tags must be a list of strings")

    if len(raw_tags) > MAX_TAGS_PER_DOC:
        raise ValueError(f"Maximum {MAX_TAGS_PER_DOC} tags permitted per document")

    seen_lower = set()
    sanitized: List[str] = []

    for tag in raw_tags:
        if not isinstance(tag, str):
            raise ValueError("Each tag must be a string")

        trimmed = tag.strip()
        if not trimmed:
            raise ValueError("Tag cannot be empty or whitespace only")

        if len(trimmed) > MAX_TAG_LENGTH:
            raise ValueError(f"Tag exceeds maximum length of {MAX_TAG_LENGTH} characters: '{trimmed[:15]}...'")

        # Reject control characters
        if any(ord(c) < 32 for c in trimmed):
            raise ValueError("Tag contains invalid control characters")

        lower = trimmed.lower()
        if lower in seen_lower:
            # Skip duplicate tags gracefully
            continue

        seen_lower.add(lower)
        sanitized.append(trimmed)

    return sanitized


def _get_resources() -> Dict[str, Any]:
    dynamodb = boto3.resource("dynamodb")
    return {
        "documents_table": dynamodb.Table(os.environ["DOCUMENTS_TABLE"]),
        "employees_table": dynamodb.Table(os.environ["EMPLOYEES_TABLE"]),
        "audit_table": dynamodb.Table(os.environ["AUDIT_LOG_TABLE"]),
    }


def handler(event: Dict[str, Any], context: Any, resources: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Handle PATCH /files/{doc_id}:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Extract doc_id from path parameters.
    3. Parse and validate tags from request body.
    4. Fetch document metadata from DocumentsTable.
    5. Authorize caller for document's employee_id via checkAccess().
    6. Update tags attribute in DocumentsTable.
    7. Audit log TAGS_UPDATED.
    8. Return updated tags and document_id.
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

        # 3. Parse and validate request body
        body_raw = event.get("body")
        if not body_raw:
            return bad_request("Request body is required")

        if isinstance(body_raw, str):
            try:
                body = json.loads(body_raw)
            except json.JSONDecodeError:
                return bad_request("Request body must be valid JSON")
        elif isinstance(body_raw, dict):
            body = body_raw
        else:
            return bad_request("Invalid request body")

        if "tags" not in body:
            return bad_request("'tags' field is required in request body")

        try:
            sanitized_tags = validate_and_sanitize_tags(body["tags"])
        except ValueError as val_err:
            return bad_request(str(val_err))

        # 4. Resources
        res = resources or _get_resources()
        employees_table = res["employees_table"]
        audit_table = res["audit_table"]
        documents_table = res["documents_table"]

        # 5. Fetch document metadata
        resp = documents_table.get_item(Key={"document_id": doc_id})
        item = resp.get("Item")
        if not item or item.get("status") == "DELETED":
            return not_found("Document not found")

        target_employee_id = item.get("employee_id")
        if not target_employee_id:
            logger.error("Corrupt document metadata for doc_id=%s: missing employee_id", doc_id)
            return internal_error("Document metadata is invalid")

        # 6. Authorization
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("Tag update access denied for doc_id=%s: %s", doc_id, ade)
            return forbidden("You are not authorized to modify tags for this document")

        # 7. Update tags in DynamoDB
        now_ms = int(time.time() * 1000)
        documents_table.update_item(
            Key={"document_id": doc_id},
            UpdateExpression="SET #t = :tags, updated_at = :up_at, updated_by = :up_by",
            ExpressionAttributeNames={"#t": "tags"},
            ExpressionAttributeValues={
                ":tags": sanitized_tags,
                ":up_at": now_ms,
                ":up_by": caller_employee_id,
            },
        )

        # 8. Audit Log
        write_audit_log(
            audit_table=audit_table,
            action="TAGS_UPDATED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=f"document_id={doc_id}",
            cognito_sub=caller.get("sub", "UNKNOWN"),
            extra={"tags": sanitized_tags},
        )

        return success({
            "message": "Tags updated successfully",
            "document_id": doc_id,
            "tags": sanitized_tags,
        })

    except Exception as exc:
        logger.error("Unexpected error in update tags handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while updating tags")
