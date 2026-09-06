import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../App'
import * as authHook from '../hooks/useAuth'
import * as api from '../services/api'

vi.mock('../hooks/useAuth')
vi.mock('../services/api')

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(api, 'listFiles').mockResolvedValue({
      employee_id: 'EMP-001',
      documents: [],
      count: 0,
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

  it('renders dashboard when authenticated', async () => {
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

    window.history.pushState({}, '', '/dashboard')
    render(<App />)

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-employee-id')).toHaveTextContent('EMP-001')

    await waitFor(() => {
      expect(screen.getByTestId('documents-empty')).toBeInTheDocument()
    })
  })
})
