/**
 * ActivityPage.jsx
 *
 * Dedicated Security & Audit Activity Workspace for VEYRA.
 * Displays chronological audit events retrieved from the authenticated GET /activity endpoint.
 * Features:
 * - Chronological event timeline / audit table
 * - Filter by action type (All, Uploads, Downloads, Deletions, Tagging, Versions, Access)
 * - Refresh button with spinner
 * - Human-readable action formatting & status badges
 * - Safe rendering (no tokens, presigned URLs, or AWS secrets)
 * - Empty & error states with retry
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { getActivity, listFiles } from '../services/api'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import './ActivityPage.css'

// Human-friendly mapping for backend audit action names
const ACTION_CONFIG = {
  UPLOAD_REQUESTED: {
    label: 'Upload Requested',
    category: 'upload',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
      </svg>
    ),
    badgeClass: 'act-badge--upload',
  },
  FILE_DOWNLOADED: {
    label: 'File Downloaded',
    category: 'download',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
    ),
    badgeClass: 'act-badge--download',
  },
  FILE_DELETED: {
    label: 'Document Soft-Deleted',
    category: 'delete',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    badgeClass: 'act-badge--delete',
  },
  TAGS_UPDATED: {
    label: 'Tags Modified',
    category: 'tag',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
    badgeClass: 'act-badge--tag',
  },
  VERSIONS_LISTED: {
    label: 'Version History Inspected',
    category: 'version',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    badgeClass: 'act-badge--version',
  },
  FILES_LISTED: {
    label: 'Documents Workspace Listed',
    category: 'access',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    badgeClass: 'act-badge--access',
  },
  ACCESS_DENIED: {
    label: 'Unauthorized Access Denied',
    category: 'security',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    ),
    badgeClass: 'act-badge--danger',
  },
}

const FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Activities' },
  { value: 'UPLOAD_REQUESTED', label: 'Uploads' },
  { value: 'FILE_DOWNLOADED', label: 'Downloads' },
  { value: 'FILE_DELETED', label: 'Deletions' },
  { value: 'TAGS_UPDATED', label: 'Tag Updates' },
  { value: 'VERSIONS_LISTED', label: 'Version Checks' },
  { value: 'ACCESS_DENIED', label: 'Security Blocks' },
]

export default function ActivityPage() {
  const { employeeId, role, user, signOut } = useAuthContext()

  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedFilter, setSelectedFilter] = useState('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [folderCounts, setFolderCounts] = useState({})
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Fetch document counts for sidebar sync
  useEffect(() => {
    let isMounted = true
    listFiles()
      .then((res) => {
        if (!isMounted) return
        const docs = res.documents || []
        const counts = { all: docs.length }
        for (const doc of docs) {
          const t = doc.document_type || 'other'
          counts[t] = (counts[t] || 0) + 1
        }
        setFolderCounts(counts)
      })
      .catch(() => {
        // Silently ignore folder count failure on Activity page
      })
    return () => {
      isMounted = false
    }
  }, [])

  // Load audit activities from GET /activity
  const loadActivity = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getActivity({ limit: 100 })
      setEvents(res.events || res.activity || [])
    } catch (err) {
      setError(err.message || 'Failed to load activity logs. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadActivity()
  }, [loadActivity])

  // Filter events by action type and optional search keyword
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (selectedFilter !== 'ALL' && ev.action !== selectedFilter) {
        return false
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase()
        const matchAction = (ev.action || '').toLowerCase().includes(query)
        const matchFile = (ev.filename || '').toLowerCase().includes(query)
        const matchDocId = (ev.document_id || '').toLowerCase().includes(query)
        const matchActor = (ev.actor_employee_id || '').toLowerCase().includes(query)
        const matchTarget = (ev.target_employee_id || '').toLowerCase().includes(query)
        return matchAction || matchFile || matchDocId || matchActor || matchTarget
      }
      return true
    })
  }, [events, selectedFilter, searchTerm])

  const formatTimestamp = (ts) => {
    if (!ts) return '—'
    try {
      const d = new Date(ts)
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return String(ts)
    }
  }

  return (
    <div className="veyra-activity-page" data-testid="activity-page">
      {/* ── Sidebar ── */}
      <Sidebar
        activeView="activity"
        folderCounts={folderCounts}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* ── Main Layout ── */}
      <div className="veyra-activity-workspace">
        {/* Top Header Navbar */}
        <Navbar
          user={user}
          role={role}
          employeeId={employeeId}
          onSignOut={signOut}
          breadcrumb="Security & Audit Activity"
          activeTab="activity"
          onOpenMobile={() => setMobileSidebarOpen(true)}
        />

        {/* Content Container */}
        <main className="veyra-activity-content" id="main-content">
          {/* Page Heading Banner */}
          <div className="act-header">
            <div className="act-header__titles">
              <h1 className="act-header__title">Activity</h1>
              <p className="act-header__subtitle">
                Security and document activity associated with your account.
              </p>
            </div>

            <div className="act-header__actions">
              <button
                type="button"
                className="act-btn act-btn--refresh"
                onClick={loadActivity}
                disabled={loading}
                aria-label="Refresh activity feed"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={loading ? 'act-spinner--spin' : ''}
                  aria-hidden="true"
                >
                  <path d="M4 4v5h.582M20 20v-5h-.581M19.364 9A9 9 0 005.636 5.636L4.582 9M4.636 15a9 9 0 0013.728 3.364l1.054-3.364" />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Controls Bar: Filter by Action & Search */}
          <section className="act-controls-card" aria-label="Activity Filters">
            <div className="act-controls-row">
              <div className="act-filter-group">
                <label htmlFor="activity-action-filter" className="act-control-label">
                  Filter by Event:
                </label>
                <select
                  id="activity-action-filter"
                  className="act-select"
                  value={selectedFilter}
                  onChange={(e) => setSelectedFilter(e.target.value)}
                  aria-label="Filter activity by action type"
                >
                  {FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="act-search-group">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="act-search-input"
                  placeholder="Filter by filename, actor, or ID…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search activity logs"
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="act-search-clear"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear activity search"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="act-count-pill" aria-label={`${filteredEvents.length} activities`}>
                {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
              </div>
            </div>
          </section>

          {/* Audit Feed / Table Container */}
          <section className="act-feed-card" aria-labelledby="activity-feed-heading">
            <h2 id="activity-feed-heading" className="sr-only">
              Chronological Activity Feed
            </h2>

            {/* Error Notice with Retry */}
            {error && (
              <div className="act-notice act-notice--error" role="alert" data-testid="activity-error">
                <div className="act-notice__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                </div>
                <div className="act-notice__body">
                  <strong>Activity Log Error</strong>
                  <p>{error}</p>
                </div>
                <button
                  type="button"
                  className="act-btn act-btn--sm act-btn--secondary"
                  onClick={loadActivity}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Loading Spinner State */}
            {loading && !error && (
              <div className="act-state-center" data-testid="activity-loading">
                <div className="act-spinner" aria-hidden="true" />
                <p>Loading security activity log…</p>
              </div>
            )}

            {/* Empty State */}
            {!loading && !error && filteredEvents.length === 0 && (
              <div className="act-state-center act-state--empty" data-testid="activity-empty">
                <div className="act-empty-icon" aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <h3>No activity recorded yet.</h3>
                <p>
                  {selectedFilter !== 'ALL' || searchTerm
                    ? 'No audit records match your current filter criteria.'
                    : 'Security audits, document uploads, downloads, and version views will be logged here.'}
                </p>
                {(selectedFilter !== 'ALL' || searchTerm) && (
                  <button
                    type="button"
                    className="act-btn act-btn--sm act-btn--secondary"
                    onClick={() => {
                      setSelectedFilter('ALL')
                      setSearchTerm('')
                    }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            )}

            {/* Real Chronological Activity Event Table */}
            {!loading && !error && filteredEvents.length > 0 && (
              <div className="act-table-wrap">
                <table className="act-table">
                  <thead>
                    <tr>
                      <th scope="col" className="act-col--action">Action & Event</th>
                      <th scope="col" className="act-col--status">Result</th>
                      <th scope="col" className="act-col--document">Document Reference</th>
                      <th scope="col" className="act-col--actor">Actor / Target</th>
                      <th scope="col" className="act-col--time">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((ev, idx) => {
                      const cfg = ACTION_CONFIG[ev.action] || {
                        label: ev.action || 'System Event',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                          </svg>
                        ),
                        badgeClass: 'act-badge--default',
                      }

                      const isSuccess = (ev.result || 'SUCCESS').toUpperCase() === 'SUCCESS'

                      return (
                        <tr key={ev.log_id || `ev-${idx}`} data-testid={`activity-row-${idx}`}>
                          {/* Action Column */}
                          <td className="act-col--action">
                            <div className="act-item-header">
                              <span className={`act-icon-wrap ${cfg.badgeClass}`} aria-hidden="true">
                                {cfg.icon}
                              </span>
                              <div className="act-item-text">
                                <span className="act-item-title">{cfg.label}</span>
                                <span className="act-item-raw-action">{ev.action}</span>
                              </div>
                            </div>
                          </td>

                          {/* Result Column */}
                          <td className="act-col--status">
                            <span
                              className={`act-status-badge ${
                                isSuccess ? 'act-status-badge--success' : 'act-status-badge--denied'
                              }`}
                            >
                              <span className="act-status-dot" aria-hidden="true" />
                              {ev.result || 'SUCCESS'}
                            </span>
                          </td>

                          {/* Document Details */}
                          <td className="act-col--document">
                            {ev.filename ? (
                              <div className="act-doc-cell">
                                <span className="act-doc-name">{ev.filename}</span>
                                {ev.document_type && (
                                  <span className="act-doc-type">{ev.document_type}</span>
                                )}
                              </div>
                            ) : ev.document_id ? (
                              <span className="act-doc-id">{ev.document_id}</span>
                            ) : (
                              <span className="act-text-muted">—</span>
                            )}
                          </td>

                          {/* Actor context */}
                          <td className="act-col--actor">
                            <div className="act-actor-cell">
                              <span className="act-actor-id">
                                {ev.actor_employee_id || employeeId || 'Employee'}
                              </span>
                              {ev.target_employee_id && ev.target_employee_id !== ev.actor_employee_id && (
                                <span className="act-target-id">for {ev.target_employee_id}</span>
                              )}
                            </div>
                          </td>

                          {/* Timestamp */}
                          <td className="act-col--time">
                            <time dateTime={ev.timestamp} className="act-time-text">
                              {formatTimestamp(ev.timestamp)}
                            </time>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
