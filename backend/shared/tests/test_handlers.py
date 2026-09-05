"""
tests/test_handlers.py — Unit tests for Phase 3 Lambda handlers with mocked AWS resources
"""

import json
import unittest
from unittest.mock import MagicMock

from shared.auth import AccessDeniedError
from handlers.upload import handler as upload_handler
from handlers.files import handler as files_handler
from handlers.download import handler as download_handler
from handlers.delete import handler as delete_handler


def make_claims(employee_id: str, groups: list) -> dict:
    return {
        "sub": f"sub-{employee_id}",
        "custom:employee_id": employee_id,
        "email": f"{employee_id.lower()}@example.com",
        "cognito:groups": " ".join(groups),
    }


def make_mock_resources(direct_reports=None):
    """Create mock DynamoDB tables and S3 client for handler injection."""
    emp_table = MagicMock()
    reports = [{"employee_id": e} for e in (direct_reports or [])]
    emp_table.query.return_value = {"Items": reports}

    audit_table = MagicMock()
    docs_table = MagicMock()
    s3_client = MagicMock()
    s3_client.generate_presigned_url.return_value = "https://s3.ap-south-1.amazonaws.com/test-bucket/presigned-url"

    return {
        "documents_table": docs_table,
        "employees_table": emp_table,
        "audit_table": audit_table,
        "s3_client": s3_client,
        "bucket": "docvault-employee-documents-dev-test",
        "kms_key_id": "alias/docvault-dev",
        "gsi_name": "employee_id-index",
    }


class TestUploadHandler(unittest.TestCase):
    def test_employee_upload_own_success(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "body": json.dumps({"filename": "offer.pdf", "document_type": "offer_letter"}),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 201)
        body = json.loads(resp["body"])
        self.assertIn("document_id", body)
        self.assertIn("upload_url", body)
        self.assertEqual(body["s3_key"], "documents/EMP-001/offer_letter/offer.pdf")

        # Verify DynamoDB metadata write
        res["documents_table"].put_item.assert_called_once()
        saved_item = res["documents_table"].put_item.call_args[1]["Item"]
        self.assertEqual(saved_item["employee_id"], "EMP-001")
        self.assertEqual(saved_item["document_type"], "offer_letter")
        self.assertEqual(saved_item["status"], "PENDING_UPLOAD")

        # Verify Audit Log written
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "UPLOAD_REQUESTED")
        self.assertEqual(audit_item["result"], "SUCCESS")
        self.assertEqual(audit_item["caller_user_id"], "EMP-001")
        self.assertEqual(audit_item["target_employee_id"], "EMP-001")

    def test_upload_key_convention(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-999", ["Employee"])}},
            "body": json.dumps({"filename": "tax_2026.pdf", "document_type": "tax_forms"}),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 201)
        body = json.loads(resp["body"])
        self.assertEqual(body["s3_key"], "documents/EMP-999/tax_forms/tax_2026.pdf")

    def test_employee_upload_another_employee_forbidden(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "body": json.dumps({
                "filename": "review.pdf",
                "document_type": "performance",
                "employee_id": "EMP-002",
            }),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)
        res["documents_table"].put_item.assert_not_called()
        res["s3_client"].generate_presigned_url.assert_not_called()

        # Audit log must record ACCESS_DENIED
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "ACCESS_DENIED")
        self.assertEqual(audit_item["result"], "DENIED")

    def test_manager_upload_direct_report_success(self):
        res = make_mock_resources(direct_reports=["EMP-001", "EMP-002"])
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-MGR1", ["Manager"])}},
            "body": json.dumps({
                "filename": "perf.pdf",
                "document_type": "performance",
                "employee_id": "EMP-001",
            }),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 201)
        body = json.loads(resp["body"])
        self.assertEqual(body["s3_key"], "documents/EMP-001/performance/perf.pdf")

    def test_manager_upload_unrelated_employee_forbidden(self):
        res = make_mock_resources(direct_reports=["EMP-001"])
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-MGR1", ["Manager"])}},
            "body": json.dumps({
                "filename": "perf.pdf",
                "document_type": "performance",
                "employee_id": "EMP-999",
            }),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)

    def test_hr_admin_upload_any_employee_success(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-HR1", ["HR_Admin"])}},
            "body": json.dumps({
                "filename": "policy.pdf",
                "document_type": "compliance",
                "employee_id": "EMP-OTHER",
            }),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 201)

    def test_upload_missing_auth_returns_401(self):
        res = make_mock_resources()
        event = {"body": json.dumps({"filename": "a.pdf", "document_type": "general"})}
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 401)

    def test_upload_missing_fields_returns_400(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "body": json.dumps({"filename": ""}),
        }
        resp = upload_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 400)


class TestListFilesHandler(unittest.TestCase):
    def test_list_files_self_success_and_uses_gsi(self):
        res = make_mock_resources()
        res["documents_table"].query.return_value = {
            "Items": [
                {"document_id": "doc-1", "employee_id": "EMP-001", "filename": "doc1.pdf"}
            ]
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "queryStringParameters": {"employee_id": "EMP-001"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["documents"][0]["document_id"], "doc-1")

        # Verify query used employee_id-index GSI
        res["documents_table"].query.assert_called_once()
        kwargs = res["documents_table"].query.call_args[1]
        self.assertEqual(kwargs["IndexName"], "employee_id-index")

        # Verify audit log
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "FILES_LISTED")
        self.assertEqual(audit_item["result"], "SUCCESS")

    def test_list_files_employee_other_employee_forbidden(self):
        res = make_mock_resources()
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "queryStringParameters": {"employee_id": "EMP-002"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)
        res["documents_table"].query.assert_not_called()

        # Audit log must record ACCESS_DENIED
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "ACCESS_DENIED")
        self.assertEqual(audit_item["result"], "DENIED")

    def test_list_files_manager_direct_report_success(self):
        res = make_mock_resources(direct_reports=["EMP-001"])
        res["documents_table"].query.return_value = {"Items": []}
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-MGR1", ["Manager"])}},
            "queryStringParameters": {"employee_id": "EMP-001"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)

    def test_list_files_manager_unrelated_employee_forbidden(self):
        res = make_mock_resources(direct_reports=["EMP-001"])
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-MGR1", ["Manager"])}},
            "queryStringParameters": {"employee_id": "EMP-999"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)

    def test_list_files_hr_admin_any_employee_success(self):
        res = make_mock_resources()
        res["documents_table"].query.return_value = {"Items": []}
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-HR1", ["HR_Admin"])}},
            "queryStringParameters": {"employee_id": "EMP-ANY"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)

    def test_list_files_missing_auth_returns_401(self):
        res = make_mock_resources()
        event = {"queryStringParameters": {"employee_id": "EMP-001"}}
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 401)

    def test_list_files_excludes_pending_upload_and_deleted(self):
        res = make_mock_resources()
        res["documents_table"].query.return_value = {
            "Items": [
                {"document_id": "doc-available", "employee_id": "EMP-001", "filename": "done.pdf", "status": "AVAILABLE"},
                {"document_id": "doc-pending", "employee_id": "EMP-001", "filename": "pending.pdf", "status": "PENDING_UPLOAD"},
                {"document_id": "doc-deleted", "employee_id": "EMP-001", "filename": "deleted.pdf", "status": "DELETED"},
            ]
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "queryStringParameters": {"employee_id": "EMP-001"},
        }
        resp = files_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["documents"][0]["document_id"], "doc-available")


class TestDownloadHandler(unittest.TestCase):
    def test_download_self_success(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {
            "Item": {
                "document_id": "doc-123",
                "employee_id": "EMP-001",
                "filename": "my_doc.pdf",
                "document_type": "contract",
                "s3_key": "documents/EMP-001/contract/my_doc.pdf",
            }
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "doc-123"},
        }
        resp = download_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertEqual(body["document_id"], "doc-123")
        self.assertIn("download_url", body)
        res["s3_client"].generate_presigned_url.assert_called_once()

    def test_download_presigned_not_called_before_auth_denied(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {
            "Item": {
                "document_id": "doc-123",
                "employee_id": "EMP-002",
                "filename": "secret.pdf",
                "document_type": "salary",
                "s3_key": "documents/EMP-002/salary/secret.pdf",
            }
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "doc-123"},
        }
        resp = download_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)
        # CRITICAL: Verify presigned URL is NEVER generated on access denial
        res["s3_client"].generate_presigned_url.assert_not_called()

        # Audit log must record ACCESS_DENIED
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "ACCESS_DENIED")
        self.assertEqual(audit_item["result"], "DENIED")

    def test_download_nonexistent_document_returns_404(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {}  # Item not found
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "missing-doc"},
        }
        resp = download_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 404)
        res["s3_client"].generate_presigned_url.assert_not_called()

    def test_download_missing_auth_returns_401(self):
        res = make_mock_resources()
        event = {"pathParameters": {"doc_id": "doc-123"}}
        resp = download_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 401)

    def test_download_pending_upload_rejected_with_409(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {
            "Item": {
                "document_id": "doc-pending-1",
                "employee_id": "EMP-001",
                "filename": "draft.pdf",
                "document_type": "contract",
                "s3_key": "documents/EMP-001/contract/draft.pdf",
                "status": "PENDING_UPLOAD",
            }
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "doc-pending-1"},
        }
        resp = download_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 409)
        body = json.loads(resp["body"])
        self.assertEqual(body["error"], "Conflict")
        self.assertIn("pending", body["message"].lower())
        res["s3_client"].generate_presigned_url.assert_not_called()


class TestDeleteHandler(unittest.TestCase):
    def test_delete_self_success_and_preserves_versioning(self):
        res = make_mock_resources()
        res["s3_client"].delete_object.return_value = {
            "DeleteMarker": True,
            "VersionId": "s3-del-marker-v1",
        }
        res["documents_table"].get_item.return_value = {
            "Item": {
                "document_id": "doc-123",
                "employee_id": "EMP-001",
                "s3_key": "documents/EMP-001/general/doc.pdf",
            }
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "doc-123"},
        }
        resp = delete_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 200)

        # S3 delete_object called without VersionId (places delete marker, preserves versions)
        res["s3_client"].delete_object.assert_called_once_with(
            Bucket=res["bucket"],
            Key="documents/EMP-001/general/doc.pdf",
        )
        # DynamoDB soft delete: update_item setting status=DELETED and capturing delete marker VersionId
        res["documents_table"].update_item.assert_called_once()
        update_args = res["documents_table"].update_item.call_args[1]
        self.assertEqual(update_args["Key"], {"document_id": "doc-123"})
        self.assertEqual(update_args["ExpressionAttributeValues"][":status"], "DELETED")
        self.assertEqual(update_args["ExpressionAttributeValues"][":del_by"], "EMP-001")
        self.assertEqual(update_args["ExpressionAttributeValues"][":ver"], "s3-del-marker-v1")
        self.assertIn(":del_at", update_args["ExpressionAttributeValues"])
        # Ensure hard delete was NOT called
        res["documents_table"].delete_item.assert_not_called()

        # Audit log written
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "FILE_DELETED")
        self.assertEqual(audit_item["result"], "SUCCESS")

    def test_delete_unauthorized_forbidden(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {
            "Item": {
                "document_id": "doc-123",
                "employee_id": "EMP-002",
                "s3_key": "documents/EMP-002/general/doc.pdf",
            }
        }
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "doc-123"},
        }
        resp = delete_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 403)
        res["s3_client"].delete_object.assert_not_called()
        res["documents_table"].delete_item.assert_not_called()

        # Audit log must record ACCESS_DENIED
        res["audit_table"].put_item.assert_called_once()
        audit_item = res["audit_table"].put_item.call_args[1]["Item"]
        self.assertEqual(audit_item["action"], "ACCESS_DENIED")
        self.assertEqual(audit_item["result"], "DENIED")

    def test_delete_nonexistent_document_returns_404(self):
        res = make_mock_resources()
        res["documents_table"].get_item.return_value = {}
        event = {
            "requestContext": {"authorizer": {"claims": make_claims("EMP-001", ["Employee"])}},
            "pathParameters": {"doc_id": "nonexistent"},
        }
        resp = delete_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 404)
        res["s3_client"].delete_object.assert_not_called()

    def test_delete_missing_auth_returns_401(self):
        res = make_mock_resources()
        event = {"pathParameters": {"doc_id": "doc-123"}}
        resp = delete_handler(event, None, resources=res)
        self.assertEqual(resp["statusCode"], 401)
