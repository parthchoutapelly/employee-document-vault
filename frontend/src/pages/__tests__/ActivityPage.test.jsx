/**
 * ActivityPage.test.jsx
 *
 * Comprehensive unit test suite for VEYRA Activity & Security Audit Workspace:
 * - Renders loading state
 * - Renders audit events correctly (action name, status badge, timestamp, file reference, actor)
 * - Filters events by action type
 * - Searches events by query string
 * - Triggers refresh when clicking refresh button
 * - Renders empty state when no events exist
 * - Renders error state with retry button when API fails
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ActivityPage from '../ActivityPage'
import { AuthContext } from '../../context/AuthContext'
import * as api from '../../services/api'

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api')
  return {
    ...actual,
    getActivity: vi.fn(),
    listFiles: vi.fn(),
  }
})

function renderActivityPage(authValue = {}) {
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
        <ActivityPage />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('ActivityPage Component', () => {
  const sampleEvents = [
    {
      log_id: 'act-101',
      action: 'UPLOAD_REQUESTED',
      result: 'SUCCESS',
      timestamp: '2026-09-06T10:00:00Z',
      actor_employee_id: 'EMP-001',
      target_employee_id: 'EMP-001',
      filename: 'Offer_Letter.pdf',
      document_type: 'offer_letter',
    },
    {
      log_id: 'act-102',
      action: 'FILE_DOWNLOADED',
      result: 'SUCCESS',
      timestamp: '2026-09-06T11:00:00Z',
      actor_employee_id: 'EMP-001',
      target_employee_id: 'EMP-001',
      filename: 'Passport.png',
      document_type: 'id_proof',
    },
    {
      log_id: 'act-103',
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      timestamp: '2026-09-06T12:00:00Z',
      actor_employee_id: 'EMP-001',
      target_employee_id: 'EMP-999',
      filename: null,
      document_id: 'doc-restricted',
    },
    {
      log_id: 'act-104',
      action: 'FILE_DELETED',
      result: 'SUCCESS',
      timestamp: '2026-09-06T13:00:00Z',
      actor_employee_id: 'EMP-001',
      target_employee_id: 'EMP-001',
      filename: 'Old_Doc.pdf',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(api, 'listFiles').mockResolvedValue({ documents: [], count: 0 })
    vi.spyOn(api, 'getActivity').mockResolvedValue({
      events: sampleEvents,
      count: 4,
    })
  })

  it('renders loading state initially while fetching activity', () => {
    vi.spyOn(api, 'listFiles').mockReturnValue(new Promise(() => {}))
    vi.spyOn(api, 'getActivity').mockReturnValue(new Promise(() => {}))
    renderActivityPage()

    expect(screen.getByTestId('activity-loading')).toBeInTheDocument()
    expect(screen.getByText(/loading security activity log/i)).toBeInTheDocument()
  })

  it('renders activity header, subtitle, and table with audit events', async () => {
    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument()
    })

    expect(
      screen.getByText('Security and document activity associated with your account.')
    ).toBeInTheDocument()

    // Formatted action names
    expect(screen.getByText('Upload Requested')).toBeInTheDocument()
    expect(screen.getByText('File Downloaded')).toBeInTheDocument()
    expect(screen.getByText('Unauthorized Access Denied')).toBeInTheDocument()
    expect(screen.getByText('Document Soft-Deleted')).toBeInTheDocument()

    // File references
    expect(screen.getByText('Offer_Letter.pdf')).toBeInTheDocument()
    expect(screen.getByText('Passport.png')).toBeInTheDocument()
    expect(screen.getByText('Old_Doc.pdf')).toBeInTheDocument()

    // Status badges
    expect(screen.getAllByText('SUCCESS').length).toBe(3)
    expect(screen.getByText('DENIED')).toBeInTheDocument()
  })

  it('filters activity by action type via select dropdown', async () => {
    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByText('Upload Requested')).toBeInTheDocument()
    })

    const filterSelect = screen.getByLabelText(/filter activity by action type/i)
    fireEvent.change(filterSelect, { target: { value: 'UPLOAD_REQUESTED' } })

    expect(screen.getByText('Upload Requested')).toBeInTheDocument()
    expect(screen.queryByText('File Downloaded')).not.toBeInTheDocument()
    expect(screen.queryByText('Unauthorized Access Denied')).not.toBeInTheDocument()
  })

  it('filters activity by search keyword (filename, document ID, actor)', async () => {
    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByText('Offer_Letter.pdf')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search activity logs/i)
    fireEvent.change(searchInput, { target: { value: 'Passport' } })

    expect(screen.getByText('Passport.png')).toBeInTheDocument()
    expect(screen.queryByText('Offer_Letter.pdf')).not.toBeInTheDocument()

    // Clear search
    const clearBtn = screen.getByLabelText(/clear activity search/i)
    fireEvent.click(clearBtn)
    expect(screen.getByText('Offer_Letter.pdf')).toBeInTheDocument()
  })

  it('calls getActivity again when clicking Refresh button', async () => {
    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByText('Upload Requested')).toBeInTheDocument()
    })

    expect(api.getActivity).toHaveBeenCalledTimes(1)

    const refreshBtn = screen.getByRole('button', { name: /refresh activity feed/i })
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(api.getActivity).toHaveBeenCalledTimes(2)
    })
  })

  it('renders empty state when no activity records exist', async () => {
    vi.spyOn(api, 'getActivity').mockResolvedValueOnce({
      events: [],
      count: 0,
    })

    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByTestId('activity-empty')).toBeInTheDocument()
    })

    expect(screen.getByText('No activity recorded yet.')).toBeInTheDocument()
  })

  it('renders error notice with retry button when getActivity fails', async () => {
    vi.spyOn(api, 'getActivity').mockRejectedValueOnce(new Error('AuditLog service unavailable'))

    renderActivityPage()

    await waitFor(() => {
      expect(screen.getByTestId('activity-error')).toBeInTheDocument()
    })

    expect(screen.getByText(/AuditLog service unavailable/i)).toBeInTheDocument()

    // Resolves on retry
    vi.spyOn(api, 'getActivity').mockResolvedValueOnce({
      events: sampleEvents,
      count: 4,
    })

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('activity-error')).not.toBeInTheDocument()
      expect(screen.getByText('Upload Requested')).toBeInTheDocument()
    })
  })
})
