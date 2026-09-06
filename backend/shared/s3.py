"""
shared/s3.py — S3 and presigned-URL helpers for Employee Document Vault
"""

import re
import logging
from typing import Any, Optional, Dict

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal or invalid characters in S3 keys.
    Extracts the basename and strips dangerous characters.
    """
    clean_name = filename.replace("\\", "/").split("/")[-1]
    clean_name = re.sub(r"[^a-zA-Z0-9._-]", "_", clean_name)
    return clean_name or "document"


def build_s3_key(employee_id: str, document_type: str, filename: str) -> str:
    """
    Build canonical S3 object key adhering to project convention:
        documents/{employee_id}/{document_type}/{filename}
    """
    clean_type = re.sub(r"[^a-zA-Z0-9_-]", "_", document_type.strip()) or "general"
    clean_fn = sanitize_filename(filename)
    return f"documents/{employee_id}/{clean_type}/{clean_fn}"


def generate_presigned_upload_url(
    s3_client: Any,
    bucket: str,
    key: str,
    expires_in: int = 900,
    kms_key_id: Optional[str] = None,
) -> str:
    """
    Generate an S3 presigned PUT URL for direct-to-S3 browser upload.

    Parameters
    ----------
    s3_client : boto3.client('s3')
    bucket : S3 bucket name
    key : Destination S3 object key
    expires_in : URL expiration in seconds (default: 15 minutes)
    kms_key_id : KMS Key ARN or ID to enforce SSE-KMS on upload

    Returns
    -------
    Presigned upload URL string
    """
    params: Dict[str, Any] = {
        "Bucket": bucket,
        "Key": key,
    }
    if kms_key_id:
        params["ServerSideEncryption"] = "aws:kms"
        params["SSEKMSKeyId"] = kms_key_id

    return s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def generate_presigned_download_url(
    s3_client: Any,
    bucket: str,
    key: str,
    expires_in: int = 900,
    filename: Optional[str] = None,
    version_id: Optional[str] = None,
) -> str:
    """
    Generate an S3 presigned GET URL for direct-from-S3 download.

    Parameters
    ----------
    s3_client : boto3.client('s3')
    bucket : S3 bucket name
    key : Source S3 object key
    expires_in : URL expiration in seconds (default: 15 minutes)
    filename : Optional original filename for Content-Disposition header
    version_id : Optional S3 object version ID to download specific version

    Returns
    -------
    Presigned download URL string
    """
    params: Dict[str, Any] = {
        "Bucket": bucket,
        "Key": key,
    }
    if filename:
        clean_fn = sanitize_filename(filename)
        params["ResponseContentDisposition"] = f'attachment; filename="{clean_fn}"'
    if version_id:
        params["VersionId"] = version_id

    return s3_client.generate_presigned_url(
        ClientMethod="get_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def delete_s3_object(s3_client: Any, bucket: str, key: str) -> Dict[str, Any]:
    """
    Perform a version-safe delete of an object in S3.
    This creates an S3 Delete Marker without deleting noncurrent versions,
    preserving full S3 versioning and audit history.
    """
    return s3_client.delete_object(
        Bucket=bucket,
        Key=key,
    )
