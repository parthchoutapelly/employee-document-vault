/**
 * VeyraDocumentBrowser.test.jsx
 *
 * Comprehensive tests for VEYRA Employee Document Workspace:
 * - Folder-like navigation by document type
 * - Search bar filtering document metadata (including persisted tags)
 * - Sorting by date, type, and filename (asc / desc)
 * - Persistent tagging: adding, removing, validating tags, API synchronization
 * - Real S3 object version history: API call, real version IDs, delete markers, error handling
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardPage from '../DashboardPage'
import { AuthContext } from '../../context/AuthContext'
import * as api from '../../services/api'

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api')
  return {
    ...actual,
    listFiles: vi.fn(),
    getDownloadUrl: vi.fn(),
    deleteFile: vi.fn(),
    requestUpload: vi.fn(),
    uploadFileToPresignedUrl: vi.fn(),
    updateDocumentTags: vi.fn(),
    getDocumentVersions: vi.fn(),
  }
})

function renderDashboard(authValue = {}) {
  const defaultAuth = {
    employeeId: 'EMP-001',
    role: 'Employee',
    signOut: vi.fn(),
    user: { name: 'Alice Smith', email: 'alice@example.com' },
    ...authValue,
  }

  return render(
    <AuthContext.Provider value={defaultAuth}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('VEYRA Document Browser & Specification Features', () => {
  const sampleDocs = [
    {
      document_id: 'doc-1',
      employee_id: 'EMP-001',
      filename: 'Offer_Letter_2026.pdf',
      document_type: 'offer_letter',
      upload_timestamp: 1772700000000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/offer_letter/Offer_Letter_2026.pdf',
      tags: ['Confidential', 'Onboarding'],
    },
    {
      document_id: 'doc-2',
      employee_id: 'EMP-001',
      filename: 'Passport_Scan.png',
      document_type: 'id_proof',
      upload_timestamp: 1772800000000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/id_proof/Passport_Scan.png',
      tags: ['KYC', 'Verified'],
    },
    {
      document_id: 'doc-3',
      employee_id: 'EMP-001',
      filename: 'Salary_Slip_Jan.pdf',
      document_type: 'payslip',
      upload_timestamp: 1772900000000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/payslip/Salary_Slip_Jan.pdf',
      tags: ['Payroll', 'Finance'],
    },
    {
      document_id: 'doc-4',
      employee_id: 'EMP-001',
      filename: 'Annual_Review.pdf',
      document_type: 'appraisal',
      upload_timestamp: 1772600000000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/appraisal/Annual_Review.pdf',
      tags: ['Performance'],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: sampleDocs,
      count: 4,
    })
    vi.spyOn(api, 'updateDocumentTags').mockResolvedValue({
      message: 'Tags updated successfully',
      document_id: 'doc-1',
      tags: ['Confidential', 'Onboarding', 'Signed'],
    })
    vi.spyOn(api, 'getDocumentVersions').mockResolvedValue({
      document_id: 'doc-1',
      filename: 'Offer_Letter_2026.pdf',
      s3_key: 'documents/EMP-001/offer_letter/Offer_Letter_2026.pdf',
      versions: [
        {
          version_id: 'v2-active-s3-12345',
          last_modified: '2026-09-06T10:00:00Z',
          is_latest: true,
          is_delete_marker: false,
          size: 15360,
        },
        {
          version_id: 'v1-prev-s3-67890',
          last_modified: '2026-09-05T10:00:00Z',
          is_latest: false,
          is_delete_marker: false,
          size: 10240,
        },
      ],
      count: 2,
    })
  })

  it('renders VEYRA enterprise sidebar with document folders and live counts', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    // Check VEYRA branding
    expect(screen.getByText('VEYRA')).toBeInTheDocument()
    expect(screen.getByText('Document Workspace')).toBeInTheDocument()

    // Check folders
    expect(screen.getByRole('button', { name: /Offer Letters/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ID Proof/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Payslips/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Appraisals/i })).toBeInTheDocument()
  })

  it('filters documents by document type when clicking a folder tab', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
      expect(screen.getByText('Passport_Scan.png')).toBeInTheDocument()
      expect(screen.getByText('Salary_Slip_Jan.pdf')).toBeInTheDocument()
    })

    // Click on "ID Proof" tab
    const idProofTabs = screen.getAllByRole('tab', { name: /ID Proof/i })
    fireEvent.click(idProofTabs[0])

    // Only ID Proof document should be visible
    expect(screen.getByText('Passport_Scan.png')).toBeInTheDocument()
    expect(screen.queryByText('Offer_Letter_2026.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('Salary_Slip_Jan.pdf')).not.toBeInTheDocument()
  })

  it('filters documents by metadata search (filename, type, tags)', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/filter document metadata/i)

    // Search by filename snippet
    fireEvent.change(searchInput, { target: { value: 'Salary' } })
    expect(screen.getByText('Salary_Slip_Jan.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Offer_Letter_2026.pdf')).not.toBeInTheDocument()

    // Search by persisted tag
    fireEvent.change(searchInput, { target: { value: 'Confidential' } })
    expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Passport_Scan.png')).not.toBeInTheDocument()

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    expect(screen.getByText('Passport_Scan.png')).toBeInTheDocument()
  })

  it('sorts documents by upload date ascending and descending', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const sortOrderBtn = screen.getByRole('button', { name: /sort order/i })
    const rows = screen.getAllByTestId(/doc-row-/)

    // Default is descending (newest first: doc-3 Salary_Slip_Jan: 1772900000000)
    expect(rows[0]).toHaveTextContent('Salary_Slip_Jan.pdf')

    // Toggle to ascending (oldest first: doc-4 Annual_Review: 1772600000000)
    fireEvent.click(sortOrderBtn)
    const ascRows = screen.getAllByTestId(/doc-row-/)
    expect(ascRows[0]).toHaveTextContent('Annual_Review.pdf')
  })

  it('sorts documents by document type', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const sortSelect = screen.getByLabelText(/sort documents by/i)
    const sortOrderBtn = screen.getByRole('button', { name: /sort order/i })

    // Set sort by type
    fireEvent.change(sortSelect, { target: { value: 'type' } })
    // Toggle to ascending ('appraisal' < 'id_proof' < 'offer_letter' < 'payslip')
    fireEvent.click(sortOrderBtn)

    const ascRows = screen.getAllByTestId(/doc-row-/)
    expect(ascRows[0]).toHaveTextContent('Annual_Review.pdf') // appraisal
  })

  it('displays persisted tags for each document in the table', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    expect(screen.getByText('Confidential')).toBeInTheDocument()
    expect(screen.getByText('Onboarding')).toBeInTheDocument()
    expect(screen.getByText('KYC')).toBeInTheDocument()
    expect(screen.getByText('Payroll')).toBeInTheDocument()
  })

  it('allows adding a persistent tag and syncs with PATCH /files/{doc_id}', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const addTagBtn = screen.getByRole('button', { name: /add tag to Offer_Letter_2026\.pdf/i })
    fireEvent.click(addTagBtn)

    const tagInput = screen.getByLabelText(/new tag for Offer_Letter_2026\.pdf/i)
    fireEvent.change(tagInput, { target: { value: 'Signed' } })

    const saveTagBtn = screen.getByRole('button', { name: /save tag/i })
    fireEvent.click(saveTagBtn)

    await waitFor(() => {
      expect(api.updateDocumentTags).toHaveBeenCalledWith('doc-1', ['Confidential', 'Onboarding', 'Signed'])
      expect(screen.getByTestId('action-success')).toHaveTextContent(/tags updated/i)
    })
  })

  it('allows removing a tag and syncs with PATCH /files/{doc_id}', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const removeBtn = screen.getByRole('button', { name: /remove tag Onboarding from Offer_Letter_2026\.pdf/i })
    fireEvent.click(removeBtn)

    await waitFor(() => {
      expect(api.updateDocumentTags).toHaveBeenCalledWith('doc-1', ['Confidential'])
    })
  })

  it('validates tag input: rejects duplicate tag with error notice', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const addTagBtn = screen.getByRole('button', { name: /add tag to Offer_Letter_2026\.pdf/i })
    fireEvent.click(addTagBtn)

    const tagInput = screen.getByLabelText(/new tag for Offer_Letter_2026\.pdf/i)
    fireEvent.change(tagInput, { target: { value: 'Confidential' } })

    const saveTagBtn = screen.getByRole('button', { name: /save tag/i })
    fireEvent.click(saveTagBtn)

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toHaveTextContent('Tag "Confidential" already exists on this document.')
      expect(api.updateDocumentTags).not.toHaveBeenCalled()
    })
  })

  it('fetches and renders real S3 object versions in VersionHistoryDrawer', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    // Click History button specifically for Offer_Letter_2026.pdf
    const historyBtn = screen.getByRole('button', { name: /view version history for Offer_Letter_2026\.pdf/i })
    fireEvent.click(historyBtn)

    expect(api.getDocumentVersions).toHaveBeenCalledWith('doc-1')

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('v2-active-s3-12345')).toBeInTheDocument()
      expect(screen.getByText('v1-prev-s3-67890')).toBeInTheDocument()
      expect(screen.getByText('Current Version')).toBeInTheDocument()
      expect(screen.getByText('Previous Version')).toBeInTheDocument()
    })

    // Close drawer
    const closeBtn = screen.getByRole('button', { name: /close version history/i })
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByText('v2-active-s3-12345')).not.toBeInTheDocument()
    })
  })

  it('renders S3 delete markers with distinctive status in VersionHistoryDrawer', async () => {
    vi.spyOn(api, 'getDocumentVersions').mockResolvedValueOnce({
      document_id: 'doc-1',
      filename: 'Offer_Letter_2026.pdf',
      s3_key: 'documents/EMP-001/offer_letter/Offer_Letter_2026.pdf',
      versions: [
        {
          version_id: 'del-marker-s3-999',
          last_modified: '2026-09-06T12:00:00Z',
          is_latest: true,
          is_delete_marker: true,
          size: 0,
        },
        {
          version_id: 'v1-active-s3-123',
          last_modified: '2026-09-05T10:00:00Z',
          is_latest: false,
          is_delete_marker: false,
          size: 8192,
        },
      ],
      count: 2,
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const historyBtn = screen.getByRole('button', { name: /view version history for Offer_Letter_2026\.pdf/i })
    fireEvent.click(historyBtn)

    await waitFor(() => {
      expect(screen.getByText('del-marker-s3-999')).toBeInTheDocument()
      expect(screen.getByText('Current Delete Marker')).toBeInTheDocument()
      expect(screen.getByText('Soft-Deleted')).toBeInTheDocument()
    })
  })

  it('displays error notice and retry option when getDocumentVersions fails', async () => {
    vi.spyOn(api, 'getDocumentVersions').mockRejectedValueOnce(new Error('S3 access timeout'))

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter_2026.pdf')).toBeInTheDocument()
    })

    const historyBtn = screen.getByRole('button', { name: /view version history for Offer_Letter_2026\.pdf/i })
    fireEvent.click(historyBtn)

    await waitFor(() => {
      expect(screen.getByTestId('versions-error')).toBeInTheDocument()
      expect(screen.getByText(/s3 access timeout/i)).toBeInTheDocument()
    })

    // Resolves on retry
    vi.spyOn(api, 'getDocumentVersions').mockResolvedValueOnce({
      document_id: 'doc-1',
      filename: 'Offer_Letter_2026.pdf',
      versions: [{ version_id: 'v-retry', last_modified: '2026-09-06T10:00:00Z', is_latest: true, is_delete_marker: false, size: 500 }],
      count: 1,
    })

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('v-retry')).toBeInTheDocument()
    })
  })
})
