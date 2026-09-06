import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../App'
import * as authHook from '../hooks/useAuth'
import * as api from '../services/api'

vi.mock('../hooks/useAuth')
vi.mock('../services/api')

describe('App routing & navigation', () => {
  const mockDocs = [
    {
      document_id: 'doc-1',
      employee_id: 'EMP-001',
      filename: 'offer_letter.pdf',
      document_type: 'offer_letter',
      upload_timestamp: 1772767200000,
      status: 'AVAILABLE',
      s3_key: 'documents/EMP-001/offer_letter/offer_letter.pdf',
      tags: ['HR', 'Onboarding'],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: mockDocs,
      count: 1,
    })
  })

  it('renders login page when unauthenticated and navigating to root', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null,
      session: null,
      employeeId: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })

    window.history.pushState({}, '', '/')
    render(<App />)

    expect(screen.getByRole('heading', { name: /employee document vault/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login when attempting to access /dashboard', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null,
      session: null,
      employeeId: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })

    window.history.pushState({}, '', '/dashboard')
    render(<App />)

    expect(screen.getByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login when attempting to access /documents', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null,
      session: null,
      employeeId: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })

    window.history.pushState({}, '', '/documents')
    render(<App />)

    expect(screen.getByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('documents-workspace')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login when attempting to access /activity', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null,
      session: null,
      employeeId: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })

    window.history.pushState({}, '', '/activity')
    render(<App />)

    expect(screen.getByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-page')).not.toBeInTheDocument()
  })

  it('renders dashboard overview when authenticated and navigating to /dashboard', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { username: 'emp001' },
      session: {},
      employeeId: 'EMP-001',
      role: 'Employee',
      isAuthenticated: true,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })
    vi.spyOn(api, 'getActivity').mockResolvedValue({
      events: [
        {
          log_id: 'act-1',
          action: 'UPLOAD_REQUESTED',
          result: 'SUCCESS',
          timestamp: '2026-09-06T10:00:00Z',
          filename: 'offer_letter.pdf',
        },
      ],
      count: 1,
    })

    window.history.pushState({}, '', '/dashboard')
    render(<App />)

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-employee-id')).toHaveTextContent('EMP-001')

    await waitFor(() => {
      expect(screen.getByText('offer_letter.pdf')).toBeInTheDocument()
    })
  })

  it('ensures dashboard does NOT render the full document workspace (table-wrap or search bar)', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { username: 'emp001' },
      session: {},
      employeeId: 'EMP-001',
      role: 'Employee',
      isAuthenticated: true,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })
    vi.spyOn(api, 'getActivity').mockResolvedValue({ events: [], count: 0 })

    window.history.pushState({}, '', '/dashboard')
    render(<App />)

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('offer_letter.pdf')).toBeInTheDocument()
    })

    // Assert that the full document workspace and its full table are NOT rendered on /dashboard
    expect(screen.queryByTestId('documents-workspace')).not.toBeInTheDocument()
    expect(screen.queryByTestId('documents-table-wrap')).not.toBeInTheDocument()
    expect(screen.queryByTestId('documents-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('documents-search-input')).not.toBeInTheDocument()
  })

  it('renders documents workspace when authenticated and navigating to /documents', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { username: 'emp001' },
      session: {},
      employeeId: 'EMP-001',
      role: 'Employee',
      isAuthenticated: true,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })

    window.history.pushState({}, '', '/documents')
    render(<App />)

    expect(screen.getByTestId('documents-workspace')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('documents-table')).toBeInTheDocument()
      expect(screen.getByTestId('documents-search-input')).toBeInTheDocument()
      expect(screen.getByText('offer_letter.pdf')).toBeInTheDocument()
    })
  })

  it('renders activity workspace when authenticated and navigating to /activity', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { username: 'emp001' },
      session: {},
      employeeId: 'EMP-001',
      role: 'Employee',
      isAuthenticated: true,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })
    vi.spyOn(api, 'getActivity').mockResolvedValue({
      events: [
        {
          log_id: 'act-1',
          action: 'FILE_DOWNLOADED',
          result: 'SUCCESS',
          timestamp: '2026-09-06T11:00:00Z',
          filename: 'offer_letter.pdf',
        },
      ],
      count: 1,
    })

    window.history.pushState({}, '', '/activity')
    render(<App />)

    expect(screen.getByTestId('activity-page')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('File Downloaded')).toBeInTheDocument()
      expect(screen.getByText('offer_letter.pdf')).toBeInTheDocument()
    })
  })

  it('navigates between Dashboard, Documents, and Activity via sidebar navigation buttons', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { username: 'emp001' },
      session: {},
      employeeId: 'EMP-001',
      role: 'Employee',
      isAuthenticated: true,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
    })
    vi.spyOn(api, 'getActivity').mockResolvedValue({ events: [], count: 0 })

    window.history.pushState({}, '', '/dashboard')
    render(<App />)

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()

    // Click "Documents" in sidebar navigation
    const docsNavBtn = document.getElementById('sidebar-nav-documents')
    fireEvent.click(docsNavBtn)

    await waitFor(() => {
      expect(screen.getByTestId('documents-workspace')).toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()
    })

    // Click "Activity" in sidebar navigation
    const actNavBtn = document.getElementById('sidebar-nav-activity')
    fireEvent.click(actNavBtn)

    await waitFor(() => {
      expect(screen.getByTestId('activity-page')).toBeInTheDocument()
      expect(screen.queryByTestId('documents-workspace')).not.toBeInTheDocument()
    })

    // Click "Dashboard" in sidebar navigation to return
    const dashNavBtn = document.getElementById('sidebar-nav-dashboard')
    fireEvent.click(dashNavBtn)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
      expect(screen.queryByTestId('activity-page')).not.toBeInTheDocument()
    })
  })
})
