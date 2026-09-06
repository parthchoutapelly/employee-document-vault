/**
 * errorMessages.js
 *
 * Centralized mapping from API errors (or arbitrary JavaScript errors)
 * to sanitized, user-friendly messages.
 *
 * Guarantees that internal exception details, AWS request IDs, Cognito tokens,
 * presigned URLs, or raw server traces are never displayed in the UI.
 */
import { ApiError } from './api'

/**
 * Maps an error object to a clean, user-facing error message string.
 *
 * @param {unknown} err - Error object or ApiError
 * @param {string} [fallback='An unexpected error occurred. Please try again.']
 * @returns {string}
 */
export function getErrorMessage(err, fallback = 'An unexpected error occurred. Please try again.') {
  if (!err) return fallback

  // Special named error types take precedence
  const errorType = err?.errorType || (err instanceof ApiError ? err.errorType : null)
  if (errorType === 'S3UploadError') {
    return 'Failed to upload document file to storage. Please check your connection and retry.'
  }
  if (errorType === 'NetworkError') {
    return 'Network connection failed. Please verify your internet connection and try again.'
  }

  // Check HTTP status code
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : null

  if (status !== null) {
    switch (status) {
      case 400:
        return err.message && !err.message.includes('{')
          ? err.message
          : 'Invalid request. Please check your input and try again.'
      case 401:
        return 'Your session has expired or is invalid. Please sign in again.'
      case 403:
        return 'You do not have permission to access or modify this document.'
      case 404:
        return 'The requested document was not found or has already been removed.'
      case 409:
        return 'This document is currently pending upload or conflicts with another operation. Please try again later.'
      case 500:
      case 502:
      case 503:
      case 504:
        return 'The document service encountered an internal error. Please retry in a few moments.'
      case 0:
        return 'Network connection failed. Please verify your internet connection and try again.'
      default:
        break
    }
  }

  // Handle generic error instances
  if (err instanceof Error) {
    const rawMsg = err.message || ''

    // Suppress sensitive substrings
    if (
      rawMsg.includes('Signature') ||
      rawMsg.includes('Authorization') ||
      rawMsg.includes('Cognito') ||
      rawMsg.includes('X-Amz') ||
      rawMsg.includes('Token') ||
      rawMsg.includes('Credential')
    ) {
      return 'An authentication or authorization error occurred. Please sign in again.'
    }

    if (rawMsg.toLowerCase().includes('failed to fetch') || rawMsg.toLowerCase().includes('network')) {
      return 'Network connection failed. Please verify your internet connection and try again.'
    }

    // Clean, readable messages without technical traces
    if (rawMsg.length > 0 && rawMsg.length < 120 && !rawMsg.includes('\n') && !rawMsg.includes('{')) {
      return rawMsg
    }
  }

  return fallback
}
