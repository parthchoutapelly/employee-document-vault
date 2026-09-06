#!/usr/bin/env python3
"""
backend/scripts/seed_test_users.py

Idempotent provisioning script for Phase 3 live dev RBAC test fixtures:
  - EMP-001  -> emp001@example.com -> Employee
  - EMP-002  -> emp002@example.com -> Employee
  - EMP-MGR1 -> mgr1@example.com   -> Manager
  - EMP-HR1  -> hr1@example.com    -> HR_Admin

Requirements:
  - The test password MUST be supplied via the DOCVAULT_TEST_PASSWORD environment variable.
  - Never prints passwords, tokens, or sensitive values.
  - Idempotent: safe to run multiple times without creating duplicate records or throwing errors.
  - Targeted queries: uses AdminGetUser and GetItem rather than ListUsers or Scan.
"""

import os
import sys
import logging
from typing import Dict, Any, List

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("seed_test_users")

# ---------------------------------------------------------------------------
# Defaults and configuration
# ---------------------------------------------------------------------------
DEFAULT_REGION = os.environ.get("AWS_REGION", "ap-south-1")
DEFAULT_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "ap-south-1_mxjCs7jgX")
DEFAULT_TABLE_NAME = os.environ.get("EMPLOYEES_TABLE", "Employees-dev")

PERSONAS: List[Dict[str, Any]] = [
    {
        "employee_id": "EMP-001",
        "email": "emp001@example.com",
        "group": "Employee",
        "dynamo_item": {
            "employee_id": "EMP-001",
            "manager_id": "EMP-MGR1",
            "full_name": "Bob Employee",
            "email": "emp001@example.com",
            "department": "Engineering",
            "job_title": "Software Engineer",
            "active": True,
        },
    },
    {
        "employee_id": "EMP-002",
        "email": "emp002@example.com",
        "group": "Employee",
        "dynamo_item": {
            "employee_id": "EMP-002",
            "manager_id": "EMP-MGR1",
            "full_name": "Carol Employee",
            "email": "emp002@example.com",
            "department": "Engineering",
            "job_title": "QA Engineer",
            "active": True,
        },
    },
    {
        "employee_id": "EMP-MGR1",
        "email": "mgr1@example.com",
        "group": "Manager",
        "dynamo_item": {
            "employee_id": "EMP-MGR1",
            "manager_id": "EMP-HR1",
            "full_name": "Alice Manager",
            "email": "mgr1@example.com",
            "department": "Engineering",
            "job_title": "Engineering Manager",
            "active": True,
        },
    },
    {
        "employee_id": "EMP-HR1",
        "email": "hr1@example.com",
        "group": "HR_Admin",
        "dynamo_item": {
            "employee_id": "EMP-HR1",
            # No manager_id for top-level HR Admin
            "full_name": "Dave HR Admin",
            "email": "hr1@example.com",
            "department": "Human Resources",
            "job_title": "HR Director",
            "active": True,
        },
    },
]


def validate_password_complexity(password: str) -> None:
    """Validate that the password satisfies Cognito user pool complexity rules."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if not any(c.isupper() for c in password):
        raise ValueError("Password must contain at least one uppercase letter.")
    if not any(c.islower() for c in password):
        raise ValueError("Password must contain at least one lowercase letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must contain at least one digit.")
    if not any(not c.isalnum() for c in password):
        raise ValueError("Password must contain at least one symbol/special character.")


def seed_cognito_user(
    cognito_client: Any,
    user_pool_id: str,
    persona: Dict[str, Any],
    password: str,
) -> None:
    """Ensure a Cognito user exists, has permanent password set, and belongs to expected group."""
    email = persona["email"]
    employee_id = persona["employee_id"]
    group = persona["group"]

    # 1. Check if user exists
    user_exists = False
    try:
        cognito_client.admin_get_user(
            UserPoolId=user_pool_id,
            Username=email,
        )
        user_exists = True
        logger.info("Cognito user '%s' (%s) already exists.", email, employee_id)
    except cognito_client.exceptions.UserNotFoundException:
        logger.info("Cognito user '%s' (%s) not found. Creating user...", email, employee_id)

    # 2. Create user if not present
    if not user_exists:
        cognito_client.admin_create_user(
            UserPoolId=user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:employee_id", "Value": employee_id},
            ],
            MessageAction="SUPPRESS",
        )
        logger.info("Created Cognito user '%s'.", email)

    # 3. Always set/reset permanent password to ensure test readiness
    cognito_client.admin_set_user_password(
        UserPoolId=user_pool_id,
        Username=email,
        Password=password,
        Permanent=True,
    )
    logger.info("Set permanent password for '%s'.", email)

    # 4. Check group membership
    groups_resp = cognito_client.admin_list_groups_for_user(
        UserPoolId=user_pool_id,
        Username=email,
    )
    current_groups = [g["GroupName"] for g in groups_resp.get("Groups", [])]

    if group not in current_groups:
        cognito_client.admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=email,
            GroupName=group,
        )
        logger.info("Added user '%s' to group '%s'.", email, group)
    else:
        logger.info("User '%s' is already in group '%s'.", email, group)


def seed_dynamodb_record(
    table: Any,
    persona: Dict[str, Any],
) -> None:
    """Ensure employee metadata record exists in DynamoDB."""
    employee_id = persona["employee_id"]
    item = persona["dynamo_item"]

    # Check existence
    existing = table.get_item(
        Key={"employee_id": employee_id},
        ConsistentRead=True,
    ).get("Item")

    if existing == item:
        logger.info("DynamoDB record for '%s' already matches intended state.", employee_id)
        return

    table.put_item(Item=item)
    logger.info("Wrote DynamoDB record for '%s'.", employee_id)


def verify_provisioning(
    cognito_client: Any,
    user_pool_id: str,
    table: Any,
    personas: List[Dict[str, Any]],
) -> bool:
    """Verify all personas exist in Cognito and DynamoDB with correct attributes."""
    all_ok = True
    logger.info("Verifying provisioned RBAC fixtures...")

    for persona in personas:
        emp_id = persona["employee_id"]
        email = persona["email"]
        expected_group = persona["group"]

        # Cognito verification
        try:
            user_data = cognito_client.admin_get_user(
                UserPoolId=user_pool_id,
                Username=email,
            )
            attrs = {a["Name"]: a["Value"] for a in user_data.get("UserAttributes", [])}
            actual_emp_id = attrs.get("custom:employee_id")
            user_status = user_data.get("UserStatus")
            enabled = user_data.get("Enabled")

            groups_resp = cognito_client.admin_list_groups_for_user(
                UserPoolId=user_pool_id,
                Username=email,
            )
            groups = [g["GroupName"] for g in groups_resp.get("Groups", [])]

            if actual_emp_id != emp_id or expected_group not in groups or not enabled:
                logger.error(
                    "Cognito mismatch for %s: emp_id=%s, group=%s, status=%s, enabled=%s",
                    email, actual_emp_id, groups, user_status, enabled,
                )
                all_ok = False
            else:
                logger.info(
                    "Verified Cognito user '%s': custom:employee_id=%s, group=%s, status=%s",
                    email, actual_emp_id, groups, user_status,
                )
        except Exception as e:
            logger.error("Failed to verify Cognito user %s: %s", email, str(e))
            all_ok = False

        # DynamoDB verification
        try:
            db_item = table.get_item(
                Key={"employee_id": emp_id},
                ConsistentRead=True,
            ).get("Item")

            if not db_item:
                logger.error("DynamoDB record missing for %s", emp_id)
                all_ok = False
            else:
                manager_id = db_item.get("manager_id", "(none)")
                logger.info(
                    "Verified DynamoDB record for '%s': manager_id=%s, full_name=%s",
                    emp_id, manager_id, db_item.get("full_name"),
                )
        except Exception as e:
            logger.error("Failed to verify DynamoDB record for %s: %s", emp_id, str(e))
            all_ok = False

    return all_ok


def main() -> None:
    # 1. Securely fetch password
    password = os.environ.get("DOCVAULT_TEST_PASSWORD", "").strip()
    if not password:
        logger.error(
            "Missing environment variable DOCVAULT_TEST_PASSWORD. "
            "Please export DOCVAULT_TEST_PASSWORD before running this script."
        )
        sys.exit(1)

    try:
        validate_password_complexity(password)
    except ValueError as err:
        logger.error("Password complexity validation failed: %s", err)
        sys.exit(1)

    # 2. Setup AWS clients
    import boto3

    region = DEFAULT_REGION
    user_pool_id = DEFAULT_USER_POOL_ID
    table_name = DEFAULT_TABLE_NAME

    logger.info("Initializing clients (Profile: docvault, Region: %s, UserPool: %s, Table: %s)", region, user_pool_id, table_name)
    session = boto3.Session(profile_name="docvault", region_name="ap-south-1")
    cognito_client = session.client("cognito-idp")
    dynamodb_resource = session.resource("dynamodb")
    table = dynamodb_resource.Table(table_name)

    # 3. Seed fixtures
    for persona in PERSONAS:
        seed_cognito_user(cognito_client, user_pool_id, persona, password)
        seed_dynamodb_record(table, persona)

    # 4. Verify fixtures
    success = verify_provisioning(cognito_client, user_pool_id, table, PERSONAS)
    if not success:
        logger.error("Provisioning verification encountered errors.")
        sys.exit(2)

    logger.info("All 4 live RBAC test fixtures provisioned and verified successfully.")


if __name__ == "__main__":
    main()
