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

  it('renders breadcrumbs and security compliance indicators', () => {
    renderNavbar({
      employeeId: 'EMP-001',
      role: 'Employee',
      signOut: vi.fn(),
    })

    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('KMS Encrypted')).toBeInTheDocument()
    expect(screen.getByText('RBAC Active')).toBeInTheDocument()
  })

  it('conditionally controls search input rendering with showSearch prop', () => {
    const { rerender } = render(
      <AuthContext.Provider value={{ employeeId: 'EMP-001', role: 'Employee', signOut: vi.fn() }}>
        <MemoryRouter>
          <Navbar showSearch={false} />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    expect(screen.queryByTestId('documents-search-input')).not.toBeInTheDocument()

    rerender(
      <AuthContext.Provider value={{ employeeId: 'EMP-001', role: 'Employee', signOut: vi.fn() }}>
        <MemoryRouter>
          <Navbar showSearch={true} searchValue="test query" onSearchChange={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    expect(screen.getByTestId('documents-search-input')).toBeInTheDocument()
    expect(screen.getByTestId('documents-search-input')).toHaveValue('test query')
  })
})
