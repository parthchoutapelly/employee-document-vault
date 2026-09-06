import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import ProtectedRoute from '../ProtectedRoute'
import { AuthContext } from '../../context/AuthContext'

function renderWithAuth(ui, authValue, initialRoute = '/protected') {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/protected" element={<ProtectedRoute>{ui}</ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('ProtectedRoute', () => {
  it('renders loading spinner when auth is loading', () => {
    renderWithAuth(<div>Secret Content</div>, {
      isAuthenticated: false,
      loading: true,
      employeeId: null,
      role: null,
    })

    expect(screen.getByTestId('page-loader')).toBeInTheDocument()
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument()
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('redirects to /login when unauthenticated', () => {
    renderWithAuth(<div>Secret Content</div>, {
      isAuthenticated: false,
      loading: false,
      employeeId: null,
      role: null,
    })

    expect(screen.queryByTestId('page-loader')).not.toBeInTheDocument()
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument()
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    renderWithAuth(<div>Secret Content</div>, {
      isAuthenticated: true,
      loading: false,
      employeeId: 'EMP-001',
      role: 'Employee',
    })

    expect(screen.queryByTestId('page-loader')).not.toBeInTheDocument()
    expect(screen.getByText('Secret Content')).toBeInTheDocument()
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })
})
