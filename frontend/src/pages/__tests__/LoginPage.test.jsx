import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import LoginPage from '../LoginPage'
import { AuthContext } from '../../context/AuthContext'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderLoginPage(authValue, initialRoute = '/login') {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('LoginPage', () => {
  it('redirects to /dashboard if user is already authenticated', () => {
    renderLoginPage({
      isAuthenticated: true,
      loading: false,
      signIn: vi.fn(),
      error: null,
    })

    expect(screen.getByText('Dashboard Page')).toBeInTheDocument()
  })

  it('renders sign in form with inputs and disabled submit button when empty', () => {
    renderLoginPage({
      isAuthenticated: false,
      loading: false,
      signIn: vi.fn(),
      error: null,
    })

    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: /sign in/i })
    expect(submitBtn).toBeDisabled()
  })

  it('enables submit button when both email and password are provided', () => {
    renderLoginPage({
      isAuthenticated: false,
      loading: false,
      signIn: vi.fn(),
      error: null,
    })

    const emailInput = screen.getByLabelText(/work email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitBtn = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'emp001@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'Secret123!' } })

    expect(submitBtn).not.toBeDisabled()
  })

  it('calls signIn and navigates to /dashboard on successful login', async () => {
    const signInMock = vi.fn().mockResolvedValue({ username: 'emp001@example.com' })
    renderLoginPage({
      isAuthenticated: false,
      loading: false,
      signIn: signInMock,
      error: null,
    })

    const emailInput = screen.getByLabelText(/work email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitBtn = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'emp001@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'Secret123!' } })
    fireEvent.click(submitBtn)

    expect(signInMock).toHaveBeenCalledWith('emp001@example.com', 'Secret123!')
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    })
  })

  it('displays error message when signIn fails', async () => {
    const signInMock = vi.fn().mockRejectedValue(new Error('Incorrect username or password.'))
    renderLoginPage({
      isAuthenticated: false,
      loading: false,
      signIn: signInMock,
      error: null,
    })

    const emailInput = screen.getByLabelText(/work email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitBtn = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'emp001@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'WrongPass' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toHaveTextContent('Incorrect username or password.')
    })
  })

  it('displays session expired message passed via location.state', () => {
    renderLoginPage(
      {
        isAuthenticated: false,
        loading: false,
        signIn: vi.fn(),
        error: null,
      },
      { pathname: '/login', state: { error: 'Your session has expired. Please sign in again.' } }
    )

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Your session has expired. Please sign in again.'
    )
  })
})
