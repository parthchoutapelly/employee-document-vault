/**
 * DocumentUpload.jsx
 *
 * Dedicated component for uploading documents to the Employee Document Vault.
 *
 * Flow:
 *   1. Validate selected file (type, presence, non-zero size, max 10MB limit).
 *   2. POST /upload with { employee_id, document_type, filename } to obtain presigned S3 URL.
 *   3. PUT file directly to S3 presigned URL without passing through API Gateway.
 *   4. Notify parent on success so document list refreshes.
 *
 * Security:
 *   - Uses the authenticated user's employee_id from context (no manual override).
 *   - Never prints or logs the presigned upload URL or file contents.
 */
import { useState, useRef } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { requestUpload, uploadFileToPresignedUrl } from '../services/api'
import { DOCUMENT_TYPES, MAX_FILE_SIZE_BYTES, formatFileSize } from '../services/fileUtils'
import { getErrorMessage } from '../services/errorMessages'
import './DocumentUpload.css'

/**
 * @param {{ onUploadSuccess?: () => void }} props
 */
export default function DocumentUpload({ onUploadSuccess }) {
  const { employeeId } = useAuthContext()

  const [documentType, setDocumentType] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const fileInputRef = useRef(null)

  const resetForm = () => {
    setDocumentType('')
    setSelectedFile(null)
    setErrorMessage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = (e) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    const file = e.target.files?.[0] || null
    if (!file) {
      setSelectedFile(null)
      return
    }

    // Validation: Empty file check
    if (file.size === 0) {
      setErrorMessage('The selected file is empty (0 bytes). Please select a valid file.')
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    // Validation: Max size check
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File size (${formatFileSize(file.size)}) exceeds the maximum allowed limit of ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`
      )
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFile(file)
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    // Form validation
    if (!documentType) {
      setErrorMessage('Please select a document type.')
      return
    }
    if (!selectedFile) {
      setErrorMessage('Please choose a file to upload.')
      return
    }
    if (selectedFile.size === 0) {
      setErrorMessage('The selected file is empty (0 bytes).')
      return
    }
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(`File exceeds maximum size limit of ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`)
      return
    }
    if (!employeeId) {
      setErrorMessage('Authentication error: employee ID is missing.')
      return
    }

    setUploading(true)

    try {
      // Step 1: Request presigned upload URL from backend API
      const meta = await requestUpload({
        employee_id: employeeId,
        document_type: documentType,
        filename: selectedFile.name,
      })

      if (!meta?.upload_url) {
        throw new Error('Upload initialization failed: no upload URL returned by server.')
      }

      // Step 2: Direct-to-S3 PUT using the presigned URL
      await uploadFileToPresignedUrl(meta.upload_url, selectedFile)

      // Step 3: Success state & list refresh
      setSuccessMessage(`"${selectedFile.name}" uploaded successfully.`)
      resetForm()

      if (typeof onUploadSuccess === 'function') {
        onUploadSuccess()
      }
    } catch (err) {
      setErrorMessage(getErrorMessage(err, 'Failed to upload document. Please try again.'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="doc-upload" aria-labelledby="upload-heading">
      <div className="doc-upload__header">
        <div className="doc-upload__title-group">
          <div className="doc-upload__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 xmlns="http://www.w3.org/2000/svg">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="17 8 12 3 7 8"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="3" x2="12" y2="15"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h2 id="upload-heading" className="doc-upload__title">Upload Document</h2>
            <p className="doc-upload__desc">
              Files are encrypted at rest with AWS KMS and tied to your employee record.
            </p>
          </div>
        </div>
      </div>

      {/* Error feedback */}
      {errorMessage && (
        <div className="upload-alert upload-alert--error" role="alert" data-testid="upload-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span>{errorMessage}</span>
          <button
            type="button"
            className="upload-alert__close"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Success feedback */}
      {successMessage && (
        <div className="upload-alert upload-alert--success" role="status" data-testid="upload-success">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <span>{successMessage}</span>
          <button
            type="button"
            className="upload-alert__close"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss success notice"
          >
            ×
          </button>
        </div>
      )}

      <form className="doc-upload__form" onSubmit={handleUpload} noValidate>
        <div className="doc-upload__controls">
          {/* Document Type Field */}
          <div className="doc-upload__field">
            <label className="doc-upload__label" htmlFor="doc-type-select">
              Document Type <span className="req-star" aria-hidden="true">*</span>
            </label>
            <select
              id="doc-type-select"
              className="doc-upload__select"
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value)
                setErrorMessage(null)
              }}
              disabled={uploading}
              aria-required="true"
              data-testid="upload-type-select"
            >
              <option value="">Choose document type…</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* File Picker Field */}
          <div className="doc-upload__field">
            <label className="doc-upload__label" htmlFor="doc-file-input">
              File Selection <span className="req-star" aria-hidden="true">*</span>
            </label>
            <input
              id="doc-file-input"
              ref={fileInputRef}
              type="file"
              className="doc-upload__file-input"
              onChange={handleFileChange}
              disabled={uploading}
              aria-required="true"
              data-testid="upload-file-input"
            />
          </div>
        </div>

        {/* Selected file summary card */}
        {selectedFile && (
          <div className="doc-upload__file-preview" data-testid="upload-file-preview">
            <div className="doc-upload__file-preview-info">
              <span className="doc-upload__file-preview-name" title={selectedFile.name}>
                {selectedFile.name}
              </span>
              <span className="doc-upload__file-preview-size">
                ({formatFileSize(selectedFile.size)})
              </span>
            </div>
            <button
              type="button"
              className="doc-upload__file-remove-btn"
              onClick={() => {
                setSelectedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={uploading}
              aria-label="Remove selected file"
            >
              Remove
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="doc-upload__actions">
          {(selectedFile || documentType) && !uploading && (
            <button
              id="upload-cancel-btn"
              type="button"
              className="doc-upload__btn doc-upload__btn--cancel"
              onClick={resetForm}
              data-testid="upload-cancel-btn"
            >
              Cancel
            </button>
          )}

          <button
            id="upload-submit-btn"
            type="submit"
            className="doc-upload__btn doc-upload__btn--submit"
            disabled={uploading || !selectedFile || !documentType}
            aria-busy={uploading}
            data-testid="upload-submit-btn"
          >
            {uploading ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Upload Document
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  )
}
