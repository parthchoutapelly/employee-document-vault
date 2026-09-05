"""
Unit tests for shared/auth.py

Run with:
    cd backend
    python -m pytest shared/tests/test_auth.py -v

All tests are fully offline — no AWS credentials or network access required.
boto3 DynamoDB calls are replaced by unittest.mock objects.
"""

import sys
import os
import uuid
import types
import pytest
from unittest.mock import MagicMock, patch, call

# Allow importing shared package from the backend/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# ---------------------------------------------------------------------------
# Stub out boto3 so shared/auth.py's lazy import of
#   from boto3.dynamodb.conditions import Key
# resolves without boto3 installed.  The MagicMock DynamoDB tables in these
# tests never use the real Key object (their .query() is fully mocked).
# ---------------------------------------------------------------------------
if "boto3" not in sys.modules:
    boto3_stub = types.ModuleType("boto3")
    dynamodb_stub = types.ModuleType("boto3.dynamodb")
    conditions_stub = types.ModuleType("boto3.dynamodb.conditions")

    class _Key:
        """Minimal Key stub — produces a sentinel that MagicMock ignores."""
        def __init__(self, name):
            self._name = name
        def eq(self, value):
            return {"KeyConditionExpression": f"{self._name} = {value!r}"}

    conditions_stub.Key = _Key
    dynamodb_stub.conditions = conditions_stub
    boto3_stub.dynamodb = dynamodb_stub
    sys.modules["boto3"] = boto3_stub
    sys.modules["boto3.dynamodb"] = dynamodb_stub
    sys.modules["boto3.dynamodb.conditions"] = conditions_stub

from shared.auth import checkAccess, AccessDeniedError  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers for building test fixtures
# ---------------------------------------------------------------------------

def make_caller(employee_id: str, groups: list) -> dict:
    """Build a minimal set of Cognito JWT claims for a test caller."""
    return {
        "sub": f"sub-{employee_id}",
        "custom:employee_id": employee_id,
        "email": f"{employee_id.lower()}@example.com",
        # API Gateway passes groups as a space-separated string
        "cognito:groups": " ".join(groups),
    }


def make_employees_table(direct_reports: list = None) -> MagicMock:
    """
    Return a mock DynamoDB Table whose manager_id-index GSI returns
    the given list of employee_id strings when queried.
    """
    table = MagicMock()
    items = [{"employee_id": emp_id} for emp_id in (direct_reports or [])]
    table.query.return_value = {"Items": items}
    return table


def make_audit_table() -> MagicMock:
    """Return a mock AuditLog DynamoDB Table."""
    return MagicMock()


# ---------------------------------------------------------------------------
# HR_Admin tests
# ---------------------------------------------------------------------------

class TestHRAdmin:
    """HR_Admin may access any employee's documents without restriction."""

    def test_hr_admin_access_own(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        employees = make_employees_table()
        audit = make_audit_table()
        # Should not raise
        checkAccess(caller, "EMP-HR1", employees, audit)
        audit.put_item.assert_not_called()

    def test_hr_admin_access_any_employee(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        employees = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-99999", employees, audit)
        # No denial: employees table not queried, no audit write
        employees.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_hr_admin_access_another_manager(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        employees = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-MGR1", employees, audit)
        audit.put_item.assert_not_called()


# ---------------------------------------------------------------------------
# Manager tests
# ---------------------------------------------------------------------------

class TestManager:
    """Manager may access self + direct reports; all others are denied."""

    def test_manager_access_self(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        employees = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-MGR1", employees, audit)
        # Self-check short-circuits before DynamoDB query
        employees.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_manager_access_direct_report(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        # EMP-001 is a direct report of EMP-MGR1
        employees = make_employees_table(direct_reports=["EMP-001", "EMP-002"])
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", employees, audit)
        employees.query.assert_called_once()
        audit.put_item.assert_not_called()

    def test_manager_access_non_direct_report_denied(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        # EMP-999 is NOT a direct report of EMP-MGR1
        employees = make_employees_table(direct_reports=["EMP-001", "EMP-002"])
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError) as exc_info:
            checkAccess(caller, "EMP-999", employees, audit)
        assert exc_info.value.caller_id == "EMP-MGR1"
        assert exc_info.value.target_id == "EMP-999"
        # Audit record must have been written with correct project terminology
        audit.put_item.assert_called_once()
        audit_item = audit.put_item.call_args[1]["Item"]
        assert audit_item["action"] == "ACCESS_DENIED"
        assert audit_item["result"] == "DENIED"
        assert audit_item["caller_user_id"] == "EMP-MGR1"
        assert audit_item["target_employee_id"] == "EMP-999"

    def test_manager_access_empty_direct_reports_denied(self):
        """Manager with no direct reports cannot access other employees."""
        caller = make_caller("EMP-MGR2", ["Manager"])
        employees = make_employees_table(direct_reports=[])
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-001", employees, audit)
        audit.put_item.assert_called_once()


# ---------------------------------------------------------------------------
# Employee tests
# ---------------------------------------------------------------------------

class TestEmployee:
    """Employee may only access their own documents."""

    def test_employee_access_self(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", employees, audit)
        employees.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_employee_access_other_denied(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError) as exc_info:
            checkAccess(caller, "EMP-002", employees, audit)
        assert exc_info.value.caller_id == "EMP-001"
        assert exc_info.value.target_id == "EMP-002"
        audit.put_item.assert_called_once()
        audit_item = audit.put_item.call_args[1]["Item"]
        assert audit_item["action"] == "ACCESS_DENIED"
        assert audit_item["result"] == "DENIED"
        assert audit_item["caller_user_id"] == "EMP-001"
        assert audit_item["target_employee_id"] == "EMP-002"

    def test_employee_access_manager_denied(self):
        """Employee cannot access a manager's documents."""
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-MGR1", employees, audit)
        audit.put_item.assert_called_once()


# ---------------------------------------------------------------------------
# No-group / unknown-group tests
# ---------------------------------------------------------------------------

class TestNoGroup:
    """Callers with no recognised group are always denied."""

    def test_no_group_denied(self):
        caller = make_caller("EMP-001", [])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-001", employees, audit)
        audit.put_item.assert_called_once()

    def test_unknown_group_denied(self):
        caller = make_caller("EMP-001", ["SuperUser"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-001", employees, audit)
        audit.put_item.assert_called_once()


# ---------------------------------------------------------------------------
# Audit record structure tests
# ---------------------------------------------------------------------------

class TestAuditRecord:
    """Verify that denial audit records contain all required fields."""

    def test_audit_record_has_required_fields(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-002", employees, audit)
        item = audit.put_item.call_args[1]["Item"]
        required_fields = {"log_id", "timestamp", "action", "result",
                           "caller_user_id", "target_employee_id",
                           "reason", "cognito_sub"}
        assert required_fields.issubset(item.keys()), (
            f"Missing fields: {required_fields - item.keys()}"
        )

    def test_audit_log_id_is_uuid(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-002", employees, audit)
        item = audit.put_item.call_args[1]["Item"]
        # Verify log_id is a valid UUID (will raise ValueError if not)
        parsed = uuid.UUID(item["log_id"])
        assert str(parsed) == item["log_id"]

    def test_audit_timestamp_is_positive_integer(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-002", employees, audit)
        item = audit.put_item.call_args[1]["Item"]
        assert isinstance(item["timestamp"], int)
        assert item["timestamp"] > 0


# ---------------------------------------------------------------------------
# Audit write failure — access still denied
# ---------------------------------------------------------------------------

class TestAuditWriteFailure:
    """
    If the audit write itself fails (e.g. DynamoDB unavailable), the denial
    must still be raised.  We fail-open on audit, fail-closed on access.
    """

    def test_denial_raised_even_if_audit_write_fails(self):
        caller = make_caller("EMP-001", ["Employee"])
        employees = make_employees_table()
        audit = make_audit_table()
        audit.put_item.side_effect = Exception("DynamoDB unavailable")
        with pytest.raises(AccessDeniedError):
            checkAccess(caller, "EMP-002", employees, audit)


# ---------------------------------------------------------------------------
# Group format — list vs space-separated string
# ---------------------------------------------------------------------------

class TestGroupFormats:
    """
    Cognito authorizer may pass groups as a list (in some frameworks) or as
    a space-separated string (API Gateway default).  Both must work.
    """

    def test_groups_as_list(self):
        caller = {
            "sub": "sub-emp",
            "custom:employee_id": "EMP-001",
            "cognito:groups": ["Employee"],  # list format
        }
        employees = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", employees, audit)
        audit.put_item.assert_not_called()

    def test_groups_as_space_separated_string(self):
        caller = {
            "sub": "sub-mgr",
            "custom:employee_id": "EMP-MGR1",
            "cognito:groups": "Manager Employee",  # unusual but handled
        }
        employees = make_employees_table(direct_reports=["EMP-001"])
        audit = make_audit_table()
        # Manager check runs first (higher precedence in checkAccess)
        checkAccess(caller, "EMP-001", employees, audit)
        audit.put_item.assert_not_called()
