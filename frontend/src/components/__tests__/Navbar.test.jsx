import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import Navbar from '../Navbar'
import { AuthContext } from '../../context/AuthContext'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderNavbar(authValue) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('Navbar', () => {
  it('renders employee ID and role badge', () => {
    renderNavbar({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    expect(screen.getByText('EMP-001')).toBeInTheDocument()
    expect(screen.getByText('Employee')).toBeInTheDocument()
  })

  it('renders manager role badge correctly', () => {
    renderNavbar({
      employeeId: 'EMP-MGR1',
      role: 'Manager',
      signOut: vi.fn(),
    })

    expect(screen.getByText('EMP-MGR1')).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
  })

  it('calls signOut and navigates to /login on Sign Out click', async () => {
    const signOutMock = vi.fn().mockResolvedValue(undefined)
    renderNavbar({
      employeeId: 'EMP-HR1',
      role: 'HR_Admin',
      signOut: signOutMock,
    })

    const signOutBtn = screen.getByRole('button', { name: /sign out/i })
    fireEvent.click(signOutBtn)

    expect(signOutMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
  })
})
