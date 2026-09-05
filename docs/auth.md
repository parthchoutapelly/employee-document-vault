# Phase 2 — Authentication & Access Control

This document describes every identity and authorization component added in Phase 2
of the Employee Document Vault project.

---

## 1. Amazon Cognito User Pool

**CloudFormation Logical ID:** `DocVaultUserPool`  
**Resource type:** `AWS::Cognito::UserPool`  
**Name pattern:** `docvault-user-pool-<env>`

The User Pool is the single identity provider for all application users.
Employees authenticate by presenting their **email address** and password.
On successful authentication, Cognito issues a short-lived JWT (ID token +
access token) that is forwarded to API Gateway on every API request.

### Configuration

| Setting | Value |
|---|---|
| Username attribute | Email |
| Auto-verified attribute | Email |
| Password minimum length | 8 |
| Password complexity | Uppercase + lowercase + number + symbol |
| Temporary password validity | 7 days |
| Account recovery | Email only (no SMS) |
| Deletion protection | ACTIVE (prevents accidental deletion in all envs) |
| Access token validity | 60 minutes |
| ID token validity | 60 minutes |
| Refresh token validity | 30 days |

> **Cognito hosted-UI domain (optional):** The `DocVaultUserPoolDomain` resource
> reserves the prefix `docvault-<env>` for the Cognito hosted sign-in page
> (e.g. `docvault-dev.auth.ap-south-1.amazoncognito.com`).  This is Phase 3
> frontend infrastructure.  The prefix must be globally unique across all
> Cognito user pools at deploy time, but availability does **not** need to be
> confirmed during local Phase 2 implementation — if the prefix is taken, an
> alternative can be selected before the first deployment.

---

## 2. `custom:employee_id` Attribute

**Attribute name in JWT claims:** `custom:employee_id`

Every Cognito user has the standard attribute `custom:employee_id` set to the
employee's canonical identifier (e.g. `EMP-00123`).  This value **must match**
the `employee_id` partition key in the `Employees-<env>` DynamoDB table.

The attribute is:
- Mutable (HR Admin can update it if an employee is re-assigned an ID)
- Not required at sign-up (admin-managed users are created with the attribute pre-set)
- Readable and writable by the app client

The `checkAccess()` helper reads `custom:employee_id` from the JWT claims dict
(`event["requestContext"]["authorizer"]["claims"]`) to identify the caller.

---

## 3. Cognito Groups & RBAC Roles

Three groups are defined in the User Pool, each mapping to one RBAC role.

| Group name | Logical ID | Precedence | Role description |
|---|---|---|---|
| `Employee` | `EmployeeGroup` | 30 (lowest) | Standard employees |
| `Manager` | `ManagerGroup` | 20 | Managers with a team |
| `HR_Admin` | `HRAdminGroup` | 10 (highest) | HR Administrators |

**Precedence** only affects the Cognito Hosted UI; it does **not** affect the
Lambda RBAC logic.  `checkAccess()` checks HR_Admin first, then Manager, then
Employee, as described in §6.

Users are assigned to a group by an administrator after account creation.
A user may be in multiple groups (e.g. an HR Admin who is also a Manager);
`checkAccess()` grants the most permissive role that applies.

---

## 4. Employees DynamoDB Table

**CloudFormation Logical ID:** `EmployeesTable`  
**Table name:** `Employees-<env>` (e.g. `Employees-dev`)

Stores the canonical employee identity record and the manager/direct-report
relationship used by `checkAccess()`.

### Key Schema

| Attribute | Type | Key role |
|---|---|---|
| `employee_id` | String (S) | **Partition key (PK)** |

### Non-Key Attributes (written by the application)

| Attribute | Type | Description |
|---|---|---|
| `manager_id` | String (S) | `employee_id` of this employee's direct manager |
| `full_name` | String (S) | Display name |
| `email` | String (S) | Work email (mirrors Cognito username) |
| `department` | String (S) | Department or team name |
| `job_title` | String (S) | Job title |
| `active` | Boolean | False when the employee has left the company |

> **Note:** Only `employee_id` and `manager_id` are declared in CloudFormation
> (as GSI key attributes). All other attributes are free-form and written by
> the application.

### Global Secondary Index — `manager_id-index`

| Setting | Value |
|---|---|
| Index name | `manager_id-index` |
| Partition key | `manager_id` (S) |
| Projection | ALL |
| Purpose | List all direct reports of a given manager |

**Query pattern used by `checkAccess()`:**

```python
employees_table.query(
    IndexName="manager_id-index",
    KeyConditionExpression=Key("manager_id").eq(caller_employee_id),
    ProjectionExpression="employee_id",
)
```

This returns all employees whose `manager_id` equals the caller, in O(1) DynamoDB
capacity units regardless of total table size.

### Table Settings

| Setting | Value |
|---|---|
| Billing | PAY_PER_REQUEST (on-demand) |
| Encryption | AWS-managed SSE (`SSEEnabled: true`) |
| Point-in-time recovery | Enabled |

---

## 5. Manager / Direct-Report Relationship

Each employee record stores their direct manager's `employee_id` in the
`manager_id` attribute.

```
Employees-dev
┌─────────────────────────────────────────────────────┐
│ employee_id │ manager_id  │ full_name       │ ...   │
│─────────────────────────────────────────────────────│
│ EMP-MGR1    │ EMP-HR1     │ Alice Manager   │       │
│ EMP-001     │ EMP-MGR1    │ Bob Employee    │       │
│ EMP-002     │ EMP-MGR1    │ Carol Employee  │       │
│ EMP-HR1     │ (none)      │ Dave HR Admin   │       │
└─────────────────────────────────────────────────────┘
```

- To find all direct reports of `EMP-MGR1`: query `manager_id-index` with `manager_id = EMP-MGR1`
- To find a specific employee's manager: `GetItem` on `employee_id`

HR Admin is responsible for maintaining `manager_id` values when org changes occur.

---

## 6. Authorization Matrix

| Role | Can access |
|---|---|
| `HR_Admin` | **Any** `employee_id` |
| `Manager` | Own `employee_id` + all `employee_id`s where `manager_id == caller's employee_id` |
| `Employee` | Own `employee_id` only |

Implemented in `backend/shared/auth.py → checkAccess()`.

---

## 7. API Gateway Cognito Authorizer

**CloudFormation Logical ID:** `DocVaultApi`  
**Resource type:** `AWS::Serverless::Api`  
**Stage:** `v1`

Every inbound HTTP request to the API must carry a valid Cognito JWT in the
`Authorization` header.  API Gateway validates the token signature against the
User Pool's public keys **before** invoking any Lambda function — this means
token validation carries zero Lambda cold-start cost.

### Authorizer Configuration

```yaml
Auth:
  DefaultAuthorizer: CognitoAuthorizer
  Authorizers:
    CognitoAuthorizer:
      UserPoolArn: !GetAtt DocVaultUserPool.Arn
      Identity:
        Header: Authorization
```

`DefaultAuthorizer: CognitoAuthorizer` means every route on this API requires a
valid token unless a specific route explicitly opts out (none do).

### Why the API resource is declared in Phase 2

AWS SAM requires a named `AWS::Serverless::Api` resource to anchor the Cognito
authorizer as the default.  Phase 3 Lambda functions will reference this API
by its logical ID (`DocVaultApi`) and automatically inherit the authorizer.
Without this declaration, every Phase 3 handler would need to repeat the full
authorizer block, violating the DRY principle.

### Request flow

```
Client → API Gateway (validates JWT) → Lambda handler
                                            ↓
                                    checkAccess(claims, target_id, ...)
                                            ↓
                                    Business logic (S3 pre-signed URL, etc.)
```

---

## 8. `checkAccess()` — Centralized Authorization Helper

**Module:** `backend/shared/auth.py`  
**Function signature:**

```python
def checkAccess(
    caller: dict,
    target_employee_id: str,
    employees_table,   # boto3 DynamoDB Table resource
    audit_table,       # boto3 DynamoDB Table resource
) -> None:
```

### Behaviour

1. Extract `custom:employee_id` and `cognito:groups` from `caller` (JWT claims).
2. If the caller is in `HR_Admin` → return immediately (access granted).
3. If the caller is in `Manager`:
   - Allow if `caller.employee_id == target_employee_id` (self).
   - Allow if `target_employee_id` is a direct report (GSI query).
   - Otherwise → write audit record + raise `AccessDeniedError`.
4. If the caller is in `Employee`:
   - Allow if `caller.employee_id == target_employee_id` (self).
   - Otherwise → write audit record + raise `AccessDeniedError`.
5. If no recognised group → write audit record + raise `AccessDeniedError`.

### Usage in a Phase 3 handler (example)

```python
import json, os, boto3
from shared.auth import checkAccess, AccessDeniedError

dynamodb = boto3.resource("dynamodb")

def handler(event, context):
    claims = event["requestContext"]["authorizer"]["claims"]
    target_id = event["pathParameters"]["employee_id"]

    employees_table = dynamodb.Table(os.environ["EMPLOYEES_TABLE"])
    audit_table     = dynamodb.Table(os.environ["AUDIT_LOG_TABLE"])

    try:
        checkAccess(claims, target_id, employees_table, audit_table)
    except AccessDeniedError:
        return {"statusCode": 403, "body": json.dumps({"error": "Forbidden"})}

    # ... business logic ...
```

---

## 9. HTTP 403 Behavior

`checkAccess()` raises `AccessDeniedError` for all denied access attempts.
This exception carries:
- `caller_id` — the caller's `employee_id`
- `target_id` — the requested `employee_id`
- `reason` — human-readable denial reason (logged, not returned to client)

Phase 3 handlers **must** catch `AccessDeniedError` and return:

```json
HTTP 403 Forbidden
{
  "error": "Forbidden"
}
```

The reason string is intentionally **not** returned to the client (information
leakage prevention).  It is captured in the AuditLog record instead.

---

## 10. AuditLog Write on Authorization Denial

Every denied access attempt is written to the `AuditLog-<env>` table by
`_write_audit_denied()` inside `checkAccess()` — **before** `AccessDeniedError`
is raised.

The audit record contains:

| Field | Value |
|---|---|
| `log_id` | UUID (auto-generated) — partition key |
| `timestamp` | Unix epoch milliseconds — sort key |
| `action` | `ACCESS_DENIED` |
| `result` | `DENIED` |
| `actor_id` | Caller's `employee_id` |
| `resource_id` | Requested `employee_id` |
| `reason` | Human-readable denial reason (not returned to client) |
| `cognito_sub` | Caller's Cognito `sub` claim (for correlation) |

**Fail-open on audit, fail-closed on access:** if the DynamoDB `put_item` call
fails (e.g. table unavailable), the error is logged but `AccessDeniedError` is
still raised.  Access is never silently granted due to an audit failure.

---

## Phase 2 Infrastructure Summary

| Resource | Logical ID | Name pattern |
|---|---|---|
| Cognito User Pool | `DocVaultUserPool` | `docvault-user-pool-<env>` |
| Cognito User Pool Domain | `DocVaultUserPoolDomain` | `docvault-<env>` |
| Cognito App Client | `DocVaultUserPoolClient` | `docvault-client-<env>` |
| Cognito Group | `EmployeeGroup` | `Employee` |
| Cognito Group | `ManagerGroup` | `Manager` |
| Cognito Group | `HRAdminGroup` | `HR_Admin` |
| DynamoDB Table | `EmployeesTable` | `Employees-<env>` |
| DynamoDB GSI | — | `manager_id-index` (on `EmployeesTable`) |
| API Gateway REST API | `DocVaultApi` | `docvault-api-<env>` (stage: `v1`) |
