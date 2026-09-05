"""
handlers/files.py — GET /files handler for Employee Document Vault
"""

import os
import logging
from decimal import Decimal
from typing import Any, Dict, Optional, List
import boto3
from boto3.dynamodb.conditions import Key

from shared.auth import checkAccess, AccessDeniedError
from shared.audit import write_audit_log
from shared.errors import success, bad_request, unauthorized, forbidden, internal_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _convert_decimals(obj: Any) -> Any:
    """Helper to convert DynamoDB Decimal types to standard int/float for JSON serialization."""
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _get_resources() -> Dict[str, Any]:
    dynamodb = boto3.resource("dynamodb")
    return {
        "documents_table": dynamodb.Table(os.environ["DOCUMENTS_TABLE"]),
        "employees_table": dynamodb.Table(os.environ["EMPLOYEES_TABLE"]),
        "audit_table": dynamodb.Table(os.environ["AUDIT_LOG_TABLE"]),
        "gsi_name": os.environ.get("DOCUMENTS_TABLE_GSI", "employee_id-index"),
    }


def handler(event: Dict[str, Any], context: Any, resources: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Handle GET /files:
    1. Authenticate caller claims from Cognito authorizer context.
    2. Determine target employee_id (from query parameter or defaulting to caller).
    3. Authorize caller for target employee via checkAccess().
    4. Query DocumentsTable via employee_id-index GSI.
    5. Audit log FILES_LISTED.
    """
    try:
        # 1. Authentication
        caller = event.get("requestContext", {}).get("authorizer", {}).get("claims")
        if not caller or not isinstance(caller, dict):
            return unauthorized("Missing or invalid authentication token")

        caller_employee_id = caller.get("custom:employee_id", caller.get("sub", "UNKNOWN"))

        # 2. Determine target employee ID
        qs = event.get("queryStringParameters") or {}
        target_employee_id = qs.get("employee_id") or caller.get("custom:employee_id")
        if not target_employee_id:
            return bad_request("employee_id is required")

        # 3. Resources
        res = resources or _get_resources()
        employees_table = res["employees_table"]
        audit_table = res["audit_table"]
        documents_table = res["documents_table"]
        gsi_name = res.get("gsi_name", "employee_id-index")

        # 4. Access Control
        try:
            checkAccess(caller, target_employee_id, employees_table, audit_table)
        except AccessDeniedError as ade:
            logger.warning("List files access denied: %s", ade)
            return forbidden("You are not authorized to view documents for this employee")

        # 5. Query Documents table using employee_id-index GSI
        query_params = {
            "IndexName": gsi_name,
            "KeyConditionExpression": Key("employee_id").eq(target_employee_id),
            "ScanIndexForward": False,  # Most recent first
        }
        resp = documents_table.query(**query_params)
        raw_items: List[Dict[str, Any]] = resp.get("Items", [])

        # Filter out logically deleted records and uncompleted/pending uploads
        active_items = [
            _convert_decimals(item)
            for item in raw_items
            if item.get("status") not in ("DELETED", "PENDING_UPLOAD")
        ]

        # 6. Audit Log
        write_audit_log(
            audit_table=audit_table,
            action="FILES_LISTED",
            result="SUCCESS",
            caller_user_id=caller_employee_id,
            target_employee_id=target_employee_id,
            reason=f"count={len(active_items)}",
            cognito_sub=caller.get("sub", "UNKNOWN"),
        )

        return success({
            "employee_id": target_employee_id,
            "documents": active_items,
            "count": len(active_items),
        })

    except Exception as exc:
        logger.error("Unexpected error in list files handler: %s", exc, exc_info=True)
        return internal_error("An unexpected error occurred while listing documents")
