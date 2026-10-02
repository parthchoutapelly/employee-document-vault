# backend/shared — centralized helpers for Phase 2+ Lambda functions
from shared.xray import init_xray

# Automatically initialize X-Ray patching when shared package is loaded in Lambda
init_xray()
