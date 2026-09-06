import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as amplifyAuth from 'aws-amplify/auth';
import {
  listFiles,
  requestUpload,
  getDownloadUrl,
  deleteFile,
  uploadFileToPresignedUrl,
  updateDocumentTags,
  getDocumentVersions,
  getActivity,
  getAuthHeaders,
  ApiError,
  getApiBaseUrl,
} from '../api';

vi.mock('aws-amplify/auth');

describe('API client (services/api.js)', () => {
  const MOCK_TOKEN = 'mock-cognito-id-token-abc123xyz';
  const BASE_URL = getApiBaseUrl();

  let consoleLogSpy;
  let consoleInfoSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock session returning token
    vi.spyOn(amplifyAuth, 'fetchAuthSession').mockResolvedValue({
      tokens: {
        idToken: {
          toString: () => MOCK_TOKEN,
        },
      },
    });

    // Console spies to ensure no tokens or secrets are logged
    consoleLogSpy = vi.spyOn(console, 'log');
    consoleInfoSpy = vi.spyOn(console, 'info');
    consoleWarnSpy = vi.spyOn(console, 'warn');
    consoleErrorSpy = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    // Assert that the mock token was NEVER printed to any console stream
    [consoleLogSpy, consoleInfoSpy, consoleWarnSpy, consoleErrorSpy].forEach((spy) => {
      spy.mock.calls.forEach((args) => {
        const text = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        expect(text).not.toContain(MOCK_TOKEN);
      });
      spy.mockRestore();
    });
  });

  describe('getAuthHeaders', () => {
    it('returns Authorization header with Bearer token', async () => {
      const headers = await getAuthHeaders();
      expect(headers).toEqual({
        Authorization: `Bearer ${MOCK_TOKEN}`,
      });
    });

    it('throws ApiError with 401 when no token is available', async () => {
      vi.spyOn(amplifyAuth, 'fetchAuthSession').mockResolvedValue({});
      await expect(getAuthHeaders()).rejects.toThrowError(ApiError);
      try {
        await getAuthHeaders();
      } catch (err) {
        expect(err.status).toBe(401);
        expect(err.isUnauthorized).toBe(true);
      }
    });

    it('normalizes tokens that already contain Bearer prefix without duplicating it', async () => {
      vi.spyOn(amplifyAuth, 'fetchAuthSession').mockResolvedValue({
        tokens: { idToken: `Bearer ${MOCK_TOKEN}` },
      });
      const headers = await getAuthHeaders();
      expect(headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(headers.Authorization).not.toContain('Bearer Bearer');
    });

    it('throws 401 when token is an invalid object string representation or null', async () => {
      vi.spyOn(amplifyAuth, 'fetchAuthSession').mockResolvedValue({
        tokens: { idToken: '[object Object]' },
      });
      await expect(getAuthHeaders()).rejects.toThrow(ApiError);
    });
  });

  describe('listFiles', () => {
    it('sends GET /files with encoded employee_id and Authorization header', async () => {
      const mockResponse = {
        employee_id: 'EMP-001',
        documents: [
          { document_id: 'doc-1', filename: 'resume.pdf', status: 'AVAILABLE' },
        ],
        count: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await listFiles('EMP-001');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/files?employee_id=EMP-001`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(options.headers['Content-Type']).toBeUndefined(); // no body sent
      expect(result).toEqual(mockResponse);
    });

    it('properly URL-encodes special characters in employee_id', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ documents: [] }),
      });

      await listFiles('EMP+001/special');
      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/files?employee_id=EMP%2B001%2Fspecial`);
    });

    it('throws 400 ApiError when employee_id is missing', async () => {
      await expect(listFiles('')).rejects.toThrowError(ApiError);
      try {
        await listFiles('');
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });
  });

  describe('requestUpload', () => {
    it('sends POST /upload with JSON body and Content-Type header', async () => {
      const payload = {
        employee_id: 'EMP-001',
        document_type: 'resume',
        filename: 'cv.pdf',
      };

      const mockResponse = {
        document_id: 'new-doc-123',
        upload_url: 'https://s3.ap-south-1.amazonaws.com/presigned-upload-url',
        s3_key: 'documents/EMP-001/resume/cv.pdf',
        expires_in: 900,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await requestUpload(payload);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/upload`);
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(payload));
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getDownloadUrl', () => {
    it('sends GET /download/{doc_id} with encoded docId', async () => {
      const docId = 'doc-uuid-123';
      const mockResponse = {
        document_id: docId,
        download_url: 'https://s3.ap-south-1.amazonaws.com/presigned-download-url',
        filename: 'report.pdf',
        document_type: 'report',
        expires_in: 900,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await getDownloadUrl(docId);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/download/${docId}`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(result).toEqual(mockResponse);
    });

    it('properly encodes path parameter', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });

      await getDownloadUrl('doc/special+1');
      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/download/doc%2Fspecial%2B1`);
    });

    it('appends version_id query parameter when versionId is provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          document_id: 'doc-123',
          version_id: 'v-s3-ver-999',
          download_url: 'https://s3.ap-south-1.amazonaws.com/presigned-version-url',
        }),
      });

      await getDownloadUrl('doc-123', 'v-s3-ver-999');
      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/download/doc-123?version_id=v-s3-ver-999`);
    });
  });

  describe('deleteFile', () => {
    it('sends DELETE /files/{doc_id}', async () => {
      const docId = 'doc-to-delete-456';
      const mockResponse = {
        message: 'Document deleted successfully',
        document_id: docId,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await deleteFile(docId);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/files/${docId}`);
      expect(options.method).toBe('DELETE');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('uploadFileToPresignedUrl', () => {
    it('executes PUT directly to uploadUrl with Content-Type and NO Authorization header', async () => {
      const mockS3Url = 'https://s3.ap-south-1.amazonaws.com/docvault-bucket/doc.pdf';
      const mockFile = new File(['file contents'], 'resume.pdf', { type: 'application/pdf' });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const res = await uploadFileToPresignedUrl(mockS3Url, mockFile);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(mockS3Url);
      expect(options.method).toBe('PUT');
      expect(options.headers['Content-Type']).toBe('application/pdf');
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.body).toBe(mockFile);
      expect(res).toEqual({ success: true, status: 200 });
    });

    it('attaches x-amz-server-side-encryption header when signed in X-Amz-SignedHeaders', async () => {
      const mockS3Url =
        'https://s3.ap-south-1.amazonaws.com/bucket/key?X-Amz-SignedHeaders=host%3Bx-amz-server-side-encryption';
      const mockFile = new File(['text content'], 'notes.txt', { type: 'text/plain' });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await uploadFileToPresignedUrl(mockS3Url, mockFile);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['x-amz-server-side-encryption']).toBe('aws:kms');
    });

    it('attaches required KMS headers (SSE and SSEKMSKeyId) when passed via extraHeaders', async () => {
      const mockS3Url = 'https://s3.ap-south-1.amazonaws.com/docvault-bucket/doc.pdf';
      const mockFile = new File(['file contents'], 'resume.pdf', { type: 'application/pdf' });
      const extraHeaders = {
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': '40ee685d-515e-48b4-891f-6142ff9c97e2',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await uploadFileToPresignedUrl(mockS3Url, mockFile, extraHeaders);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/pdf');
      expect(options.headers['x-amz-server-side-encryption']).toBe('aws:kms');
      expect(options.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe(
        '40ee685d-515e-48b4-891f-6142ff9c97e2'
      );
      expect(options.headers.Authorization).toBeUndefined();
    });

    it('never forwards Authorization header to S3 even if included in extraHeaders', async () => {
      const mockS3Url = 'https://s3.ap-south-1.amazonaws.com/docvault-bucket/doc.pdf';
      const mockFile = new File(['file contents'], 'resume.pdf', { type: 'application/pdf' });
      const extraHeaders = {
        Authorization: 'Bearer leaked-token',
        authorization: 'Bearer leaked-token-lower',
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': '40ee685d-515e-48b4-891f-6142ff9c97e2',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await uploadFileToPresignedUrl(mockS3Url, mockFile, extraHeaders);

      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.headers.authorization).toBeUndefined();
      expect(options.headers['x-amz-server-side-encryption']).toBe('aws:kms');
      expect(options.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe(
        '40ee685d-515e-48b4-891f-6142ff9c97e2'
      );
    });

    it('throws ApiError with S3UploadError when S3 responds with non-2xx status', async () => {
      const mockS3Url = 'https://s3.ap-south-1.amazonaws.com/bucket/key';
      const mockFile = new File(['content'], 'file.txt', { type: 'text/plain' });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      try {
        await uploadFileToPresignedUrl(mockS3Url, mockFile);
        expect.fail('Should have thrown S3UploadError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(403);
        expect(err.errorType).toBe('S3UploadError');
        expect(err.message).toContain('Storage upload failed with status 403');
      }
    });

    it('rejects with 400 ApiError when uploadUrl or file is missing', async () => {
      await expect(uploadFileToPresignedUrl('', new File([], 'f.txt'))).rejects.toThrow(ApiError);
      await expect(uploadFileToPresignedUrl('https://example.com', null)).rejects.toThrow(ApiError);
    });
  });

  describe('updateDocumentTags', () => {
    it('sends PATCH /files/{doc_id} with JSON body and Authorization header', async () => {
      const mockResponse = {
        message: 'Tags updated successfully',
        document_id: 'doc-123',
        tags: ['Confidential', 'Finance'],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const res = await updateDocumentTags('doc-123', ['Confidential', 'Finance']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/files/doc-123`);
      expect(options.method).toBe('PATCH');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ tags: ['Confidential', 'Finance'] });
      expect(res).toEqual(mockResponse);
    });

    it('rejects with 400 when docId is missing or tags is not an array', async () => {
      await expect(updateDocumentTags('', ['tag'])).rejects.toThrow(ApiError);
      await expect(updateDocumentTags('doc-1', 'not-an-array')).rejects.toThrow(ApiError);
    });
  });

  describe('getDocumentVersions', () => {
    it('sends GET /files/{doc_id}/versions with Authorization header', async () => {
      const mockResponse = {
        document_id: 'doc-123',
        filename: 'resume.pdf',
        versions: [
          { version_id: 'v2', last_modified: '2026-09-06T10:00:00Z', is_latest: true },
        ],
        count: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const res = await getDocumentVersions('doc-123');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/files/doc-123/versions`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(res).toEqual(mockResponse);
    });

    it('rejects with 400 when docId is missing', async () => {
      await expect(getDocumentVersions('')).rejects.toThrow(ApiError);
    });
  });

  describe('getActivity', () => {
    it('sends GET /activity with Authorization header', async () => {
      const mockResponse = {
        activity: [
          {
            log_id: 'log-1',
            action: 'UPLOAD_REQUESTED',
            result: 'SUCCESS',
            timestamp: 1772700000000,
          },
        ],
        count: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await getActivity();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/activity`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(result).toEqual(mockResponse);
    });

    it('appends query parameters when employee_id and limit are provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ activity: [], count: 0 }),
      });

      await getActivity({ employee_id: 'EMP-002', limit: 25 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/activity?employee_id=EMP-002&limit=25`);
    });

    it('uses the same auth/session mechanism as existing API calls (fetchAuthSession)', async () => {
      const authSpy = vi.spyOn(amplifyAuth, 'fetchAuthSession');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ activity: [], count: 0 }),
      });

      await getActivity();
      expect(authSpy).toHaveBeenCalled();
    });

    it('handles missing/expired authentication consistently (throws 401 ApiError)', async () => {
      vi.spyOn(amplifyAuth, 'fetchAuthSession').mockResolvedValue({});
      await expect(getActivity()).rejects.toThrow(ApiError);
      try {
        await getActivity();
      } catch (err) {
        expect(err.status).toBe(401);
        expect(err.isUnauthorized).toBe(true);
      }
    });

    it('ensures Authorization header strictly starts with Bearer and contains clean token', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ activity: [], count: 0 }),
      });

      await getActivity();
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers.Authorization).toMatch(/^Bearer [a-zA-Z0-9._-]+$/);
      expect(options.headers.Authorization).not.toContain('Bearer Bearer');
      expect(options.headers.Authorization).not.toContain('[object');
    });
  });

  describe('Centralized error handling & status distinction', () => {
    it('handles 401 Unauthorized', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Unauthorized', message: 'Token expired' }),
      });

      try {
        await listFiles('EMP-001');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(401);
        expect(err.message).toBe('Token expired');
        expect(err.errorType).toBe('Unauthorized');
        expect(err.isUnauthorized).toBe(true);
        expect(err.isForbidden).toBe(false);
      }
    });

    it('handles 403 Forbidden', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: 'Forbidden',
          message: 'You are not authorized to view documents for this employee',
        }),
      });

      try {
        await listFiles('EMP-002');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(403);
        expect(err.isForbidden).toBe(true);
        expect(err.isUnauthorized).toBe(false);
        expect(err.message).toContain('not authorized');
      }
    });

    it('handles 404 NotFound', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'NotFound', message: 'Document not found' }),
      });

      try {
        await getDownloadUrl('non-existent-doc');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(404);
        expect(err.isNotFound).toBe(true);
        expect(err.message).toBe('Document not found');
      }
    });

    it('handles 409 Conflict', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: 'Conflict',
          message: 'Document upload is pending and not yet available for download',
        }),
      });

      try {
        await getDownloadUrl('pending-doc-id');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(409);
        expect(err.isConflict).toBe(true);
        expect(err.message).toContain('pending');
      }
    });

    it('handles 500 Internal Server Error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: 'InternalServerError',
          message: 'An unexpected error occurred',
        }),
      });

      try {
        await deleteFile('doc-err');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(500);
        expect(err.isServerError).toBe(true);
        expect(err.message).toBe('An unexpected error occurred');
      }
    });

    it('handles network failure gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      try {
        await listFiles('EMP-001');
        expect.fail('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(0);
        expect(err.errorType).toBe('NetworkError');
      }
    });
  });
});
