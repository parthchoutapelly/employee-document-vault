"""
shared/audit.py — Shared audit log helpers for Employee Document Vault
"""

import time
import uuid
import logging
from typing import Any, Optional, Dict

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def write_audit_log(
    audit_table: Any,
    action: str,
    result: str,
    caller_user_id: str,
    target_employee_id: str,
    reason: str = "",
    cognito_sub: str = "UNKNOWN",
    extra: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Append an audit record to the AuditLog DynamoDB table.

    Follows the project AuditLog schema:
      log_id             — UUID string (partition key)
      timestamp          — Unix epoch milliseconds (sort key)
      action             — e.g., UPLOAD_REQUESTED, FILES_LISTED, FILE_DOWNLOADED, FILE_DELETED, ACCESS_DENIED
      result             — SUCCESS, DENIED, FAILED
      caller_user_id     — employee_id of caller (or sub if employee_id unset)
      target_employee_id — employee_id being acted upon
      reason             — human-readable description, document_id, or error reason
      cognito_sub        — Cognito sub claim for cross-correlation

    Returns the item dictionary written, or None if write failed.
    """
    now_ms = int(time.time() * 1000)
    item: Dict[str, Any] = {
        "log_id": str(uuid.uuid4()),
        "timestamp": now_ms,
        "action": action,
        "result": result,
        "caller_user_id": caller_user_id or "UNKNOWN",
        "target_employee_id": target_employee_id or "UNKNOWN",
        "reason": reason or "",
        "cognito_sub": cognito_sub or "UNKNOWN",
    }
    if extra:
        for k, v in extra.items():
            if k not in item and v is not None:
                item[k] = v

    try:
        audit_table.put_item(Item=item)
        logger.info(
            "Audit event recorded: action=%s result=%s caller=%s target=%s",
            action,
            result,
            caller_user_id,
            target_employee_id,
        )
        return item
    except Exception as exc:  # noqa: BLE001
        # Log failure but do not crash the business operation (fail-open on audit write)
        logger.error("Failed to write audit log (%s/%s): %s", action, result, exc)
        return None
