/**
 * DashboardPage.jsx
 *
 * VEYRA — Executive Overview & Home Workspace (/dashboard)
 * High-level overview:
 * - Welcome banner & employee identity
 * - Quick CTAs: "Upload Document" (navigates to /documents?upload=true) and "View Documents"
 * - 4 Key Metrics: Active Documents, Role Access, SSE-KMS Active, Audit Logging
 * - Compact Recent Documents (3–5 items) with quick download and "View all documents →" link
 * - Recent Activity Summary (3–5 items) with "View full activity log →" link
 * - Security & Compliance status summary
 *
 * Note: Does NOT duplicate the full document table or upload form.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Navbar from '../components/Navbar'
import ClassificationBadge from '../components/ClassificationBadge'
import { useAuthContext } from '../context/AuthContext'
import { roleLabel, isHRAdmin, isManagerOrAbove } from '../services/authUtils'
import { listFiles, getDownloadUrl, deleteFile, getActivity } from '../services/api'
import { getErrorMessage } from '../services/errorMessages'
import { getDocumentTypeLabel, getDocumentClassification, DOCUMENT_FOLDERS } from '../services/fileUtils'
import './DashboardPage.css'

function formatTimestamp(ts) {
  if (!ts) return '—'
  const num = Number(ts)
  if (isNaN(num) || num <= 0) return String(ts)
  const d = new Date(num)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function welcomeMessage(role) {
  if (isHRAdmin(role))
    return 'You have full access to all employee documents, audit records, and platform settings.'
  if (isManagerOrAbove(role))
    return 'You can view and download documents for employees in your team.'
  return 'You can upload, view, and download your own documents securely.'
}

function formatActionLabel(action) {
  switch (action) {
    case 'UPLOAD_REQUESTED': return 'Document Uploaded'
    case 'FILE_DOWNLOADED': return 'Document Downloaded'
    case 'FILE_DELETED': return 'Document Deleted'
    case 'TAGS_UPDATED': return 'Tags Updated'
    case 'VERSIONS_LISTED': return 'Versions Viewed'
    case 'FILES_LISTED': return 'Documents Listed'
    case 'ACCESS_DENIED': return 'Access Denied'
    default: return action?.replace(/_/g, ' ') || 'Activity Event'
  }
}

export default function DashboardPage() {
  const { employeeId, role, signOut, user } = useAuthContext()
  const navigate = useNavigate()

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [docsError, setDocsError] = useState(null)
  const [activities, setActivities] = useState([])
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionSuccess, setActionSuccess] = useState(null)

  const isAnyActionBusy = Boolean(downloadingId || deletingId)

  const displayName = user?.name || user?.attributes?.name || user?.email?.split('@')[0] || (employeeId ? `Employee ${employeeId}` : 'Employee')

  // Keep auth callbacks stable
  const authRef = useRef({ signOut, navigate })
  useEffect(() => {
    authRef.current = { signOut, navigate }
  }, [signOut, navigate])

  const handleAuthExpired = useCallback(async () => {
    try {
      await authRef.current.signOut?.()
    } finally {
      authRef.current.navigate('/login', {
        replace: true,
        state: { error: 'Your session has expired. Please sign in again.' },
      })
    }
  }, [])

  // Fetch document list
  const loadDocuments = useCallback(async () => {
    if (!employeeId) return
    setLoadingDocs(true)
    setDocsError(null)
    try {
      const data = await listFiles(employeeId)
      const docList = Array.isArray(data?.documents) ? data.documents : []
      setDocuments(docList)
    } catch (err) {
      if (err?.status === 401 || err?.isUnauthorized) {
        await handleAuthExpired()
        return
      }
      setDocsError(getErrorMessage(err, 'Unable to load documents. Please check your connection and retry.'))
    } finally {
      setLoadingDocs(false)
    }
  }, [employeeId, handleAuthExpired])

  // Fetch recent activity
  const loadActivity = useCallback(async () => {
    if (!employeeId) return
    setLoadingActivity(true)
    try {
      const data = await getActivity({ limit: 5 })
      const list = Array.isArray(data?.activity) ? data.activity : []
      setActivities(list)
    } catch {
      // Activity fetch failure shouldn't block dashboard
      setActivities([])
    } finally {
      setLoadingActivity(false)
    }
  }, [employeeId])

  useEffect(() => {
    loadDocuments()
    loadActivity()
  }, [loadDocuments, loadActivity])

  // Compute folder counts
  const folderCounts = useMemo(() => {
    const counts = { all: documents.length }
    for (const folder of DOCUMENT_FOLDERS) {
      if (folder.id !== 'all') {
        counts[folder.id] = documents.filter((d) => d.document_type === folder.id).length
      }
    }
    return counts
  }, [documents])

  // Recent 5 documents
  const recentDocuments = useMemo(() => {
    return [...documents]
      .sort((a, b) => Number(b.upload_timestamp || 0) - Number(a.upload_timestamp || 0))
      .slice(0, 5)
  }, [documents])

  // Quick download from dashboard
  const handleDownload = async (doc) => {
    if (!doc?.document_id) return
    setDownloadingId(doc.document_id)
    setActionError(null)
    try {
      const data = await getDownloadUrl(doc.document_id)
      if (data?.download_url) {
        window.open(data.download_url, '_blank', 'noopener,noreferrer')
      } else {
        throw new Error('Presigned download URL was not returned by vault server.')
      }
    } catch (err) {
      if (err?.status === 401) {
        await handleAuthExpired()
        return
      }
      setActionError(getErrorMessage(err, `Failed to download "${doc.filename || 'document'}".`))
    } finally {
      setDownloadingId(null)
    }
  }

  // Quick delete from dashboard with confirmation
  const handleDelete = async (doc) => {
    if (!doc?.document_id) return
    const confirmed = window.confirm(
      `Are you sure you want to delete "${doc.filename || 'this document'}"?\n\nThis will soft-delete the document record from your vault.`
    )
    if (!confirmed) return

    setDeletingId(doc.document_id)
    setActionError(null)
    setActionSuccess(null)
    const prevDocs = [...documents]
    setDocuments((prev) => prev.filter((d) => d.document_id !== doc.document_id))
    try {
      await deleteFile(doc.document_id)
      setActionSuccess(`"${doc.filename || 'Document'}" was deleted successfully.`)
    } catch (err) {
      setDocuments(prevDocs)
      if (err?.status === 401) {
        await handleAuthExpired()
        return
      }
      setActionError(getErrorMessage(err, `Failed to delete "${doc.filename || 'document'}".`))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="veyra-dashboard-page" data-testid="dashboard-page">
      {/* ── Sidebar Navigation ── */}
      <Sidebar
        activeView="dashboard"
        onSelectView={(view) => {
          if (view === 'documents') navigate('/documents')
          if (view === 'activity') navigate('/activity')
        }}
        activeFolder="all"
        onSelectFolder={(folderId) => {
          navigate(folderId === 'all' ? '/documents' : `/documents?folder=${folderId}`)
        }}
        folderCounts={folderCounts}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* ── Main Workspace Content ── */}
      <div className="veyra-dashboard-main">
        <Navbar
          breadcrumbs={['Workspace', 'Dashboard']}
          onToggleMobile={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          showSearch={false}
        />

        <main className="veyra-dashboard-content" id="main-content">
          {/* Action Alerts */}
          {actionError && (
            <div className="dash-alert dash-alert--danger" role="alert" data-testid="action-error">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {actionSuccess && (
            <div className="dash-alert dash-alert--success" role="status" data-testid="action-success">
              <span>{actionSuccess}</span>
              <button type="button" onClick={() => setActionSuccess(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {/* ── Welcome Hero Banner ── */}
          <section className="dash-hero" aria-label="Workspace summary">
            <div className="dash-hero__main">
              <div className="dash-hero__identity">
                <span className="dash-hero__greeting">Welcome back, {displayName}</span>
                <h1 className="dash-hero__title">
                  VEYRA Overview · <span className="dash-hero__emp-id" data-testid="dashboard-employee-id">{employeeId ?? '—'}</span>
                </h1>
                <p className="dash-hero__message" data-testid="dashboard-role-message">
                  {welcomeMessage(role)}
                </p>
              </div>

              {/* Primary & Secondary Quick Actions */}
              <div className="dash-hero__quick-actions">
                <button
                  id="dash-upload-btn"
                  type="button"
                  className="dash-btn dash-btn--primary"
                  onClick={() => navigate('/documents?upload=true')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Upload Document</span>
                </button>

                <button
                  id="dash-view-docs-btn"
                  type="button"
                  className="dash-btn dash-btn--secondary"
                  onClick={() => navigate('/documents')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>View Documents</span>
                </button>
              </div>
            </div>

            {/* Account & Security Summary Grid */}
            <div className="dash-stats-grid">
              <div className="dash-stat-card">
                <div className="dash-stat-card__icon dash-stat-card__icon--blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="dash-stat-card__content">
                  <span className="dash-stat-card__label">Active Documents</span>
                  <div className="dash-stat-card__value" data-testid="dashboard-doc-count">
                    {loadingDocs ? '—' : documents.length}
                  </div>
                  <span className="dash-stat-card__sub">Files in corporate vault</span>
                </div>
              </div>

              <div className="dash-stat-card">
                <div className="dash-stat-card__icon dash-stat-card__icon--indigo">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div className="dash-stat-card__content">
                  <span className="dash-stat-card__label">Role Access</span>
                  <div className="dash-stat-card__value" data-testid="dashboard-role-card">
                    {roleLabel(role)}
                  </div>
                  <span className="dash-stat-card__sub" data-testid="dashboard-emp-id-card">
                    ID: {employeeId ?? '—'}
                  </span>
                </div>
              </div>

              <div className="dash-stat-card">
                <div className="dash-stat-card__icon dash-stat-card__icon--green">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <div className="dash-stat-card__content">
                  <span className="dash-stat-card__label">Storage Security</span>
                  <div className="dash-stat-card__value dash-stat-card__value--text">
                    SSE-KMS Active
                  </div>
                  <span className="dash-stat-card__sub">Customer Managed Key</span>
                </div>
              </div>

              <div className="dash-stat-card">
                <div className="dash-stat-card__icon dash-stat-card__icon--amber">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div className="dash-stat-card__content">
                  <span className="dash-stat-card__label">Audit Logging</span>
                  <div className="dash-stat-card__value dash-stat-card__value--text">
                    Append-Only
                  </div>
                  <span className="dash-stat-card__sub">DynamoDB AuditLog</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Two-Column Overview Layout ── */}
          <div className="dash-columns">
            {/* Left: Compact Recent Documents Preview (3–5 items) */}
            <section className="dash-card dash-card--left" aria-label="Recent documents">
              <div className="dash-card__header">
                <div className="dash-card__title-group">
                  <h2 className="dash-card__title">Recent Documents</h2>
                  <span className="dash-card__badge">{recentDocuments.length} latest</span>
                </div>
                <Link to="/documents" className="dash-card__link">
                  Open Documents Workspace →
                </Link>
              </div>

              {loadingDocs ? (
                <div className="dash-state-box" data-testid="documents-loading">
                  <div className="dash-spinner" />
                  <p>Loading vault items…</p>
                </div>
              ) : docsError ? (
                <div className="dash-state-box dash-state-box--error" data-testid="documents-error">
                  <p>{docsError}</p>
                  <button type="button" className="dash-btn dash-btn--secondary dash-btn--sm" onClick={loadDocuments}>
                    Retry
                  </button>
                </div>
              ) : documents.length === 0 ? (
                <div className="dash-state-box" data-testid="documents-empty">
                  <div className="dash-state-box__icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <h3>No documents uploaded yet</h3>
                  <p>Upload your first corporate document to start organizing files in VEYRA.</p>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary dash-btn--sm"
                    onClick={() => navigate('/documents?upload=true')}
                  >
                    Upload Document
                  </button>
                </div>
              ) : (
                <ul className="dash-recent-list">
                  {recentDocuments.map((doc) => (
                    <li key={doc.document_id} className="dash-recent-item" data-testid={`doc-row-${doc.document_id}`}>
                      <div className="dash-recent-item__icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>

                      <div className="dash-recent-item__info">
                        <span className="dash-recent-item__name" title={doc.filename}>
                          {doc.filename || 'Untitled Document'}
                        </span>
                        <div className="dash-recent-item__meta">
                          <span className="dash-type-pill">{getDocumentTypeLabel(doc.document_type)}</span>
                          <span className="dash-date">{formatTimestamp(doc.upload_timestamp)}</span>
                        </div>
                      </div>

                      <div className="dash-recent-item__badges">
                        <ClassificationBadge classification={getDocumentClassification(doc)} />
                      </div>

                      <div className="dash-recent-item__actions">
                        <button
                          type="button"
                          className="dash-action-btn"
                          onClick={() => handleDownload(doc)}
                          disabled={isAnyActionBusy}
                          title={`Download ${doc.filename}`}
                          aria-label={`Download ${doc.filename}`}
                          data-testid={`download-btn-${doc.document_id}`}
                        >
                          {downloadingId === doc.document_id ? (
                            <span className="dash-mini-spinner" />
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="dash-action-btn dash-action-btn--danger"
                          onClick={() => handleDelete(doc)}
                          disabled={isAnyActionBusy}
                          title={`Delete ${doc.filename}`}
                          aria-label={`Delete ${doc.filename}`}
                          data-testid={`delete-btn-${doc.document_id}`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {documents.length > 0 && (
                <div className="dash-card__footer">
                  <Link to="/documents" className="dash-btn dash-btn--subtle dash-btn--sm">
                    View all documents ({documents.length}) →
                  </Link>
                </div>
              )}
            </section>

            {/* Right: Recent Activity Summary & Security Compliance */}
            <div className="dash-right-column">
              {/* Recent Activity Card */}
              <section className="dash-card" aria-label="Recent activity summary">
                <div className="dash-card__header">
                  <div className="dash-card__title-group">
                    <h2 className="dash-card__title">Recent Activity</h2>
                    <span className="dash-card__badge">Latest Events</span>
                  </div>
                  <Link to="/activity" className="dash-card__link">
                    View full log →
                  </Link>
                </div>

                {loadingActivity ? (
                  <div className="dash-state-box">
                    <div className="dash-spinner" />
                    <p>Loading activity…</p>
                  </div>
                ) : activities.length === 0 ? (
                  <div className="dash-state-box">
                    <p className="dash-state-box__empty-text">No recent security or document events recorded.</p>
                  </div>
                ) : (
                  <ul className="dash-activity-list">
                    {activities.slice(0, 5).map((act) => (
                      <li key={act.log_id || act.timestamp} className="dash-activity-item">
                        <div className={`dash-activity-dot ${act.result === 'DENIED' ? 'dash-activity-dot--denied' : 'dash-activity-dot--success'}`} />
                        <div className="dash-activity-content">
                          <span className="dash-activity-action">{formatActionLabel(act.action)}</span>
                          <span className="dash-activity-meta">
                            {act.filename ? `${act.filename} · ` : ''}{formatTimestamp(act.timestamp)}
                          </span>
                        </div>
                        <span className={`dash-activity-badge ${act.result === 'DENIED' ? 'dash-activity-badge--denied' : 'dash-activity-badge--success'}`}>
                          {act.result}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="dash-card__footer">
                  <Link to="/activity" className="dash-btn dash-btn--subtle dash-btn--sm">
                    Open Activity Log →
                  </Link>
                </div>
              </section>

              {/* Security & Workspace Summary */}
              <section className="dash-card" aria-label="Security & Compliance">
                <div className="dash-card__header">
                  <h2 className="dash-card__title">Security & Compliance</h2>
                </div>

                <div className="dash-security-list">
                  <div className="dash-sec-item">
                    <div className="dash-sec-item__icon dash-sec-item__icon--check">✓</div>
                    <div className="dash-sec-item__text">
                      <strong>KMS Customer Managed Encryption</strong>
                      <p>All object payloads are encrypted at rest with AWS KMS before S3 storage.</p>
                    </div>
                  </div>

                  <div className="dash-sec-item">
                    <div className="dash-sec-item__icon dash-sec-item__icon--check">✓</div>
                    <div className="dash-sec-item__text">
                      <strong>Role-Based Access Enforcement</strong>
                      <p>Cognito JWT verification enforces strict boundaries between Employees, Managers, and HR Admins.</p>
                    </div>
                  </div>

                  <div className="dash-sec-item">
                    <div className="dash-sec-item__icon dash-sec-item__icon--check">✓</div>
                    <div className="dash-sec-item__text">
                      <strong>Immutable Audit Logging</strong>
                      <p>Every download, upload, delete, and tag modification emits an append-only audit event.</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
