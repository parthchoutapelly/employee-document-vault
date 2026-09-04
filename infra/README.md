# Infrastructure — Employee Document Vault

This directory contains the AWS SAM template (`template.yaml`) that defines
the **Phase 1 storage layer** for the Employee Document Vault project.

---

## Resource Naming Convention

All resources follow the pattern:

```
docvault-<resource>-<env>
```

where `<env>` is one of `dev`, `staging`, or `prod`.

### S3 Buckets — extra suffix for global uniqueness

S3 bucket names must be globally unique across all AWS accounts.
The AWS Account ID is therefore appended:

```
docvault-<resource>-<env>-<account_id>
```

| Bucket | Name pattern | Purpose |
|---|---|---|
| Employee documents | `docvault-employee-documents-<env>-<account_id>` | Stores all HR documents |
| S3 access logs | `docvault-access-logs-<env>-<account_id>` | Receives S3 server access logs from the documents bucket |

### DynamoDB Tables

DynamoDB table names are AWS-account-scoped, so no account ID suffix is needed:

```
<TableName>-<env>
```

Examples: `Documents-dev`, `AuditLog-prod`.

---

## S3 Storage Configuration

### Employee Documents Bucket

The `DocumentsBucket` stores employee documents and is configured as follows:

- Private bucket with S3 Block Public Access enabled:
  - BlockPublicAcls
  - BlockPublicPolicy
  - IgnorePublicAcls
  - RestrictPublicBuckets
- S3 Versioning: enabled
- Default encryption: SSE-KMS
- Project-managed KMS key: `DocVaultKmsKey`
- KMS key rotation: enabled
- S3 Bucket Key: enabled
- HTTPS-only access enforced through `DocumentsBucketPolicy`
- Noncurrent object versions transition to `STANDARD_IA` after 90 days
- S3 server access logging enabled
- Access logs are delivered to the dedicated `AccessLogsBucket`

### Access Log Bucket

The `AccessLogsBucket` is kept separate from the employee document bucket.

- Private bucket with S3 Block Public Access enabled
- Receives S3 server access logs from `DocumentsBucket`
- Only the S3 logging service is permitted to write access logs
- Writes are restricted to the `access-logs/` prefix
- Source bucket and AWS account are restricted in the bucket policy
- HTTPS-only access enforced through `AccessLogsBucketPolicy`

### Public Access Protection

Bucket-level S3 Block Public Access is configured in the SAM template.

Account-level S3 Block Public Access is an account-wide AWS setting and is not changed by this stack. It should be verified separately in the target AWS account before production use.

## S3 Key Structure

All employee documents are stored under:

```
/documents/{employee_id}/{document_type}/{filename}
```

| Segment | Description |
|---|---|
| `employee_id` | Unique identifier for the employee (e.g. `EMP-00123`) |
| `document_type` | Category such as `offer-letter`, `id-proof`, `payslip`, `appraisal`, etc. |
| `filename` | Original filename (e.g. `offer_letter_2024.pdf`) |

**Example key:**
```
documents/EMP-00123/offer-letter/offer_letter_2024.pdf
```

---

## DynamoDB Schema

### `Documents-<env>` — Document Metadata Table

Tracks every document uploaded to S3.

| Attribute | Type | Key role | Notes |
|---|---|---|---|
| `document_id` | String (S) | **Partition key (PK)** | UUID generated at upload time |
| `employee_id` | String (S) | GSI partition key | Links document to an employee |
| `upload_timestamp` | Number (N) | GSI sort key | Unix epoch milliseconds |
| *(other attributes)* | — | — | `document_type`, `s3_key`, `file_size`, `uploader_id`, etc. (added by the application) |

**Global Secondary Index (GSI):** `employee_id-index`
- Partition key: `employee_id`
- Sort key: `upload_timestamp`
- Projection: ALL
- Use-case: "List all documents for employee X, sorted by upload time."

**Table settings:**
- Billing: PAY_PER_REQUEST (on-demand)
- Encryption: AWS-managed SSE
- Point-in-time recovery: enabled

---

### `AuditLog-<env>` — Append-Only Audit Table

Records every read, write, download, and admin action.
The table is treated as **append-only** at the application layer.

| Attribute | Type | Key role | Notes |
|---|---|---|---|
| `log_id` | String (S) | **Partition key (PK)** | UUID generated per event |
| `timestamp` | Number (N) | **Sort key (SK)** | Unix epoch milliseconds |
| *(other attributes)* | — | — | `actor_id`, `action`, `resource_id`, `ip_address`, etc. |

**Table settings:**
- Billing: PAY_PER_REQUEST (on-demand)
- Encryption: AWS-managed SSE
- Point-in-time recovery: enabled

---

## Other Resources Defined in template.yaml

| Resource | Logical ID | Purpose |
|---|---|---|
| KMS Key | `DocVaultKmsKey` | SSE-KMS encryption for the documents bucket |
| KMS Alias | `DocVaultKmsKeyAlias` | `alias/docvault-<env>` — human-friendly key reference |
| S3 Bucket Policy (docs) | `DocumentsBucketPolicy` | Denies all non-HTTPS access |
| S3 Bucket Policy (logs) | `AccessLogsBucketPolicy` | Denies all non-HTTPS access |

---

## SAM Parameters

| Parameter | Default | Allowed values |
|---|---|---|
| `Env` | `dev` | `dev`, `staging`, `prod` |

Pass via `--parameter-overrides Env=prod` at deploy time.

---

## Validation

Validate the SAM template locally before deployment:

```powershell
sam validate --template infra/template.yaml --region ap-south-1
```

Run the stricter lint validation:

sam validate --template infra/template.yaml --region ap-south-1 --lint

Both validations should pass before deployment.
---

## Deployment

The Phase 1 stack must be deployed only after human review and approval.

Example deployment command:

sam deploy --template-file infra/template.yaml --stack-name employee-document-vault-dev --region ap-south-1 --parameter-overrides Env=dev

Review the CloudFormation changeset and confirm the resources before proceeding with deployment.

After deployment, record the CloudFormation outputs for:

- Documents bucket name
- Access-log bucket name
- Documents table name
- Documents GSI name
- AuditLog table name
- KMS key ID
---

## Validation and Exit Test

The Phase 1 exit test uses the following S3 object key:

documents/E123/payslips/jan2026.pdf

The test should:

1. Manually upload a test file to the Documents bucket using the required key structure.
2. Write a corresponding metadata item to `Documents-dev`.
3. Query `employee_id-index` for `employee_id = E123`.
4. Confirm that the uploaded document appears in the query results.
5. Verify that the returned metadata contains the expected S3 key.

The Phase 1 exit test must not be reported as passed until it has actually been performed.

---

## Assumptions and Deviations

- The S3 object key structure is an application convention. S3 does not enforce the `/documents/{employee_id}/{document_type}/{filename}` structure itself.
- Bucket-level S3 Block Public Access is configured by this CloudFormation stack.
- Account-level S3 Block Public Access is account-wide and is not modified by this stack. It should be verified separately in the target AWS account.
- DynamoDB tables use AWS-managed server-side encryption (`SSEEnabled: true`).
- The `AuditLog` table is append-only at the application layer. This infrastructure template does not create application permissions or Lambda handlers for enforcing append-only behavior.
- Cognito, IAM application roles, Lambda functions, API Gateway routes, presigned URLs, frontend resources, CloudFront, and Phase 2/Phase 3 resources are outside the scope of Phase 1.
- No AWS deployment should be considered complete until the deployed resources and exit test have been verified.
