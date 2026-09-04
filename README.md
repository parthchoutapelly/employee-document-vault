# Employee Document Vault

A serverless HR document management system built on AWS (S3, DynamoDB, Cognito, Lambda, API Gateway) using **AWS SAM**.

- **Region:** `ap-south-1`
- **AWS CLI profile:** `docvault`

## Repository Structure

```
.
├── infra/          # SAM template and infrastructure documentation
├── backend/        # Lambda function source code (Phase 2)
├── frontend/       # Web frontend (Phase 3)
└── docs/           # Architecture sketches, deliverables checklist
```

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository scaffold, SAM template (storage layer only) | ✅ Complete |
| 1 | SAM deploy of storage layer to `dev` | ⬜ |
| 2 | Lambda functions + API Gateway + Cognito | ⬜ |
| 3 | Frontend (React) + CloudFront | ⬜ |
| 4 | CI/CD pipeline | ⬜ |
| 5 | Audit log export + security diagram + deliverables | ⬜ |

## Quick Links

- [Infrastructure README](infra/README.md)
- [Architecture Overview](docs/architecture.md)
- [Deliverables Checklist](docs/deliverables.md)
