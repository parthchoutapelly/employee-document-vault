/**
 * Navbar.jsx
 *
 * Top navigation / header bar for VEYRA Employee Document Workspace.
 * Features:
 * - Breadcrumbs
 * - Primary navigation tabs (Dashboard | Documents)
 * - Metadata search (when enabled)
 * - Compliance status (KMS, RBAC, TLS)
 * - Employee identity and Sign Out button
 */
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'
import { roleLabel, ROLES } from '../services/authUtils'
import './Navbar.css'

export default function Navbar({
  breadcrumbs = ['Workspace', 'Documents'],
  onToggleMobile,
  searchValue = '',
  onSearchChange,
  showSearch = true,
}) {
  const { employeeId, role, signOut } = useAuthContext()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const roleBadgeClass = () => {
    switch (role) {
      case ROLES.HR_ADMIN: return 'veyra-topbar__badge--hr'
      case ROLES.MANAGER:  return 'veyra-topbar__badge--mgr'
      default:             return 'veyra-topbar__badge--emp'
    }
  }

  return (
    <header className="veyra-topbar" role="banner">
      <div className="veyra-topbar__left">
        {/* Mobile menu hamburger */}
        <button
          type="button"
          className="veyra-topbar__hamburger"
          onClick={onToggleMobile}
          aria-label="Toggle navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        {/* Breadcrumb path */}
        <nav className="veyra-topbar__breadcrumbs" aria-label="Breadcrumbs">
          {breadcrumbs.map((crumb, idx) => (
            <span key={idx} className="veyra-topbar__crumb-wrap">
              {idx > 0 && <span className="veyra-topbar__crumb-sep" aria-hidden="true">/</span>}
              <span className={`veyra-topbar__crumb ${idx === breadcrumbs.length - 1 ? 'veyra-topbar__crumb--active' : ''}`}>
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      {/* Center Search Input (Shown on Documents workspace) */}
      {showSearch && (
        <div className="veyra-topbar__search">
          <svg className="veyra-topbar__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            className="veyra-topbar__search-input"
            data-testid="documents-search-input"
            placeholder="Search documents by name, type, or tags…"
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            aria-label="Search documents"
          />
          {searchValue && (
            <button
              type="button"
              className="veyra-topbar__search-clear"
              onClick={() => onSearchChange?.('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Right compliance & user status */}
      <div className="veyra-topbar__right">
        {/* Compliance badges */}
        <div className="veyra-topbar__security-tags" aria-label="Security status">
          <span className="veyra-topbar__sec-pill" title="Server-Side Encryption via AWS KMS Customer Managed Key">
            <span className="veyra-topbar__sec-dot" aria-hidden="true" />
            KMS Encrypted
          </span>
          <span className="veyra-topbar__sec-pill veyra-topbar__sec-pill--hide-mobile" title="Role-Based Access Control Active">
            RBAC Active
          </span>
          <span className="veyra-topbar__sec-pill veyra-topbar__sec-pill--hide-mobile" title="Transport Layer Security Verified">
            TLS Secured
          </span>
        </div>

        {/* Identity & role */}
        <div className="veyra-topbar__identity">
          <span className="navbar__emp-id veyra-topbar__emp-id" aria-label={`Employee ID: ${employeeId ?? '—'}`}>
            {employeeId ?? '—'}
          </span>
          <span
            className={`navbar__badge veyra-topbar__badge ${roleBadgeClass()}`}
            aria-label={`Role: ${roleLabel(role)}`}
          >
            {roleLabel(role)}
          </span>
        </div>

        {/* Sign out */}
        <button
          id="sign-out-btn"
          type="button"
          className="navbar__signout veyra-topbar__signout"
          onClick={handleSignOut}
          aria-label="Sign out"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="veyra-topbar__signout-text">Sign Out</span>
        </button>
      </div>
    </header>
  )
}
