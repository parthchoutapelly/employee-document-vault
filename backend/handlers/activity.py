"""
handlers/activity.py — GET /activity handler for Employee Document Vault
"""

import os
import logging
from decimal import Decimal
from typing import Any, Dict, Optional, List, Set
import boto3

from shared.auth import _get_caller_employee_id, _get_caller_groups, _is_direct_report
from shared.errors import success, bad_request, unauthorized, forbidden, internal_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _convert_decimals(obj: Any) -> Any:
    """Convert DynamoDB Decimal types to standard int/float for JSON serialization."""
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _get_direct_report_ids(manager_employee_id: str, employees_table: Any) -> Set[str]:
    """Query manager_id-index GSI to retrieve all direct report employee IDs."""
    from boto3.dynamodb.conditions import Key  # noqa: PLC0415
    try:
        response = employees_table.query(
            IndexName="manager_id-index",
            KeyConditionExpression=Key("manager_id").eq(manager_employee_id),
            ProjectionExpression="employee_id",
        )
        return {item["employee_id"] for item in response.get("Items", []) if "employee_id" in item}
    except Exception as e:
        logger.warning("Failed to query direct reports for manager %s: %s", manager_employee_id, e)
        return set()


def _get_resources() -> Dict[str, Any]:
    dynamodb = boto3.resource("dynamodb")
    return {
        "employees_table": dynamodb.Table(os.environ["EMPLOYEES_TABLE"]),
        "audit_table": dynamodb.Table(os.environ["AUDIT_LOG_TABLE"]),
    }


def handler(event: Dict[str, Any], context: Any, resources: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Handle GET /activity:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Enforce RBAC filtering on audit log entries:
       - HR_Admin: unrestricted access to all audit records.
       - Manager: records pertaining to self and direct reports.
       - Employee: records where caller or target matches caller's employee_id.
    3. Exclude sensitive internal data and return sanitized activity timeline.
    """
    try:
        # 1. Authentication
        caller = event.get("requestContext", {}).get("authorizer", {}).get("claims")
        if not caller or not isinstance(caller, dict):
            return unauthorized("Missing or invalid authentication token")

        caller_employee_id = _get_caller_employee_id(caller)
        groups = _get_caller_groups(caller)

        if not any(g in ("HR_Admin", "Manager", "Employee") for g in groups):
            return forbidden("Caller has no recognised role for viewing activity")

        # 2. Resources
        res = resources or _get_resources()
        employees_table = res["employees_table"]
        audit_table = res["audit_table"]

        # 3. Query parameters
        qs = event.get("queryStringParameters") or {}
        target_employee_id = qs.get("employee_id")

        try:
            limit = min(int(qs.get("limit", 50)), 100)
            if limit <= 0:
                limit = 50
        except (ValueError, TypeError):
            limit = 50

        # 4. RBAC Validation when target_employee_id is explicitly provided
        if target_employee_id:
            if "HR_Admin" in groups:
                pass  # Unrestricted
            elif "Manager" in groups:
                if target_employee_id != caller_employee_id and not _is_direct_report(caller_employee_id, target_employee_id, employees_table):
                    return forbidden("You are not authorized to view activity for this employee")
            elif "Employee" in groups:
                if target_employee_id != caller_employee_id:
                    return forbidden("You are not authorized to view activity for this employee")

        # 5. Fetch and Filter Audit Records
        scan_kwargs = {}
        try:
            resp = audit_table.scan(**scan_kwargs)
            raw_items: List[Dict[str, Any]] = resp.get("Items", [])
        except Exception as scan_err:
            logger.error("Failed to scan audit table: %s", scan_err)
            return internal_error("Failed to retrieve activity log")

        # Compute allowed identity set
        direct_report_ids: Set[str] = set()
        if "Manager" in groups:
            direct_report_ids = _get_direct_report_ids(caller_employee_id, employees_table)

        allowed_ids: Set[str] = {caller_employee_id} | direct_report_ids

        filtered_items: List[Dict[str, Any]] = []
        for raw in raw_items:
            caller_uid = raw.get("caller_user_id", "")
            target_uid = raw.get("target_employee_id", "")

            # Check authorization for this record
            is_authorized = False
            if target_employee_id:
                if caller_uid == target_employee_id or target_uid == target_employee_id:
                    is_authorized = True
            elif "HR_Admin" in groups:
                is_authorized = True
            elif "Manager" in groups:
                if caller_uid in allowed_ids or target_uid in allowed_ids:
                    is_authorized = True
            elif "Employee" in groups:
                if caller_uid == caller_employee_id or target_uid == caller_employee_id:
                    is_authorized = True

            if not is_authorized:
                continue

            # Sanitize fields (never expose JWTs, presigned URLs, passwords, or secrets)
            item = {
                "log_id": str(raw.get("log_id", "")),
                "timestamp": raw.get("timestamp", 0),
                "action": str(raw.get("action", "UNKNOWN")),
                "result": str(raw.get("result", "UNKNOWN")),
                "caller_user_id": str(caller_uid),
                "target_employee_id": str(target_uid),
                "reason": str(raw.get("reason", "")),
            }
            if "filename" in raw:
                item["filename"] = str(raw["filename"])
            if "document_type" in raw:
                item["document_type"] = str(raw["document_type"])
            if "document_id" in raw:
                item["document_id"] = str(raw["document_id"])

            filtered_items.append(_convert_decimals(item))

        # Sort descending by timestamp (newest first)
        filtered_items.sort(key=lambda x: int(x.get("timestamp") or 0), reverse=True)
        paginated_items = filtered_items[:limit]

        return success({
            "activity": paginated_items,
            "events": paginated_items,
            "count": len(paginated_items),
            "total_available": len(filtered_items),
        })

    except Exception as exc:  # noqa: BLE001
        logger.error("Unhandled exception in GET /activity handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while retrieving activity")
