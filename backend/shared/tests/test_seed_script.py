"""
backend/shared/tests/test_seed_script.py

Unit tests for backend/scripts/seed_test_users.py.
Validates password rules, idempotency, Cognito user creation logic, and DynamoDB record writes.
All tests run offline with mock boto3 clients.
"""

import sys
import os
import pytest
from unittest.mock import MagicMock

# Allow imports from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.seed_test_users import (
    validate_password_complexity,
    seed_cognito_user,
    seed_dynamodb_record,
    verify_provisioning,
    PERSONAS,
)


def test_password_complexity_valid():
    validate_password_complexity("StrongP@ss123!")


def test_password_complexity_invalid():
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password_complexity("Short1!")

    with pytest.raises(ValueError, match="uppercase"):
        validate_password_complexity("lowercase123!")

    with pytest.raises(ValueError, match="lowercase"):
        validate_password_complexity("UPPERCASE123!")

    with pytest.raises(ValueError, match="digit"):
        validate_password_complexity("NoDigitsHere!")

    with pytest.raises(ValueError, match="symbol"):
        validate_password_complexity("NoSpecialChars123")


def test_seed_cognito_user_creates_when_missing():
    mock_cognito = MagicMock()
    # Simulate user not found
    mock_cognito.exceptions.UserNotFoundException = Exception
    mock_cognito.admin_get_user.side_effect = mock_cognito.exceptions.UserNotFoundException()
    mock_cognito.admin_list_groups_for_user.return_value = {"Groups": []}

    persona = PERSONAS[0]
    seed_cognito_user(mock_cognito, "pool-123", persona, "Pass123!@#")

    mock_cognito.admin_create_user.assert_called_once()
    mock_cognito.admin_set_user_password.assert_called_once_with(
        UserPoolId="pool-123",
        Username="emp001@example.com",
        Password="Pass123!@#",
        Permanent=True,
    )
    mock_cognito.admin_add_user_to_group.assert_called_once_with(
        UserPoolId="pool-123",
        Username="emp001@example.com",
        GroupName="Employee",
    )


def test_seed_cognito_user_idempotent_when_exists():
    mock_cognito = MagicMock()
    mock_cognito.exceptions.UserNotFoundException = Exception
    # User exists
    mock_cognito.admin_get_user.return_value = {"Username": "emp001@example.com"}
    # Group already assigned
    mock_cognito.admin_list_groups_for_user.return_value = {"Groups": [{"GroupName": "Employee"}]}

    persona = PERSONAS[0]
    seed_cognito_user(mock_cognito, "pool-123", persona, "Pass123!@#")

    # Does not call admin_create_user or admin_add_user_to_group
    mock_cognito.admin_create_user.assert_not_called()
    mock_cognito.admin_add_user_to_group.assert_not_called()
    # Resets permanent password to ensure test readiness
    mock_cognito.admin_set_user_password.assert_called_once()


def test_seed_dynamodb_record_writes_when_missing_or_different():
    mock_table = MagicMock()
    mock_table.get_item.return_value = {}

    persona = PERSONAS[0]
    seed_dynamodb_record(mock_table, persona)

    mock_table.put_item.assert_called_once_with(Item=persona["dynamo_item"])


def test_seed_dynamodb_record_skips_when_matching():
    mock_table = MagicMock()
    persona = PERSONAS[0]
    mock_table.get_item.return_value = {"Item": persona["dynamo_item"]}

    seed_dynamodb_record(mock_table, persona)
    mock_table.put_item.assert_not_called()


def test_verify_provisioning_success():
    mock_cognito = MagicMock()
    mock_cognito.admin_get_user.return_value = {
        "UserAttributes": [{"Name": "custom:employee_id", "Value": "EMP-001"}],
        "UserStatus": "CONFIRMED",
        "Enabled": True,
    }
    mock_cognito.admin_list_groups_for_user.return_value = {"Groups": [{"GroupName": "Employee"}]}

    mock_table = MagicMock()
    mock_table.get_item.return_value = {"Item": PERSONAS[0]["dynamo_item"]}

    assert verify_provisioning(mock_cognito, "pool-123", mock_table, [PERSONAS[0]]) is True
