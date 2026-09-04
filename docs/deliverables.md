# Project Deliverables Checklist

Tracks the four required deliverables for the Employee Document Vault project.

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | **Demo video** | ⬜ Not started | End-to-end walkthrough: upload, retrieve, role-based access, audit log export |
| 2 | **Security architecture diagram** | ⬜ Not started | Formal diagram (draw.io / Lucidchart) showing all security controls: Cognito, KMS, IAM roles, bucket policies, HTTPS enforcement |
| 3 | **Documentation & deployment guide** | 🔄 In progress | `infra/README.md` started (Phase 0). Full guide covers prerequisites, SAM deploy steps, env promotion, and rollback. |
| 4 | **Audit log export** | ⬜ Not started | Scheduled Lambda that exports `AuditLog-<env>` records to S3 (CSV/JSON), with a management runbook |

---

## Status Key

| Symbol | Meaning |
|---|---|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Complete |

---

## Deliverable Details

### 1. Demo Video
- Show a complete user journey for each role (Employee, Manager, HR Admin).
- Demonstrate: document upload (pre-signed URL flow), document listing, role-based access denial, and audit log review.
- Tool: Loom or OBS; target length ≤ 10 minutes.

### 2. Security Architecture Diagram
- Must cover: Cognito authentication, API Gateway authorization, Lambda RBAC, S3 bucket policies, KMS encryption, DynamoDB SSE, and audit logging.
- Two-bucket S3 design must be clearly labeled.
- Deliverable format: PNG/SVG export + editable source file (draw.io XML or Lucidchart).

### 3. Documentation & Deployment Guide
Current progress:
- [x] `infra/README.md` — naming conventions, S3 key structure, DynamoDB schema (Phase 0)
- [ ] Prerequisites section (AWS CLI, SAM CLI, Node/Python versions)
- [ ] Step-by-step `sam deploy` instructions for each environment
- [ ] Environment promotion runbook (dev → staging → prod)
- [ ] Rollback procedure
- [ ] Secrets / parameter management (SSM Parameter Store)

### 4. Audit Log Export
- Scheduled Lambda (EventBridge rule, e.g. nightly) scans/queries `AuditLog-<env>`.
- Exports records to `docvault-employee-documents-<env>-<account_id>/audit-exports/YYYY/MM/DD/audit.json`.
- Management runbook: how to trigger manually, how to verify integrity, retention policy.
