"""
shared/xray.py — Guarded AWS X-Ray instrumentation helper for Employee Document Vault.
"""

import logging

logger = logging.getLogger(__name__)

_initialized = False


def init_xray() -> bool:
    """
    Initialize AWS X-Ray SDK patching if aws-xray-sdk is installed.

    Safe for both AWS Lambda production runtime (where aws-xray-sdk is installed)
    and zero-dependency local testing environments (where stdlib test runner executes).
    Never logs credentials, tokens, presigned URLs, or document contents.

    Returns:
        bool: True if patched successfully, False otherwise.
    """
    global _initialized
    if _initialized:
        return True

    try:
        from aws_xray_sdk.core import patch_all
        patch_all()
        _initialized = True
        logger.info("AWS X-Ray SDK patch_all() successfully initialized")
        return True
    except ImportError:
        logger.debug("aws_xray_sdk not installed; skipping X-Ray instrumentation")
        return False
    except Exception as exc:
        logger.warning("Failed to initialize AWS X-Ray SDK: %s", exc)
        return False
