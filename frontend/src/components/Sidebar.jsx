/**
 * Sidebar.jsx
 *
 * Left navigation sidebar for VEYRA Employee Document Workspace.
 * Provides folder-tree document filtering, navigation links, and dynamic user identity.
 */
import { useAuthContext } from '../context/AuthContext'
import { roleLabel, ROLES } from '../services/authUtils'
import { DOCUMENT_FOLDERS } from '../services/fileUtils'
import './Sidebar.css'

export default function Sidebar({
  activeView = 'documents',
  onSelectView,
  activeFolder = 'all',
  onSelectFolder,
  folderCounts = {},
  mobileOpen = false,
  onCloseMobile,
}) {
  const { employeeId, role, signOut, user } = useAuthContext()

  const displayName = user?.name || user?.attributes?.name || user?.email?.split('@')[0] || (employeeId ? `User ${employeeId}` : 'Employee')

  const handleFolderClick = (folderId) => {
    onSelectFolder?.(folderId)
    onSelectView?.('documents')
    onCloseMobile?.()
  }

  const handleNavClick = (viewId) => {
    onSelectView?.(viewId)
    onCloseMobile?.()
  }

  const roleModifier = () => {
    if (role === ROLES.HR_ADMIN) return 'veyra-sidebar__badge--hr'
    if (role === ROLES.MANAGER) return 'veyra-sidebar__badge--mgr'
    return 'veyra-sidebar__badge--emp'
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="veyra-sidebar__backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside className={`veyra-sidebar ${mobileOpen ? 'veyra-sidebar--open' : ''}`}>
        {/* ── Brand ── */}
        <div className="veyra-sidebar__brand">
          <div className="veyra-sidebar__logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" fill="none"/>
              <path d="M9 4v16M15 4v16M4 10h16M4 15h16" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4"/>
              <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
            </svg>
          </div>
          <div className="veyra-sidebar__brand-text">
            <span className="veyra-sidebar__brand-title">VEYRA</span>
            <span className="veyra-sidebar__brand-sub">Document Workspace</span>
          </div>
        </div>

        {/* ── Main Navigation ── */}
        <div className="veyra-sidebar__scroll">
          <div className="veyra-sidebar__section">
            <span className="veyra-sidebar__heading">Workspace</span>
            <ul className="veyra-sidebar__menu">
              <li>
                <button
                  type="button"
                  className={`veyra-sidebar__item ${activeView === 'dashboard' ? 'veyra-sidebar__item--active' : ''}`}
                  onClick={() => handleNavClick('dashboard')}
                  aria-current={activeView === 'dashboard' ? 'page' : undefined}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  <span>Dashboard</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`veyra-sidebar__item ${activeView === 'documents' && activeFolder === 'all' ? 'veyra-sidebar__item--active' : ''}`}
                  onClick={() => handleFolderClick('all')}
                  aria-current={activeView === 'documents' && activeFolder === 'all' ? 'page' : undefined}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>Documents</span>
                  <span className="veyra-sidebar__count">{folderCounts.all ?? 0}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`veyra-sidebar__item ${activeView === 'activity' ? 'veyra-sidebar__item--active' : ''}`}
                  onClick={() => handleNavClick('activity')}
                  aria-current={activeView === 'activity' ? 'page' : undefined}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  <span>Activity</span>
                </button>
              </li>
            </ul>
          </div>

          {/* ── Document Folder Tree ── */}
          <div className="veyra-sidebar__section">
            <span className="veyra-sidebar__heading">Document Folders</span>
            <ul className="veyra-sidebar__menu">
              {DOCUMENT_FOLDERS.filter((f) => f.id !== 'all').map((folder) => {
                const isSelected = activeView === 'documents' && activeFolder === folder.id
                const count = folderCounts[folder.id] ?? 0
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      className={`veyra-sidebar__item veyra-sidebar__item--sub ${isSelected ? 'veyra-sidebar__item--active' : ''}`}
                      onClick={() => handleFolderClick(folder.id)}
                      aria-current={isSelected ? 'page' : undefined}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span className="veyra-sidebar__folder-title">{folder.label}</span>
                      {count > 0 && <span className="veyra-sidebar__count">{count}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* ── User Profile & Sign Out ── */}
        <div className="veyra-sidebar__user">
          <div className="veyra-sidebar__profile">
            <div className="veyra-sidebar__avatar" aria-hidden="true">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="veyra-sidebar__user-details">
              <span className="veyra-sidebar__user-name" title={displayName}>
                {displayName}
              </span>
              <div className="veyra-sidebar__user-meta">
                <span className="veyra-sidebar__emp-id">{employeeId ?? '—'}</span>
                <span className={`veyra-sidebar__badge ${roleModifier()}`}>
                  {roleLabel(role)}
                </span>
              </div>
            </div>
          </div>

          <button
            id="sign-out-btn"
            type="button"
            className="veyra-sidebar__signout"
            onClick={signOut}
            aria-label="Sign out of VEYRA Document Workspace"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  )
}
