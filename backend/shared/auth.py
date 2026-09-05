"""
shared/auth.py — Centralized authorization helper for Employee Document Vault (Phase 2)

Usage (Phase 3 handlers will call this):

    from shared.auth import checkAccess, AccessDeniedError

    def handler(event, context):
        caller = event["requestContext"]["authorizer"]["claims"]
        target_employee_id = event["pathParameters"]["employee_id"]
        employees_table = boto3.resource("dynamodb").Table(os.environ["EMPLOYEES_TABLE"])
        audit_table = boto3.resource("dynamodb").Table(os.environ["AUDIT_LOG_TABLE"])

        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError:
            return {"statusCode": 403, "body": json.dumps({"error": "Forbidden"})}

Authorization matrix
--------------------
| Cognito group | Allowed target_employee_id values          |
|---------------|--------------------------------------------|\n| HR_Admin      | any                                        |
| Manager       | caller's own employee_id                   |
|               | + employee_ids whose manager_id == caller  |
| Employee      | caller's own employee_id only              |

On denial:
- An ACCESS_DENIED audit event is written to the AuditLog table
  with action="ACCESS_DENIED" and result="DENIED".
- AccessDeniedError is raised (maps to HTTP 403 at the handler layer).
"""

import time
import uuid
import logging
from typing import Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Custom exception — handlers convert this to HTTP 403
# ---------------------------------------------------------------------------

class AccessDeniedError(Exception):
    """
    Raised by checkAccess() when the caller is not permitted to access
    the requested employee's documents.

    Handlers should catch this and return:
        {"statusCode": 403, "body": json.dumps({"error": "Forbidden"})}
    """
    def __init__(self, caller_id: str, target_id: str, reason: str = ""):
        self.caller_id = caller_id
        self.target_id = target_id
        self.reason = reason
        super().__init__(
            f"Access denied: caller={caller_id} target={target_id} reason={reason}"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def checkAccess(
    caller: dict,
    target_employee_id: str,
    employees_table: Any,
    audit_table: Any,
) -> None:
    """
    Enforce role-based access control for the Employee Document Vault.

    Parameters
    ----------
    caller : dict
        JWT claims dict from the Cognito authorizer, i.e.
        event["requestContext"]["authorizer"]["claims"].
        Expected keys:
          - "cognito:groups"     — space-separated group string, or a list
          - "custom:employee_id" — caller's employee_id (set at user creation)
          - "sub"               — Cognito user sub (used as fallback identifier)

    target_employee_id : str
        The employee_id being requested (from the URL path or query param).

    employees_table : boto3 DynamoDB Table resource
        The Employees-<env> DynamoDB table resource.
        Used by Manager checks to query direct reports via manager_id-index.

    audit_table : boto3 DynamoDB Table resource
        The AuditLog-<env> DynamoDB table resource.
        Receives ACCESS_DENIED events (action="ACCESS_DENIED", result="DENIED")
        on every authorization denial.

    Raises
    ------
    AccessDeniedError
        If the caller is not permitted to access target_employee_id.
        An ACCESS_DENIED audit record is written before raising.

    Returns
    -------
    None
        Returns normally (no exception) when access is granted.
    """
    caller_employee_id = _get_caller_employee_id(caller)
    groups = _get_caller_groups(caller)

    logger.info(
        "checkAccess: caller=%s target=%s groups=%s",
        caller_employee_id,
        target_employee_id,
        groups,
    )

    # --- HR_Admin: unrestricted ---
    if "HR_Admin" in groups:
        logger.info("checkAccess: GRANTED (HR_Admin)")
        return

    # --- Manager: self + direct reports ---
    if "Manager" in groups:
        if caller_employee_id == target_employee_id:
            logger.info("checkAccess: GRANTED (Manager — self)")
            return
        if _is_direct_report(caller_employee_id, target_employee_id, employees_table):
            logger.info("checkAccess: GRANTED (Manager — direct report)")
            return
        _deny(caller, caller_employee_id, target_employee_id, audit_table,
              reason="Manager accessing non-direct-report")

    # --- Employee: self only ---
    if "Employee" in groups:
        if caller_employee_id == target_employee_id:
            logger.info("checkAccess: GRANTED (Employee — self)")
            return
        _deny(caller, caller_employee_id, target_employee_id, audit_table,
              reason="Employee accessing another employee's documents")

    # --- No recognised group (deny by default) ---
    _deny(caller, caller_employee_id, target_employee_id, audit_table,
          reason="Caller has no recognised Cognito group")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_caller_employee_id(caller: dict) -> str:
    """
    Extract the caller's employee_id from JWT claims.

    Cognito passes custom attributes as "custom:employee_id" in claims.
    Falls back to the Cognito sub if the custom attribute is not set.
    """
    emp_id = caller.get("custom:employee_id") or caller.get("sub", "UNKNOWN")
    return emp_id


def _get_caller_groups(caller: dict) -> list:
    """
    Extract Cognito group membership from JWT claims.

    API Gateway passes groups as a space-separated string in
    "cognito:groups".  This helper normalises it to a list.
    """
    raw = caller.get("cognito:groups", "")
    if isinstance(raw, list):
        return raw
    # Space-separated string (API Gateway Cognito authorizer format)
    return [g.strip() for g in raw.split() if g.strip()]


def _is_direct_report(
    manager_employee_id: str,
    target_employee_id: str,
    employees_table: Any,
) -> bool:
    """
    Return True if target_employee_id has manager_id == manager_employee_id
    in the Employees table.

    Uses the manager_id-index GSI for an efficient O(direct_reports) query.
    """
    # Lazy import: boto3 is available in the Lambda runtime;
    # importing here avoids the dependency at module load time,
    # which keeps unit tests runnable without boto3 installed.
    from boto3.dynamodb.conditions import Key  # noqa: PLC0415

    response = employees_table.query(
        IndexName="manager_id-index",
        KeyConditionExpression=Key("manager_id").eq(manager_employee_id),
        ProjectionExpression="employee_id",
    )
    direct_report_ids = {item["employee_id"] for item in response.get("Items", [])}
    return target_employee_id in direct_report_ids


def _deny(
    caller: dict,
    caller_employee_id: str,
    target_employee_id: str,
    audit_table: Any,
    reason: str,
) -> None:
    """
    Write an ACCESS_DENIED audit record and raise AccessDeniedError.

    This is the single place where all authorization denials are recorded,
    ensuring no denial escapes the audit log.
    """
    _write_audit_denied(caller, caller_employee_id, target_employee_id,
                        audit_table, reason)
    raise AccessDeniedError(caller_employee_id, target_employee_id, reason)


def _write_audit_denied(
    caller: dict,
    caller_employee_id: str,
    target_employee_id: str,
    audit_table: Any,
    reason: str,
) -> None:
    """
    Append an ACCESS_DENIED event to the AuditLog DynamoDB table.

    Follows the project AuditLog schema.  Non-key attributes written here:
      log_id             — UUID (partition key)
      timestamp          — Unix epoch milliseconds (sort key)
      action             — "ACCESS_DENIED"   (project specification term)
      result             — "DENIED"          (project specification term)
      caller_user_id     — employee_id of the caller making the request
      target_employee_id — employee_id that was requested
      reason             — human-readable denial reason (not returned to client)
      cognito_sub        — caller's Cognito sub (for correlation)
    """
    now_ms = int(time.time() * 1000)
    item = {
        "log_id": str(uuid.uuid4()),
        "timestamp": now_ms,
        "action": "ACCESS_DENIED",
        "result": "DENIED",
        "caller_user_id": caller_employee_id,
        "target_employee_id": target_employee_id,
        "reason": reason,
        "cognito_sub": caller.get("sub", "UNKNOWN"),
    }
    try:
        audit_table.put_item(Item=item)
        logger.info(
            "Audit ACCESS_DENIED written: actor=%s target=%s",
            caller_employee_id,
            target_employee_id,
        )
    except Exception as exc:  # noqa: BLE001
        # Log but do not suppress — the denial must still be raised even if
        # the audit write fails (fail-open on audit, fail-closed on access).
        logger.error("Failed to write ACCESS_DENIED audit record: %s", exc)
