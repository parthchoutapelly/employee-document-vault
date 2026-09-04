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
