import { describe, it, expect } from 'vitest'
import { getErrorMessage } from '../errorMessages'
import { ApiError } from '../api'

describe('errorMessages service', () => {
  it('returns fallback for null or undefined input', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred. Please try again.')
    expect(getErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback')
  })

  it('maps 400 Bad Request', () => {
    const err = new ApiError('filename is required', 400, 'BadRequest')
    expect(getErrorMessage(err)).toBe('filename is required')

    const errJson = new ApiError('{"raw": "json"}', 400, 'BadRequest')
    expect(getErrorMessage(errJson)).toBe('Invalid request. Please check your input and try again.')
  })

  it('maps 401 Unauthorized to sign-in prompt', () => {
    const err = new ApiError('Token expired', 401, 'Unauthorized')
    expect(getErrorMessage(err)).toBe('Your session has expired or is invalid. Please sign in again.')
  })

  it('maps 403 Forbidden to permission warning without exposing backend details', () => {
    const err = new ApiError('checkAccess failed for EMP-002 against policy', 403, 'Forbidden')
    expect(getErrorMessage(err)).toBe('You do not have permission to access or modify this document.')
  })

  it('maps 404 NotFound to document missing notice', () => {
    const err = new ApiError('Document metadata missing in table', 404, 'NotFound')
    expect(getErrorMessage(err)).toBe('The requested document was not found or has already been removed.')
  })

  it('maps 409 Conflict to pending upload or conflict notice', () => {
    const err = new ApiError('Document is PENDING_UPLOAD', 409, 'Conflict')
    expect(getErrorMessage(err)).toBe(
      'This document is currently pending upload or conflicts with another operation. Please try again later.'
    )
  })

  it('maps 5xx server errors to friendly retry notice', () => {
    const err500 = new ApiError('DynamoDB internal timeout', 500, 'InternalServerError')
    expect(getErrorMessage(err500)).toBe(
      'The document service encountered an internal error. Please retry in a few moments.'
    )

    const err503 = new ApiError('Service Unavailable', 503)
    expect(getErrorMessage(err503)).toBe(
      'The document service encountered an internal error. Please retry in a few moments.'
    )
  })

  it('maps S3UploadError to storage upload notice', () => {
    const err = new ApiError('S3 upload rejected', 400, 'S3UploadError')
    expect(getErrorMessage(err)).toBe(
      'Failed to upload document file to storage. Please check your connection and retry.'
    )
  })

  it('maps NetworkError to connectivity notice', () => {
    const err = new ApiError('Failed to fetch', 0, 'NetworkError')
    expect(getErrorMessage(err)).toBe(
      'Network connection failed. Please verify your internet connection and try again.'
    )
  })

  it('sanitizes errors containing sensitive words like Signature or Cognito tokens', () => {
    const sensitiveErr = new Error(
      'SignatureDoesNotMatch: AWS4-HMAC-SHA256 Credential=AKIA123/20260906/ap-south-1/s3/aws4_request'
    )
    expect(getErrorMessage(sensitiveErr)).toBe(
      'An authentication or authorization error occurred. Please sign in again.'
    )
  })
})
