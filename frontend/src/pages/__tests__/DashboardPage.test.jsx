import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardPage from '../DashboardPage'
import { AuthContext } from '../../context/AuthContext'
import * as api from '../../services/api'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api')
  return {
    ...actual,
    listFiles: vi.fn(),
    getDownloadUrl: vi.fn(),
    deleteFile: vi.fn(),
    requestUpload: vi.fn(),
    uploadFileToPresignedUrl: vi.fn(),
    getActivity: vi.fn(),
  }
})

function renderDashboardPage(authValue) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('DashboardPage', () => {
  const mockDocuments = [
    {
      document_id: 'doc-123',
      employee_id: 'EMP-001',
      filename: 'resume_2026.pdf',
      document_type: 'resume',
      upload_timestamp: 1772767200000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/resume/resume_2026.pdf',
    },
    {
      document_id: 'doc-456',
      employee_id: 'EMP-001',
      filename: 'id_card.png',
      document_type: 'id_proof',
      upload_timestamp: 1772853600000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/id_proof/id_card.png',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: mockDocuments,
      count: 2,
    })
    vi.spyOn(api, 'getDownloadUrl').mockResolvedValue({
      document_id: 'doc-123',
      download_url: 'https://s3.ap-south-1.amazonaws.com/presigned-download-url',
      filename: 'resume_2026.pdf',
      document_type: 'resume',
      expires_in: 900,
    })
    vi.spyOn(api, 'deleteFile').mockResolvedValue({
      message: 'Document deleted successfully',
      document_id: 'doc-123',
    })
    vi.spyOn(api, 'getActivity').mockResolvedValue({
      activity: [
        {
          log_id: 'log-1',
          timestamp: 1772767200000,
          action: 'UPLOAD_REQUESTED',
          result: 'SUCCESS',
          filename: 'resume_2026.pdf',
        },
      ],
      count: 1,
    })
  })

  it('renders employee persona welcome messaging', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    expect(screen.getByTestId('dashboard-employee-id')).toHaveTextContent('EMP-001')
    expect(screen.getByTestId('dashboard-role-card')).toHaveTextContent('Employee')
    expect(screen.getByTestId('dashboard-emp-id-card')).toHaveTextContent('EMP-001')
    expect(screen.getByTestId('dashboard-role-message')).toHaveTextContent(
      'You can upload, view, and download your own documents securely.'
    )

    await waitFor(() => {
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
    })
  })

  it('renders manager-specific welcome message for Manager persona', async () => {
    renderDashboardPage({
      employeeId: 'EMP-MGR1',
      role: 'Manager',
      signOut: vi.fn(),
    })

    expect(screen.getByTestId('dashboard-employee-id')).toHaveTextContent('EMP-MGR1')
    expect(screen.getByTestId('dashboard-role-card')).toHaveTextContent('Manager')
    expect(screen.getByTestId('dashboard-role-message')).toHaveTextContent(
      'You can view and download documents for employees in your team.'
    )

    await waitFor(() => {
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
    })
  })

  it('renders HR Admin welcome message for HR_Admin persona', async () => {
    renderDashboardPage({
      employeeId: 'EMP-HR1',
      role: 'HR_Admin',
      signOut: vi.fn(),
    })

    expect(screen.getByTestId('dashboard-employee-id')).toHaveTextContent('EMP-HR1')
    expect(screen.getByTestId('dashboard-role-card')).toHaveTextContent('HR Admin')
    expect(screen.getByTestId('dashboard-role-message')).toHaveTextContent(
      'You have full access to all employee documents, audit records, and platform settings.'
    )

    await waitFor(() => {
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
    })
  })

  it('fetches and displays documents on load', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    expect(api.listFiles).toHaveBeenCalledWith('EMP-001')

    await waitFor(() => {
      expect(screen.getByTestId('doc-row-doc-123')).toBeInTheDocument()
      expect(screen.getByTestId('doc-row-doc-456')).toBeInTheDocument()
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
      expect(screen.getByText('id_card.png')).toBeInTheDocument()
      expect(screen.getByTestId('dashboard-doc-count')).toHaveTextContent('2')
    })
  })

  it('displays empty state when no documents are returned', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: [],
      count: 0,
    })

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('documents-empty')).toBeInTheDocument()
      expect(screen.getByText(/no documents uploaded yet/i)).toBeInTheDocument()
      expect(screen.getByTestId('dashboard-doc-count')).toHaveTextContent('0')
    })
  })

  it('displays error state and retries fetch when listFiles fails', async () => {
    vi.spyOn(api, 'listFiles').mockRejectedValueOnce(new Error('Network connection lost'))

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('documents-error')).toBeInTheDocument()
      expect(screen.getByTestId('documents-error')).toHaveTextContent(/network connection failed/i)
    })

    // Now resolve on retry
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: mockDocuments,
      count: 2,
    })

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
    })
  })

  it('handles document download: fetches presigned URL and opens window without logging URL', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const consoleLogSpy = vi.spyOn(console, 'log')

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    const downloadBtn = screen.getByTestId('download-btn-doc-123')
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(api.getDownloadUrl).toHaveBeenCalledWith('doc-123')
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://s3.ap-south-1.amazonaws.com/presigned-download-url',
        '_blank',
        'noopener,noreferrer'
      )
    })

    // Confirm no URL was logged to console
    consoleLogSpy.mock.calls.forEach((args) => {
      const text = args.join(' ')
      expect(text).not.toContain('https://s3.ap-south-1.amazonaws.com/presigned-download-url')
    })

    windowOpenSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('handles document deletion with confirmation and list refresh', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('delete-btn-doc-123')).toBeInTheDocument()
    })

    const deleteBtn = screen.getByTestId('delete-btn-doc-123')
    fireEvent.click(deleteBtn)

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('resume_2026.pdf'))

    await waitFor(() => {
      expect(api.deleteFile).toHaveBeenCalledWith('doc-123')
      expect(screen.getByTestId('action-success')).toHaveTextContent(
        '"resume_2026.pdf" was deleted successfully.'
      )
    })

    confirmSpy.mockRestore()
  })

  it('cancels deletion when user declines confirmation prompt', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('delete-btn-doc-123')).toBeInTheDocument()
    })

    const deleteBtn = screen.getByTestId('delete-btn-doc-123')
    fireEvent.click(deleteBtn)

    expect(confirmSpy).toHaveBeenCalled()
    expect(api.deleteFile).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('displays error banner when download fails', async () => {
    vi.spyOn(api, 'getDownloadUrl').mockRejectedValue(new Error('Access Denied to S3'))

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    const downloadBtn = screen.getByTestId('download-btn-doc-123')
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toHaveTextContent('Access Denied to S3')
    })
  })

  it('navigates to /documents?upload=true when clicking Primary CTA Upload Document', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    const uploadBtn = await screen.findByRole('button', { name: /upload document/i })
    fireEvent.click(uploadBtn)

    expect(mockNavigate).toHaveBeenCalledWith('/documents?upload=true')
  })

  it('navigates to /documents when clicking Secondary CTA View Documents', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    const viewDocsBtn = await screen.findByRole('button', { name: /view documents/i })
    fireEvent.click(viewDocsBtn)

    expect(mockNavigate).toHaveBeenCalledWith('/documents')
  })

  it('ensures dashboard does NOT render full document table or full document upload form', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByText('resume_2026.pdf')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('documents-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('upload-type-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('upload-file-input')).not.toBeInTheDocument()
  })

  it('fetches and displays recent activity events', async () => {
    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByText('Document Uploaded')).toBeInTheDocument()
    })
  })

  it('handles 401 Unauthorized by calling signOut and redirecting to /login', async () => {
    const signOutMock = vi.fn().mockResolvedValue(undefined)
    const err401 = new api.ApiError('Session expired', 401, 'Unauthorized')
    vi.spyOn(api, 'listFiles').mockRejectedValue(err401)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: signOutMock,
    })

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: { error: 'Your session has expired. Please sign in again.' },
      })
    })
  })

  it('handles 403 Forbidden with sanitized permission warning', async () => {
    const err403 = new api.ApiError('checkAccess denied for target employee', 403, 'Forbidden')
    vi.spyOn(api, 'getDownloadUrl').mockRejectedValue(err403)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('download-btn-doc-123'))

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'You do not have permission to access or modify this document.'
      )
    })
  })

  it('handles 404 NotFound with sanitized document missing notice', async () => {
    const err404 = new api.ApiError('Document not found in table', 404, 'NotFound')
    vi.spyOn(api, 'getDownloadUrl').mockRejectedValue(err404)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('download-btn-doc-123'))

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'The requested document was not found or has already been removed.'
      )
    })
  })

  it('handles 409 Conflict with sanitized pending upload notice', async () => {
    const err409 = new api.ApiError('Document upload is pending', 409, 'Conflict')
    vi.spyOn(api, 'getDownloadUrl').mockRejectedValue(err409)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('download-btn-doc-123'))

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'This document is currently pending upload or conflicts with another operation. Please try again later.'
      )
    })
  })

  it('locks all action buttons while an operation is in progress to prevent duplicate clicks', async () => {
    let resolveDownload
    const downloadPromise = new Promise((resolve) => {
      resolveDownload = resolve
    })
    vi.spyOn(api, 'getDownloadUrl').mockReturnValue(downloadPromise)

    renderDashboardPage({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getByTestId('download-btn-doc-123')).toBeInTheDocument()
    })

    const downloadBtn1 = screen.getByTestId('download-btn-doc-123')
    const deleteBtn1 = screen.getByTestId('delete-btn-doc-123')
    const downloadBtn2 = screen.getByTestId('download-btn-doc-456')
    const deleteBtn2 = screen.getByTestId('delete-btn-doc-456')

    // Click download on first document
    fireEvent.click(downloadBtn1)

    // All buttons should be disabled immediately
    expect(downloadBtn1).toBeDisabled()
    expect(deleteBtn1).toBeDisabled()
    expect(downloadBtn2).toBeDisabled()
    expect(deleteBtn2).toBeDisabled()

    // Resolve in-flight action
    resolveDownload({
      document_id: 'doc-123',
      download_url: 'https://s3.ap-south-1.amazonaws.com/test',
    })

    await waitFor(() => {
      expect(downloadBtn1).not.toBeDisabled()
      expect(deleteBtn1).not.toBeDisabled()
    })
  })
})
