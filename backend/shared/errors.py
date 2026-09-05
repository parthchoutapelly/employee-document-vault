"""
shared/errors.py — Consistent API response and error formatting for Employee Document Vault
"""

import json
from typing import Any, Dict, Optional

DEFAULT_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}


def response(status_code: int, body: Any, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Build a standard API Gateway proxy response dictionary."""
    merged_headers = {**DEFAULT_HEADERS, **(headers or {})}
    return {
        "statusCode": status_code,
        "headers": merged_headers,
        "body": json.dumps(body),
    }


def success(body: Any, status_code: int = 200) -> Dict[str, Any]:
    """200 OK / 201 Created response helper."""
    return response(status_code, body)


def bad_request(message: str = "Invalid request", details: Optional[Any] = None) -> Dict[str, Any]:
    """400 Bad Request error response."""
    payload: Dict[str, Any] = {"error": "BadRequest", "message": message}
    if details:
        payload["details"] = details
    return response(400, payload)


def unauthorized(message: str = "Unauthorized") -> Dict[str, Any]:
    """401 Unauthorized error response."""
    return response(401, {"error": "Unauthorized", "message": message})


def forbidden(message: str = "Forbidden") -> Dict[str, Any]:
    """403 Forbidden error response."""
    return response(403, {"error": "Forbidden", "message": message})


def not_found(message: str = "Document not found") -> Dict[str, Any]:
    """404 Not Found error response."""
    return response(404, {"error": "NotFound", "message": message})


def conflict(message: str = "Conflict") -> Dict[str, Any]:
    """409 Conflict error response."""
    return response(409, {"error": "Conflict", "message": message})


def internal_error(message: str = "An unexpected error occurred") -> Dict[str, Any]:
    """
    500 Internal Server Error response.
    Never exposes internal exception messages, stack traces, AWS credentials, or KMS details.
    """
    return response(500, {"error": "InternalServerError", "message": message})
