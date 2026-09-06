"""
Standalone unittest runner for shared/auth.py
Runs with: python3 run_tests_stdlib.py
No external packages required — uses only stdlib unittest and unittest.mock
"""

import sys
import os
import uuid
import types
import unittest
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub out boto3 so shared/auth.py's lazy import of
#   from boto3.dynamodb.conditions import Key
# resolves without boto3 installed.
# The MagicMock employee tables in these tests never use the real Key object
# (their .query() is fully mocked), so a simple stub is sufficient.
# ---------------------------------------------------------------------------
if "boto3" not in sys.modules:
    boto3_stub = types.ModuleType("boto3")
    dynamodb_stub = types.ModuleType("boto3.dynamodb")
    conditions_stub = types.ModuleType("boto3.dynamodb.conditions")

    class _Key:
        """Minimal Key stub — produces a sentinel dict that MagicMock ignores."""
        def __init__(self, name):
            self._name = name
        def eq(self, value):
            return {"KeyConditionExpression": f"{self._name} = {value!r}"}

    conditions_stub.Key = _Key
    dynamodb_stub.conditions = conditions_stub
    boto3_stub.dynamodb = dynamodb_stub
    boto3_stub.resource = MagicMock()
    boto3_stub.client = MagicMock()

    sys.modules["boto3"] = boto3_stub
    sys.modules["boto3.dynamodb"] = dynamodb_stub
    sys.modules["boto3.dynamodb.conditions"] = conditions_stub

# Add backend/ to path so we can import shared and handlers
sys.path.insert(0, os.path.dirname(__file__))

from shared.auth import checkAccess, AccessDeniedError  # noqa: E402
from shared.tests.test_handlers import (  # noqa: E402
    TestUploadHandler,
    TestListFilesHandler,
    TestDownloadHandler,
    TestDeleteHandler,
    TestUpdateTagsHandler,
    TestVersionHistoryHandler,
    TestActivityHandler,
)


def make_caller(employee_id, groups):
    return {
        "sub": f"sub-{employee_id}",
        "custom:employee_id": employee_id,
        "email": f"{employee_id.lower()}@example.com",
        "cognito:groups": " ".join(groups),
    }


def make_employees_table(direct_reports=None):
    table = MagicMock()
    items = [{"employee_id": e} for e in (direct_reports or [])]
    table.query.return_value = {"Items": items}
    return table


def make_audit_table():
    return MagicMock()


class TestHRAdmin(unittest.TestCase):
    def test_access_own(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        checkAccess(caller, "EMP-HR1", make_employees_table(), make_audit_table())

    def test_access_any(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        emp = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-99999", emp, audit)
        emp.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_access_another_manager(self):
        caller = make_caller("EMP-HR1", ["HR_Admin"])
        checkAccess(caller, "EMP-MGR1", make_employees_table(), make_audit_table())


class TestManager(unittest.TestCase):
    def test_access_self(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        emp = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-MGR1", emp, audit)
        emp.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_access_direct_report(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        emp = make_employees_table(direct_reports=["EMP-001", "EMP-002"])
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", emp, audit)
        emp.query.assert_called_once()
        audit.put_item.assert_not_called()

    def test_access_non_report_denied(self):
        caller = make_caller("EMP-MGR1", ["Manager"])
        emp = make_employees_table(direct_reports=["EMP-001", "EMP-002"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError) as ctx:
            checkAccess(caller, "EMP-999", emp, audit)
        self.assertEqual(ctx.exception.caller_id, "EMP-MGR1")
        self.assertEqual(ctx.exception.target_id, "EMP-999")
        audit.put_item.assert_called_once()
        item = audit.put_item.call_args[1]["Item"]
        self.assertEqual(item["action"], "ACCESS_DENIED")
        self.assertEqual(item["result"], "DENIED")
        self.assertEqual(item["caller_user_id"], "EMP-MGR1")
        self.assertEqual(item["target_employee_id"], "EMP-999")

    def test_empty_direct_reports_denied(self):
        caller = make_caller("EMP-MGR2", ["Manager"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-001", make_employees_table([]), audit)
        audit.put_item.assert_called_once()


class TestEmployee(unittest.TestCase):
    def test_access_self(self):
        caller = make_caller("EMP-001", ["Employee"])
        emp = make_employees_table()
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", emp, audit)
        emp.query.assert_not_called()
        audit.put_item.assert_not_called()

    def test_access_other_denied(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError) as ctx:
            checkAccess(caller, "EMP-002", make_employees_table(), audit)
        self.assertEqual(ctx.exception.caller_id, "EMP-001")
        self.assertEqual(ctx.exception.target_id, "EMP-002")
        audit.put_item.assert_called_once()
        item = audit.put_item.call_args[1]["Item"]
        self.assertEqual(item["action"], "ACCESS_DENIED")
        self.assertEqual(item["result"], "DENIED")

    def test_access_manager_denied(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-MGR1", make_employees_table(), audit)
        audit.put_item.assert_called_once()


class TestNoGroup(unittest.TestCase):
    def test_no_group_denied(self):
        caller = make_caller("EMP-001", [])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-001", make_employees_table(), audit)
        audit.put_item.assert_called_once()

    def test_unknown_group_denied(self):
        caller = make_caller("EMP-001", ["SuperUser"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-001", make_employees_table(), audit)
        audit.put_item.assert_called_once()


class TestAuditRecord(unittest.TestCase):
    def test_required_fields(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-002", make_employees_table(), audit)
        item = audit.put_item.call_args[1]["Item"]
        required = {"log_id", "timestamp", "action", "result", "caller_user_id", "target_employee_id", "reason", "cognito_sub"}
        self.assertTrue(required.issubset(item.keys()), f"Missing: {required - item.keys()}")

    def test_log_id_is_uuid(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-002", make_employees_table(), audit)
        item = audit.put_item.call_args[1]["Item"]
        parsed = uuid.UUID(item["log_id"])
        self.assertEqual(str(parsed), item["log_id"])

    def test_timestamp_positive_int(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-002", make_employees_table(), audit)
        item = audit.put_item.call_args[1]["Item"]
        self.assertIsInstance(item["timestamp"], int)
        self.assertGreater(item["timestamp"], 0)


class TestAuditWriteFailure(unittest.TestCase):
    def test_denial_raised_even_if_audit_fails(self):
        caller = make_caller("EMP-001", ["Employee"])
        audit = make_audit_table()
        audit.put_item.side_effect = Exception("DynamoDB unavailable")
        with self.assertRaises(AccessDeniedError):
            checkAccess(caller, "EMP-002", make_employees_table(), audit)


class TestGroupFormats(unittest.TestCase):
    def test_groups_as_list(self):
        caller = {
            "sub": "sub-emp",
            "custom:employee_id": "EMP-001",
            "cognito:groups": ["Employee"],
        }
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", make_employees_table(), audit)
        audit.put_item.assert_not_called()

    def test_groups_as_space_string(self):
        caller = {
            "sub": "sub-mgr",
            "custom:employee_id": "EMP-MGR1",
            "cognito:groups": "Manager Employee",
        }
        emp = make_employees_table(direct_reports=["EMP-001"])
        audit = make_audit_table()
        checkAccess(caller, "EMP-001", emp, audit)
        audit.put_item.assert_not_called()


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in [TestHRAdmin, TestManager, TestEmployee, TestNoGroup,
                TestAuditRecord, TestAuditWriteFailure, TestGroupFormats,
                TestUploadHandler, TestListFilesHandler, TestDownloadHandler, TestDeleteHandler,
                TestUpdateTagsHandler, TestVersionHistoryHandler, TestActivityHandler]:
        suite.addTests(loader.loadTestsFromTestCase(cls))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
