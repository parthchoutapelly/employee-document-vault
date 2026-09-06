import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import DocumentUpload from '../DocumentUpload'
import { MAX_FILE_SIZE_BYTES } from '../../services/fileUtils'
import { AuthContext } from '../../context/AuthContext'
import * as api from '../../services/api'

vi.mock('../../services/api')

function renderDocumentUpload(authValue, props = {}) {
  return render(
    <AuthContext.Provider value={authValue}>
      <DocumentUpload {...props} />
    </AuthContext.Provider>
  )
}

describe('DocumentUpload component', () => {
  const MOCK_PRESIGNED_URL = 'https://s3.ap-south-1.amazonaws.com/docvault-bucket/test.pdf?X-Amz-Signature=secret123'
  let consoleLogSpy, consoleInfoSpy, consoleWarnSpy, consoleErrorSpy

  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(api, 'requestUpload').mockResolvedValue({
      document_id: 'new-doc-999',
      upload_url: MOCK_PRESIGNED_URL,
      s3_key: 'documents/EMP-001/resume/resume.pdf',
      expires_in: 900,
    })

    vi.spyOn(api, 'uploadFileToPresignedUrl').mockResolvedValue({
      success: true,
      status: 200,
    })

    consoleLogSpy = vi.spyOn(console, 'log')
    consoleInfoSpy = vi.spyOn(console, 'info')
    consoleWarnSpy = vi.spyOn(console, 'warn')
    consoleErrorSpy = vi.spyOn(console, 'error')
  })

  afterEach(() => {
    // Verify no presigned URLs were logged to any console output
    [consoleLogSpy, consoleInfoSpy, consoleWarnSpy, consoleErrorSpy].forEach((spy) => {
      spy.mock.calls.forEach((args) => {
        const text = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
        expect(text).not.toContain(MOCK_PRESIGNED_URL)
      })
      spy.mockRestore()
    })
  })

  it('renders document type selector, file input, and submit button disabled by default', () => {
    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    expect(screen.getByTestId('upload-type-select')).toBeInTheDocument()
    expect(screen.getByTestId('upload-file-input')).toBeInTheDocument()
    expect(screen.getByTestId('upload-submit-btn')).toBeDisabled()
  })

  it('rejects empty files (0 bytes) with a clear validation error', () => {
    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })
    const fileInput = screen.getByTestId('upload-file-input')

    fireEvent.change(fileInput, { target: { files: [emptyFile] } })

    expect(screen.getByTestId('upload-error')).toHaveTextContent(
      'The selected file is empty (0 bytes).'
    )
    expect(screen.queryByTestId('upload-file-preview')).not.toBeInTheDocument()
  })

  it('rejects files exceeding the maximum size limit (10MB)', () => {
    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    // Create mock file larger than MAX_FILE_SIZE_BYTES
    const oversizedFile = new File(['a'], 'giant_file.zip', { type: 'application/zip' })
    Object.defineProperty(oversizedFile, 'size', { value: MAX_FILE_SIZE_BYTES + 1024 })

    const fileInput = screen.getByTestId('upload-file-input')
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } })

    expect(screen.getByTestId('upload-error')).toHaveTextContent(/exceeds the maximum allowed limit/i)
    expect(screen.queryByTestId('upload-file-preview')).not.toBeInTheDocument()
  })

  it('displays selected filename and size in the preview card for valid files', () => {
    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    const validFile = new File(['hello world'], 'my_resume.pdf', { type: 'application/pdf' })
    const fileInput = screen.getByTestId('upload-file-input')

    fireEvent.change(fileInput, { target: { files: [validFile] } })

    expect(screen.getByTestId('upload-file-preview')).toBeInTheDocument()
    expect(screen.getByText('my_resume.pdf')).toBeInTheDocument()
  })

  it('executes full upload flow: POST /upload followed by direct S3 PUT', async () => {
    const onUploadSuccessMock = vi.fn()
    renderDocumentUpload(
      { employeeId: 'EMP-001', role: 'Employee' },
      { onUploadSuccess: onUploadSuccessMock }
    )

    const typeSelect = screen.getByTestId('upload-type-select')
    fireEvent.change(typeSelect, { target: { value: 'resume' } })

    const validFile = new File(['document binary data'], 'career_resume.pdf', {
      type: 'application/pdf',
    })
    const fileInput = screen.getByTestId('upload-file-input')
    fireEvent.change(fileInput, { target: { files: [validFile] } })

    const submitBtn = screen.getByTestId('upload-submit-btn')
    expect(submitBtn).not.toBeDisabled()
    fireEvent.click(submitBtn)

    await waitFor(() => {
      // Step 1: POST /upload called with authenticated employee_id and preserved filename
      expect(api.requestUpload).toHaveBeenCalledWith({
        employee_id: 'EMP-001',
        document_type: 'resume',
        filename: 'career_resume.pdf',
      })

      // Step 2: Direct-to-S3 PUT using returned presigned URL
      expect(api.uploadFileToPresignedUrl).toHaveBeenCalledWith(
        MOCK_PRESIGNED_URL,
        validFile
      )

      // Step 3: Success notification and callback
      expect(screen.getByTestId('upload-success')).toHaveTextContent(
        '"career_resume.pdf" uploaded successfully.'
      )
      expect(onUploadSuccessMock).toHaveBeenCalledTimes(1)
    })

    // Form resets after successful upload
    expect(screen.getByTestId('upload-type-select')).toHaveValue('')
    expect(screen.queryByTestId('upload-file-preview')).not.toBeInTheDocument()
  })

  it('surfaces S3 upload failure and does not report success or refresh list', async () => {
    const onUploadSuccessMock = vi.fn()
    vi.spyOn(api, 'uploadFileToPresignedUrl').mockRejectedValue(
      new Error('S3 direct upload rejected: 403 Forbidden')
    )

    renderDocumentUpload(
      { employeeId: 'EMP-001', role: 'Employee' },
      { onUploadSuccess: onUploadSuccessMock }
    )

    fireEvent.change(screen.getByTestId('upload-type-select'), { target: { value: 'id_proof' } })
    fireEvent.change(screen.getByTestId('upload-file-input'), {
      target: { files: [new File(['passport bytes'], 'passport.pdf', { type: 'application/pdf' })] },
    })

    fireEvent.click(screen.getByTestId('upload-submit-btn'))

    await waitFor(() => {
      expect(api.requestUpload).toHaveBeenCalled()
      expect(api.uploadFileToPresignedUrl).toHaveBeenCalled()
      expect(screen.getByTestId('upload-error')).toHaveTextContent(
        'S3 direct upload rejected: 403 Forbidden'
      )
      expect(screen.queryByTestId('upload-success')).not.toBeInTheDocument()
      expect(onUploadSuccessMock).not.toHaveBeenCalled()
    })
  })

  it('prevents S3 upload if POST /upload fails', async () => {
    vi.spyOn(api, 'requestUpload').mockRejectedValue(
      new Error('Upload initialization forbidden: unauthorized target employee')
    )

    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    fireEvent.change(screen.getByTestId('upload-type-select'), { target: { value: 'offer_letter' } })
    fireEvent.change(screen.getByTestId('upload-file-input'), {
      target: { files: [new File(['offer'], 'offer.pdf', { type: 'application/pdf' })] },
    })

    fireEvent.click(screen.getByTestId('upload-submit-btn'))

    await waitFor(() => {
      expect(api.requestUpload).toHaveBeenCalled()
      expect(api.uploadFileToPresignedUrl).not.toHaveBeenCalled()
      expect(screen.getByTestId('upload-error')).toHaveTextContent(
        'Upload initialization forbidden: unauthorized target employee'
      )
    })
  })

  it('resets form when Cancel button is clicked', () => {
    renderDocumentUpload({ employeeId: 'EMP-001', role: 'Employee' })

    fireEvent.change(screen.getByTestId('upload-type-select'), { target: { value: 'payslip' } })
    fireEvent.change(screen.getByTestId('upload-file-input'), {
      target: { files: [new File(['slip'], 'slip.pdf', { type: 'application/pdf' })] },
    })

    expect(screen.getByTestId('upload-file-preview')).toBeInTheDocument()
    const cancelBtn = screen.getByTestId('upload-cancel-btn')
    fireEvent.click(cancelBtn)

    expect(screen.getByTestId('upload-type-select')).toHaveValue('')
    expect(screen.queryByTestId('upload-file-preview')).not.toBeInTheDocument()
  })
})
