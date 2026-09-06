/**
 * api.js
 *
 * Frontend API client for the Employee Document Vault backend.
 *
 * Security & Design Rules:
 *   - Obtains a fresh Cognito ID token via Amplify fetchAuthSession().
 *   - Sends `Authorization: Bearer <ID token>` on all authenticated calls.
 *   - Never logs tokens, credentials, or presigned URLs to the console.
 *   - Throws structured ApiError instances with HTTP status and backend message.
 */
import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Custom error class representing an API failure.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} [errorType='ApiError']
   * @param {unknown} [details=null]
   */
  constructor(message, status, errorType = 'ApiError', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorType = errorType;
    this.details = details;
  }

  get isUnauthorized() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isNotFound() { return this.status === 404; }
  get isConflict() { return this.status === 409; }
  get isServerError() { return this.status >= 500; }
}

/**
 * Returns the configured API base URL without trailing slashes.
 * @returns {string}
 */
export function getApiBaseUrl() {
  const url = import.meta.env.VITE_API_URL || 'https://dedgatnnc2.execute-api.ap-south-1.amazonaws.com/v1';
  return url.replace(/\/+$/, '');
}

/**
 * Retrieve current Cognito ID token string from Amplify session.
 * Always returns a clean, trimmed token string or null.
 *
 * @returns {Promise<string|null>}
 */
export async function getIdToken() {
  try {
    const session = await fetchAuthSession();
    const idToken = session?.tokens?.idToken;
    if (!idToken) return null;

    let tokenStr = '';
    if (typeof idToken === 'string') {
      tokenStr = idToken;
    } else if (typeof idToken.toString === 'function') {
      tokenStr = idToken.toString();
    }

    tokenStr = (tokenStr || '').trim();

    // Guard against malformed or non-string representations
    if (!tokenStr || tokenStr === '[object Object]' || tokenStr === 'undefined' || tokenStr === 'null') {
      return null;
    }

    // Strip accidental "Bearer " prefix so getIdToken strictly returns the raw token
    if (tokenStr.startsWith('Bearer ')) {
      tokenStr = tokenStr.slice(7).trim();
    }

    return tokenStr || null;
  } catch {
    return null;
  }
}

/**
 * Build request headers including Bearer Authorization.
 * Validates that the token exists and constructs a clean "Bearer <ID_TOKEN>" header.
 *
 * Invariants:
 *   - Never undefined/null
 *   - Never raw token without "Bearer "
 *   - Never an object or stringified object
 *   - Never duplicated as "Bearer Bearer ..."
 *   - Never populated with any unrelated auth/session value
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function getAuthHeaders() {
  const token = await getIdToken();
  if (!token) {
    throw new ApiError('Authentication required: no active ID token found.', 401, 'Unauthorized');
  }

  let cleanToken = String(token).trim();
  // Strip any accidental "Bearer " prefix before standardizing
  while (cleanToken.toLowerCase().startsWith('bearer ')) {
    cleanToken = cleanToken.slice(7).trim();
  }

  if (!cleanToken || cleanToken === '[object Object]' || cleanToken === 'undefined' || cleanToken === 'null') {
    throw new ApiError('Authentication required: invalid ID token format.', 401, 'Unauthorized');
  }

  return {
    Authorization: `Bearer ${cleanToken}`,
  };
}

/**
 * Centralized fetch helper.
 * Automatically adds authorization headers and JSON content type when appropriate.
 *
 * @param {string} path - Relative endpoint path, e.g. '/files'
 * @param {RequestInit & { body?: unknown }} [options={}]
 * @returns {Promise<any>}
 */
async function apiRequest(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}`;

  const authHeaders = await getAuthHeaders();
  const headers = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  // Ensure Authorization header is strictly formatted as "Bearer <token>"
  if (headers.Authorization) {
    let authHeader = String(headers.Authorization).trim();
    while (authHeader.toLowerCase().startsWith('bearer bearer ')) {
      authHeader = 'Bearer ' + authHeader.slice(14).trim();
    }
    if (!authHeader.startsWith('Bearer ')) {
      authHeader = `Bearer ${authHeader}`;
    }
    headers.Authorization = authHeader;
  }

  const fetchOptions = {
    ...options,
    headers,
  };

  // Only attach Content-Type: application/json when sending a JSON payload
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (networkErr) {
    throw new ApiError(
      networkErr?.message || 'Network error: failed to connect to API server.',
      0,
      'NetworkError'
    );
  }

  // Parse response body if JSON
  let body = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const status = res.status;
    const defaultMessages = {
      400: 'Invalid request',
      401: 'Unauthorized: missing or invalid authentication token',
      403: 'Forbidden: you do not have permission for this resource',
      404: 'Resource not found',
      409: 'Conflict with the current state of the resource',
      500: 'Internal server error',
    };
    const message = body?.message || defaultMessages[status] || `Request failed with status ${status}`;
    const errorType = body?.error || (status >= 500 ? 'InternalServerError' : 'ApiError');
    throw new ApiError(message, status, errorType, body?.details);
  }

  return body;
}

/**
 * List active documents for an employee.
 * Backend contract: GET /files?employee_id=<employeeId>
 *
 * @param {string} employeeId
 * @returns {Promise<{ employee_id: string, documents: Array<any>, count: number }>}
 */
export async function listFiles(employeeId) {
  if (!employeeId || typeof employeeId !== 'string') {
    throw new ApiError('employee_id is required', 400, 'BadRequest');
  }
  const query = `?employee_id=${encodeURIComponent(employeeId.trim())}`;
  return apiRequest(`/files${query}`, { method: 'GET' });
}

/**
 * Request a presigned upload URL and initialize document metadata.
 * Backend contract: POST /upload
 *
 * @param {{ employee_id: string, document_type: string, filename: string }} payload
 * @returns {Promise<{ document_id: string, upload_url: string, s3_key: string, expires_in: number }>}
 */
export async function requestUpload(payload) {
  return apiRequest('/upload', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Retrieve a presigned download URL for a document.
 * Backend contract: GET /download/{doc_id} or GET /download/{doc_id}?version_id={version_id}
 *
 * @param {string} docId
 * @param {string} [versionId=null]
 * @returns {Promise<{ document_id: string, download_url: string, filename: string, document_type: string, version_id?: string, expires_in: number }>}
 */
export async function getDownloadUrl(docId, versionId = null) {
  if (!docId || typeof docId !== 'string') {
    throw new ApiError('doc_id is required', 400, 'BadRequest');
  }
  const cleanDocId = encodeURIComponent(docId.trim());
  const query = versionId && String(versionId).trim()
    ? `?version_id=${encodeURIComponent(String(versionId).trim())}`
    : '';
  return apiRequest(`/download/${cleanDocId}${query}`, {
    method: 'GET',
  });
}

/**
 * Soft-delete a document (creates S3 delete marker and marks metadata as DELETED).
 * Backend contract: DELETE /files/{doc_id}
 *
 * @param {string} docId
 * @returns {Promise<{ message: string, document_id: string }>}
 */
export async function deleteFile(docId) {
  if (!docId || typeof docId !== 'string') {
    throw new ApiError('doc_id is required', 400, 'BadRequest');
  }
  return apiRequest(`/files/${encodeURIComponent(docId.trim())}`, {
    method: 'DELETE',
  });
}

/**
 * Upload a file directly to an S3 presigned PUT URL.
 *
 * Rules:
 *   - Direct S3 PUT — bypasses API Gateway and Lambda.
 *   - Does NOT attach Cognito Authorization headers.
 *   - Sets Content-Type according to file.type.
 *   - Automatically attaches required KMS headers returned by /upload or in URL.
 *   - Never logs the presigned URL.
 *
 * @param {string} uploadUrl - Presigned S3 PUT URL
 * @param {File|Blob} file - File or Blob instance
 * @param {Record<string, string>} [extraHeaders={}] - Additional signed headers (e.g. KMS headers from POST /upload)
 * @returns {Promise<{ success: boolean, status: number }>}
 */
export async function uploadFileToPresignedUrl(uploadUrl, file, extraHeaders = {}) {
  if (!uploadUrl || typeof uploadUrl !== 'string') {
    throw new ApiError('Upload URL is required', 400, 'BadRequest');
  }
  if (!file) {
    throw new ApiError('File is required', 400, 'BadRequest');
  }

  const headers = {
    'Content-Type': file.type || 'application/octet-stream',
  };

  // Inspect signed headers in the presigned query string to satisfy S3 KMS signature
  try {
    const urlObj = new URL(uploadUrl, typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
    const signed = (urlObj.searchParams.get('X-Amz-SignedHeaders') || '').toLowerCase().split(';');
    if (signed.includes('x-amz-server-side-encryption')) {
      headers['x-amz-server-side-encryption'] = 'aws:kms';
    }
  } catch {
    // Relative or test mock URL — continue safely
  }

  // Merge required signed headers (e.g., KMS key ID and SSE encryption from POST /upload)
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const [key, value] of Object.entries(extraHeaders)) {
      // Security guard: Never leak Cognito Authorization or token headers to S3
      if (key.toLowerCase() !== 'authorization' && value != null) {
        headers[key] = String(value);
      }
    }
  }

  let res;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers,
      body: file,
    });
  } catch (networkErr) {
    throw new ApiError(
      networkErr?.message || 'Network error: failed to upload file to storage.',
      0,
      'NetworkError'
    );
  }

  if (!res.ok) {
    throw new ApiError(
      `Storage upload failed with status ${res.status}: ${res.statusText || 'Upload rejected'}`,
      res.status,
      'S3UploadError'
    );
  }

  return { success: true, status: res.status };
}

/**
 * Update tags for a document.
 * Backend contract: PATCH /files/{doc_id}
 *
 * @param {string} docId
 * @param {Array<string>} tags
 * @returns {Promise<{ message: string, document_id: string, tags: Array<string> }>}
 */
export async function updateDocumentTags(docId, tags) {
  if (!docId || typeof docId !== 'string') {
    throw new ApiError('doc_id is required', 400, 'BadRequest');
  }
  if (!Array.isArray(tags)) {
    throw new ApiError('tags must be an array of strings', 400, 'BadRequest');
  }
  return apiRequest(`/files/${encodeURIComponent(docId.trim())}`, {
    method: 'PATCH',
    body: { tags },
  });
}

/**
 * Retrieve S3 object version history for a document.
 * Backend contract: GET /files/{doc_id}/versions
 *
 * @param {string} docId
 * @returns {Promise<{ document_id: string, filename: string, s3_key: string, versions: Array<any>, count: number }>}
 */
export async function getDocumentVersions(docId) {
  if (!docId || typeof docId !== 'string') {
    throw new ApiError('doc_id is required', 400, 'BadRequest');
  }
  return apiRequest(`/files/${encodeURIComponent(docId.trim())}/versions`, {
    method: 'GET',
  });
}

/**
 * Retrieve audit and security activity history.
 * Backend contract: GET /activity
 *
 * @param {Object} [params]
 * @param {string} [params.employee_id]
 * @param {number} [params.limit]
 * @returns {Promise<{ activity: Array<any>, count: number, total_available?: number }>}
 */
export async function getActivity(params = {}) {
  const query = new URLSearchParams();
  if (params.employee_id) query.set('employee_id', params.employee_id);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/activity${qs ? `?${qs}` : ''}`, {
    method: 'GET',
  });
}
