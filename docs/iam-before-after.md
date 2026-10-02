# Employee Document Vault — IAM, Security & Observability Audit (Before & After)

This document details the security hardening, IAM scoping, observability, and monitoring changes applied to the **Employee Document Vault** project during the hardening sprint.

---

## 1. S3 Document Access Scoping

All employee documents adhere strictly to the project key convention:
`documents/{employee_id}/{document_type}/{filename}`

Previously, Lambda execution roles had wildcard object access (`/*`) across the entire S3 bucket namespace. The policies have been scoped to `/documents/*` to enforce least privilege and prevent access to non-document prefixes or root-level bucket objects.

### A. UploadFunction (S3 Upload Writes)

* **Before**:
  ```yaml
  - Sid: DocumentsS3Upload
    Effect: Allow
    Action:
      - s3:PutObject
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/*"
  ```
* **After**:
  ```yaml
  - Sid: DocumentsS3Upload
    Effect: Allow
    Action:
      - s3:PutObject
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/documents/*"
  ```
* **Rationale**: The presigned S3 PUT URL signature relies on the Lambda role's IAM permissions. Scoping to `documents/*` restricts client uploads strictly into the designated document directory tree.

---

### B. DownloadFunction (S3 Download Reads)

* **Before**:
  ```yaml
  - Sid: DocumentsS3Download
    Effect: Allow
    Action:
      - s3:GetObject
      - s3:GetObjectVersion
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/*"
  ```
* **After**:
  ```yaml
  - Sid: DocumentsS3Download
    Effect: Allow
    Action:
      - s3:GetObject
      - s3:GetObjectVersion
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/documents/*"
  ```
* **Rationale**: Restricts presigned S3 GET URL generation and object retrieval exclusively to documents stored within `/documents/*`.

---

### C. DeleteFunction (S3 Object Deletion)

* **Before**:
  ```yaml
  - Sid: DocumentsS3Delete
    Effect: Allow
    Action:
      - s3:DeleteObject
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/*"
  ```
* **After**:
  ```yaml
  - Sid: DocumentsS3Delete
    Effect: Allow
    Action:
      - s3:DeleteObject
    Resource: !Sub "arn:aws:s3:::${DocumentsBucket}/documents/*"
  ```
* **Rationale**: Scopes `s3:DeleteObject` (used to create version-safe S3 delete markers) strictly to the `/documents/*` prefix.

---

## 2. API Gateway Health Probe Authorization Correction (`/ping`)

* **Issue Identified**:
  In `template.yaml`, `DocVaultApi` declared `Auth.DefaultAuthorizer: CognitoAuthorizer`. Even though `/ping` had `security: []` in its OpenAPI definition, AWS SAM applied the default authorizer across all endpoints during OpenAPI transformation, causing unauthenticated requests to `/ping` to fail with `{"message":"Unauthorized"}` (HTTP 401).
* **Before**:
  ```yaml
  DocVaultApi:
    Properties:
      Auth:
        DefaultAuthorizer: CognitoAuthorizer
        Authorizers:
          CognitoAuthorizer: ...
      DefinitionBody:
        paths:
          /ping:
            get:
              summary: Unauthenticated infrastructure health probe
              security: []
  ```
* **After**:
  ```yaml
  DocVaultApi:
    Properties:
      Auth:
        Authorizers:
          CognitoAuthorizer: ...
      DefinitionBody:
        paths:
          /ping:
            get:
              summary: Unauthenticated infrastructure health probe
              security: []
              x-amazon-apigateway-auth:
                type: "NONE"
  ```
* **Rationale**: Removing `DefaultAuthorizer: CognitoAuthorizer` prevents AWS SAM from automatically injecting Cognito authorization onto the `/ping` probe. The `CognitoAuthorizer` scheme remains defined in `Auth.Authorizers`, and all protected API operations (`/upload`, `/files`, `/download/*`, `/activity`, etc.) explicitly declare `security: [ { CognitoAuthorizer: [] } ]`.

---

## 3. Observability & Tracing (AWS X-Ray)

* **Before**:
  * `DocVaultApi`: `TracingEnabled: false`
  * Lambda functions: No `Tracing: Active` configured (no trace headers or daemon subsegments).
  * Backend code: No `aws-xray-sdk` or `patch_all()` initialization.
* **After**:
  * `DocVaultApi`: `TracingEnabled: true`
  * Global Lambda configuration in `infra/template.yaml`:
    ```yaml
    Globals:
      Function:
        Tracing: Active
    ```
    This automatically attaches the AWS managed policy `arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess` to each Lambda execution role.
  * Application instrumentation in `backend/shared/xray.py` and `backend/shared/__init__.py`:
    * Safe `init_xray()` function patches `boto3`/`botocore` calls to generate DynamoDB, S3, and KMS subsegments.
    * Guarded against `ImportError` so the zero-dependency test runner (`backend/run_tests_stdlib.py`) executes seamlessly in local development.

---

## 4. API Gateway Logging & PII Protection

* **Configuration Applied**:
  ```yaml
  MethodSettings:
    - ResourcePath: '/*'
      HttpMethod: '*'
      LoggingLevel: OFF
      DataTraceEnabled: false
      MetricsEnabled: true
  ```
* **Security & Architecture Rationales**:
  1. **`DataTraceEnabled: false`**:
     * **Critical Security Control**: Prevents request and response payloads from being written to CloudWatch Logs. In the Vault, payloads contain sensitive data including employee metadata, filenames, document classifications, and presigned URLs with temporary AWS STS signatures. Enabling data trace would log credentials and employee PII in plaintext.
  2. **`LoggingLevel: OFF` (Intentional Architecture Exception)**:
     * **Reason**: In Amazon API Gateway, enabling execution logging (`INFO` or `ERROR`) requires an account-level IAM role (`CloudWatchLogsRoleArn`) configured under API Gateway account settings (`aws apigateway update-account`). This AWS account currently does not have an account-level CloudWatch execution role configured. Setting `LoggingLevel: INFO` without this role causes API Gateway stage deployment errors or silent failures.
     * **Compensating Controls**: Detailed CloudWatch Metrics (`MetricsEnabled: true`), active distributed tracing via AWS X-Ray (`TracingEnabled: true`), and application-level structured logging inside the Lambda handlers provide end-to-end operational visibility without exposing the deployment to account-level role dependency issues.

---

## 5. Intentionally Retained Permissions & Architecture Elements

### A. KMS Permissions (Retained as Required)
* **Configuration**:
  * `UploadFunction`: `kms:GenerateDataKey*`, `kms:Encrypt` on `!GetAtt DocVaultKmsKey.Arn`
  * `DownloadFunction`: `kms:Decrypt` on `!GetAtt DocVaultKmsKey.Arn`
  * `DocVaultKmsKey`: Root admin key policy delegating IAM administration (`kms:*` on `*`)
* **Rationale**: The presigned upload and download URLs enforce server-side encryption via customer-managed SSE-KMS (`alias/docvault-${Env}`). The Lambda execution roles must hold explicit KMS permissions to sign valid presigned URLs for client PUT/GET operations. These permissions are already strictly scoped to the single KMS key ARN.

### B. DynamoDB Permissions (Retained as Already Scoped)
* **Configuration**:
  * `DocumentsTable`: Read (`dynamodb:GetItem`), query (`dynamodb:Query` on table and `employee_id-index` GSI), and write (`dynamodb:PutItem`, `dynamodb:UpdateItem`).
  * `EmployeesTable`: Query (`dynamodb:Query` on table and `manager_id-index` GSI) for manager/direct-report access control checks.
  * `AuditLogTable`: Append-only write (`dynamodb:PutItem`) and read (`dynamodb:Scan`, `dynamodb:Query` on `ActivityFunction`).
* **Rationale**: All DynamoDB actions are already explicitly restricted to the exact table and GSI ARNs using CloudFormation intrinsic functions (`!GetAtt` and `!Sub`). No wildcard `*` table resources exist.

---

## 6. CloudWatch Monitoring Design

Two alarms and one dashboard have been added to `infra/template.yaml`:

1. **`DocVaultApiP95LatencyAlarm`**:
   * Evaluates API Gateway `Latency` (`p95` statistic) over a 5-minute period.
   * Triggers if p95 latency exceeds 1000ms for 2 consecutive evaluation periods (`TreatMissingData: notBreaching`).
   * Rationale: The API performs only metadata and presigned URL operations; p95 latency > 1s indicates database or infrastructure degradation.
2. **`DocVaultLambdaErrorRateAlarm`**:
   * Because CloudWatch metric-math alarms support a maximum of 10 underlying MetricStat inputs, the aggregate error-rate alarm monitors five critical Lambda functions (5 Errors + 5 Invocations). The dashboard retains visibility across the full seven-function fleet.
   * Monitored Functions: `UploadFunction`, `ListFilesFunction`, `DownloadFunction`, `DeleteFunction`, and `ActivityFunction`.
   * Structure: Exactly 10 `MetricStat` queries (5 `Errors` + 5 `Invocations`) and 3 math expressions (`errors`, `invocations`, `error_rate`) for a total of 13 `MetricDataQuery` entries (strictly within both the 10-MetricStat limit and the 20-MetricDataQuery limit).
   * Uses `FILL(..., 0)` to guarantee no gaps when functions have low traffic.
   * Threshold: 5.0% error rate over 2 periods of 300 seconds (`TreatMissingData: notBreaching`).
3. **`DocVaultOverviewDashboard`**:
   * Fleet-level visibility across all seven functions into API request count, 4XX/5XX errors, latency percentiles (Average, p90, p95, p99), Lambda invocations/errors/duration/throttles, S3 request activity, and DynamoDB consumed capacity and throttles.
