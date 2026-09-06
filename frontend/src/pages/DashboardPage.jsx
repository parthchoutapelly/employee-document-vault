/**
 * DashboardPage.jsx
 *
 * VEYRA — Employee Document Workspace
 * Complete enterprise document management experience.
 *
 * Features:
 * - Sidebar with folder-like tree navigation by document type
 * - Topbar with breadcrumbs, compliance status, and metadata search
 * - Document browser with multi-field search filtering (filename, type, tags, emp ID)
 * - Sorting by upload date, document type, and filename (asc / desc)
 * - Authentic document categorization and tags display
 * - S3 Object Version History drawer
 * - Soft-delete with confirmation dialog and optimistic UI rollback
 * - Direct-to-S3 presigned uploads and secure downloads
 * - Strict RBAC enforcement and error mapping
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Navbar from '../components/Navbar'
import DocumentUpload from '../components/DocumentUpload'
import VersionHistoryDrawer from '../components/VersionHistoryDrawer'
import { useAuthContext } from '../context/AuthContext'
import { roleLabel, isHRAdmin, isManagerOrAbove } from '../services/authUtils'
import { listFiles, getDownloadUrl, deleteFile, updateDocumentTags } from '../services/api'
import { getErrorMessage } from '../services/errorMessages'
import { DOCUMENT_FOLDERS, getDocumentTypeLabel, getDefaultTags } from '../services/fileUtils'
import './DashboardPage.css'

/** Formats epoch millisecond timestamps into readable dates */
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

/** Short contextual message personalised to the role */
function welcomeMessage(role) {
  if (isHRAdmin(role))
    return 'You have full access to all employee documents, audit records, and platform settings.'
  if (isManagerOrAbove(role))
    return 'You can view and download documents for employees in your team.'
  return 'You can upload, view, and download your own documents securely.'
}

export default function DashboardPage() {
  const { employeeId, role, signOut } = useAuthContext()
  const navigate = useNavigate()

  // Navigation state
  const [activeView, setActiveView] = useState('documents') // 'dashboard' | 'documents' | 'activity'
  const [activeFolder, setActiveFolder] = useState('all')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Document data state
  const [documents, setDocuments] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [docsError, setDocsError] = useState(null)

  // Search & sorting state
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('date') // 'date' | 'type' | 'filename'
  const [sortOrder, setSortOrder] = useState('desc') // 'asc' | 'desc'

  // Document interaction state
  const [downloadingId, setDownloadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionSuccess, setActionSuccess] = useState(null)

  // Version history drawer state
  const [versionDrawerDoc, setVersionDrawerDoc] = useState(null)

  // Document tags editing state
  const [editingTagsDocId, setEditingTagsDocId] = useState(null)
  const [newTagInput, setNewTagInput] = useState('')
  const [savingTagsDocId, setSavingTagsDocId] = useState(null)

  // Keep auth callbacks stable across renders
  const authRef = useRef({ signOut, navigate })
  useEffect(() => {
    authRef.current = { signOut, navigate }
  }, [signOut, navigate])

  // Handle expired/invalid session (401 from API)
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

  // Fetch document list for authenticated employee
  const loadDocuments = useCallback(async () => {
    if (!employeeId) return
    setLoadingDocs(true)
    setDocsError(null)
    try {
      const data = await listFiles(employeeId)
      setDocuments(Array.isArray(data?.documents) ? data.documents : [])
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

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  // Compute live folder counts
  const folderCounts = useMemo(() => {
    const counts = { all: documents.length }
    DOCUMENT_FOLDERS.forEach((f) => {
      if (f.id !== 'all') {
        counts[f.id] = documents.filter((d) => d.document_type === f.type).length
      }
    })
    return counts
  }, [documents])

  // Filter and sort documents based on active folder, search query, and sort settings
  const filteredAndSortedDocs = useMemo(() => {
    let result = [...documents]

    // 1. Folder filter
    if (activeFolder !== 'all') {
      result = result.filter((doc) => doc.document_type === activeFolder)
    }

    // 2. Metadata Search filter (filename, type, tags, employeeId, status)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((doc) => {
        const filename = (doc.filename || '').toLowerCase()
        const docType = (doc.document_type || '').toLowerCase()
        const docTypeLabel = getDocumentTypeLabel(doc.document_type).toLowerCase()
        const empId = (doc.employee_id || '').toLowerCase()
        const status = (doc.status || '').toLowerCase()
        const tags = (
          Array.isArray(doc.tags) && doc.tags.length > 0
            ? doc.tags
            : getDefaultTags(doc.document_type)
        ).map((t) => t.toLowerCase())

        return (
          filename.includes(q) ||
          docType.includes(q) ||
          docTypeLabel.includes(q) ||
          empId.includes(q) ||
          status.includes(q) ||
          tags.some((tag) => tag.includes(q))
        )
      })
    }

    // 3. Sorting
    result.sort((a, b) => {
      let comparison = 0
      if (sortBy === 'date') {
        const timeA = Number(a.upload_timestamp) || 0
        const timeB = Number(b.upload_timestamp) || 0
        comparison = timeA - timeB
      } else if (sortBy === 'type') {
        const typeA = (a.document_type || '').toLowerCase()
        const typeB = (b.document_type || '').toLowerCase()
        comparison = typeA.localeCompare(typeB)
      } else if (sortBy === 'filename') {
        const nameA = (a.filename || '').toLowerCase()
        const nameB = (b.filename || '').toLowerCase()
        comparison = nameA.localeCompare(nameB)
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    return result
  }, [documents, activeFolder, searchQuery, sortBy, sortOrder])

  // Save tags to DynamoDB via PATCH /files/{doc_id} with optimistic UI update
  const saveDocumentTags = async (doc, updatedTags) => {
    setSavingTagsDocId(doc.document_id)
    setActionError(null)
    const prevDocs = [...documents]

    // Optimistic UI update
    setDocuments((prev) =>
      prev.map((d) => (d.document_id === doc.document_id ? { ...d, tags: updatedTags } : d))
    )

    try {
      await updateDocumentTags(doc.document_id, updatedTags)
      setActionSuccess(`Tags updated for "${doc.filename || 'document'}".`)
    } catch (err) {
      // Rollback on failure
      setDocuments(prevDocs)
      if (err?.status === 401 || err?.isUnauthorized) {
        await handleAuthExpired()
        return
      }
      setActionError(getErrorMessage(err, 'Failed to update tags in DynamoDB.'))
    } finally {
      setSavingTagsDocId(null)
    }
  }

  // Add tag handler with validation
  const handleAddTag = async (doc, rawTag) => {
    const trimmed = rawTag.trim()
    if (!trimmed) return
    if (trimmed.length > 30) {
      setActionError('Tag must be 30 characters or less.')
      return
    }
    const currentTags = Array.isArray(doc.tags) && doc.tags.length > 0 ? doc.tags : getDefaultTags(doc.document_type)
    if (currentTags.length >= 5) {
      setActionError('A maximum of 5 tags is permitted per document.')
      return
    }
    if (currentTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setActionError(`Tag "${trimmed}" already exists on this document.`)
      return
    }

    const updatedTags = [...currentTags, trimmed]
    await saveDocumentTags(doc, updatedTags)
    setNewTagInput('')
    setEditingTagsDocId(null)
  }

  // Remove tag handler
  const handleRemoveTag = async (doc, tagToRemove) => {
    const currentTags = Array.isArray(doc.tags) && doc.tags.length > 0 ? doc.tags : getDefaultTags(doc.document_type)
    const updatedTags = currentTags.filter((t) => t !== tagToRemove)
    await saveDocumentTags(doc, updatedTags)
  }

  // Download handler: GET /download/{doc_id} -> presigned URL -> open in tab
  const handleDownload = async (doc) => {
    if (!doc?.document_id || downloadingId || deletingId) return
    setDownloadingId(doc.document_id)
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await getDownloadUrl(doc.document_id)
      if (res?.download_url) {
        window.open(res.download_url, '_blank', 'noopener,noreferrer')
      } else {
        throw new Error('Download link not provided by server.')
      }
    } catch (err) {
      if (err?.status === 401 || err?.isUnauthorized) {
        await handleAuthExpired()
        return
      }
      setActionError(getErrorMessage(err, 'Failed to retrieve download link.'))
    } finally {
      setDownloadingId(null)
    }
  }

  // Delete handler: prompt confirmation -> DELETE /files/{doc_id} -> refresh list
  const handleDelete = async (doc) => {
    if (!doc?.document_id || downloadingId || deletingId) return
    const name = doc.filename || 'this document'
    const confirmed = window.confirm(`Are you sure you want to delete "${name}"? This document will be removed from your active document list.`)
    if (!confirmed) return

    setDeletingId(doc.document_id)
    setActionError(null)
    setActionSuccess(null)
    try {
      await deleteFile(doc.document_id)
      setActionSuccess(`"${name}" was deleted successfully.`)
      // Optimistic UI update
      setDocuments((prev) => prev.filter((d) => d.document_id !== doc.document_id))
      loadDocuments()
    } catch (err) {
      if (err?.status === 401 || err?.isUnauthorized) {
        await handleAuthExpired()
        return
      }
      setActionError(getErrorMessage(err, 'Failed to delete document.'))
    } finally {
      setDeletingId(null)
    }
  }

  const isAnyActionBusy = Boolean(downloadingId || deletingId)

  // Determine current active folder definition
  const currentFolderDef = DOCUMENT_FOLDERS.find((f) => f.id === activeFolder) || DOCUMENT_FOLDERS[0]

  // Breadcrumbs path
  const breadcrumbs = useMemo(() => {
    if (activeView === 'dashboard') return ['Workspace', 'Dashboard']
    if (activeView === 'activity') return ['Workspace', 'Audit & Activity']
    return ['Workspace', 'Documents', currentFolderDef.label]
  }, [activeView, currentFolderDef])

  return (
    <div className="veyra-layout" data-testid="dashboard-page">
      {/* ── Left Sidebar Navigation ── */}
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        activeFolder={activeFolder}
        onSelectFolder={(folderId) => {
          setActiveFolder(folderId)
          setActiveView('documents')
        }}
        folderCounts={folderCounts}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* ── Main App Shell ── */}
      <div className="veyra-main">
        {/* Top Navbar */}
        <Navbar
          breadcrumbs={breadcrumbs}
          onToggleMobile={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          showSearch={activeView === 'documents'}
        />

        {/* Workspace Content Area */}
        <main className="veyra-content">

          {/* ── Top Hero / Metrics Strip (Ensures required test IDs are always available) ── */}
          <section className="dash-hero veyra-hero" aria-labelledby="dash-welcome-heading">
            <div className="veyra-hero__header">
              <div>
                <h1 id="dash-welcome-heading" className="dash-hero__heading veyra-hero__title">
                  Welcome back,{' '}
                  <span
                    className="dash-hero__emp-id veyra-hero__emp-id"
                    aria-label={`Employee ID ${employeeId}`}
                    data-testid="dashboard-employee-id"
                  >
                    {employeeId ?? '—'}
                  </span>
                </h1>
                <p className="dash-hero__message veyra-hero__subtitle" data-testid="dashboard-role-message">
                  {welcomeMessage(role)}
                </p>
              </div>

              <div className="veyra-hero__security-badges">
                <span className="veyra-badge veyra-badge--security">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  KMS Encrypted
                </span>
                <span className="veyra-badge veyra-badge--security">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  RBAC Active
                </span>
                <span className="veyra-badge veyra-badge--security">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  TLS Secured
                </span>
              </div>
            </div>

            {/* Quick Metrics Cards */}
            <div className="dash-cards veyra-metrics-grid" aria-label="Account overview">
              <div className="dash-card veyra-metric-card">
                <div className="dash-card__body veyra-metric-card__body">
                  <p className="dash-card__label veyra-metric-card__label">Employee ID</p>
                  <p className="dash-card__value veyra-metric-card__value" data-testid="dashboard-emp-id-card">
                    {employeeId ?? '—'}
                  </p>
                </div>
              </div>

              <div className="dash-card veyra-metric-card">
                <div className="dash-card__body veyra-metric-card__body">
                  <p className="dash-card__label veyra-metric-card__label">Access Role</p>
                  <p className="dash-card__value dash-card__value--role veyra-metric-card__value" data-testid="dashboard-role-card">
                    {roleLabel(role)}
                  </p>
                </div>
              </div>

              <div className="dash-card veyra-metric-card">
                <div className="dash-card__body veyra-metric-card__body">
                  <p className="dash-card__label veyra-metric-card__label">Active Documents</p>
                  <p className="dash-card__value veyra-metric-card__value" data-testid="dashboard-doc-count">
                    {loadingDocs ? '…' : documents.length}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Document Upload Section ── */}
          <DocumentUpload onUploadSuccess={loadDocuments} />

          {/* ── Alert Banners (Action error / success) ── */}
          {actionError && (
            <div className="dash-alert dash-alert--error veyra-alert veyra-alert--error" role="alert" data-testid="action-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>{actionError}</span>
              <button
                type="button"
                className="dash-alert__close veyra-alert__close"
                onClick={() => setActionError(null)}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {actionSuccess && (
            <div className="dash-alert dash-alert--success veyra-alert veyra-alert--success" role="status" data-testid="action-success">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span>{actionSuccess}</span>
              <button
                type="button"
                className="dash-alert__close veyra-alert__close"
                onClick={() => setActionSuccess(null)}
                aria-label="Dismiss success notice"
              >
                ×
              </button>
            </div>
          )}

          {/* ── Main Document Browser Section ── */}
          <section className="dash-documents veyra-browser" aria-labelledby="documents-heading">
            {/* Browser Control Bar */}
            <div className="dash-documents__header veyra-browser__header">
              <div className="dash-documents__title-group veyra-browser__title-group">
                <div className="veyra-browser__heading-wrap">
                  <h2 id="documents-heading" className="dash-documents__title veyra-browser__title">
                    {activeFolder === 'all' ? 'All Documents' : currentFolderDef.label}
                  </h2>
                  <span className="dash-documents__count veyra-browser__count-pill" aria-label={`${filteredAndSortedDocs.length} documents`}>
                    {filteredAndSortedDocs.length} {filteredAndSortedDocs.length === 1 ? 'file' : 'files'}
                  </span>
                </div>
                {activeFolder !== 'all' && (
                  <button
                    type="button"
                    className="veyra-browser__view-all-link"
                    onClick={() => setActiveFolder('all')}
                  >
                    View All Categories
                  </button>
                )}
              </div>

              {/* Controls: Search, Sort, Refresh */}
              <div className="veyra-browser__controls">
                {/* Search Bar */}
                <div className="veyra-browser__search-box">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    className="veyra-browser__search-input"
                    placeholder="Filter metadata…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Filter document metadata"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="veyra-browser__search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear filter"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Sort Control */}
                <div className="veyra-browser__sort-group">
                  <label htmlFor="doc-sort-select" className="veyra-browser__sort-label">Sort:</label>
                  <select
                    id="doc-sort-select"
                    className="veyra-browser__sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    aria-label="Sort documents by"
                  >
                    <option value="date">Upload Date</option>
                    <option value="type">Document Type</option>
                    <option value="filename">Filename</option>
                  </select>

                  <button
                    type="button"
                    className="veyra-browser__sort-order-btn"
                    onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                    title={sortOrder === 'asc' ? 'Sort Ascending' : 'Sort Descending'}
                    aria-label={`Sort order: ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
                  >
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </button>
                </div>

                {/* Refresh Button */}
                <button
                  className="dash-documents__refresh-btn veyra-browser__refresh-btn"
                  onClick={loadDocuments}
                  disabled={loadingDocs || isAnyActionBusy}
                  aria-label="Refresh document list"
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
                    className={loadingDocs ? 'dash-documents__spin' : ''}
                    aria-hidden="true"
                  >
                    <path d="M4 4v5h.582M20 20v-5h-.581M19.364 9A9 9 0 005.636 5.636L4.582 9M4.636 15a9 9 0 0013.728 3.364l1.054-3.364" />
                  </svg>
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Folder Pill Strip */}
            <div className="veyra-browser__folder-pills" role="tablist" aria-label="Document categories">
              {DOCUMENT_FOLDERS.map((folder) => {
                const isSelected = activeFolder === folder.id
                const count = folderCounts[folder.id] ?? 0
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`veyra-browser__folder-pill ${isSelected ? 'veyra-browser__folder-pill--active' : ''}`}
                    onClick={() => setActiveFolder(folder.id)}
                  >
                    <span>{folder.label}</span>
                    <span className="veyra-browser__folder-pill-count">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Document list states */}
            {loadingDocs ? (
              <div className="docs-state docs-state--loading veyra-state-box" data-testid="documents-loading">
                <div className="docs-spinner veyra-spinner" role="status" aria-label="Loading documents…" />
                <p>Loading document records…</p>
              </div>
            ) : docsError ? (
              <div className="docs-state docs-state--error veyra-state-box veyra-state-box--error" data-testid="documents-error">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p className="docs-state__title">Unable to load documents</p>
                <p className="docs-state__msg">{docsError}</p>
                <button
                  className="docs-state__retry-btn veyra-btn veyra-btn--primary"
                  onClick={loadDocuments}
                >
                  Retry
                </button>
              </div>
            ) : filteredAndSortedDocs.length === 0 ? (
              <div className="docs-state docs-state--empty veyra-state-box" data-testid="documents-empty">
                <div className="veyra-state-box__icon" aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/>
                    <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/>
                  </svg>
                </div>
                <p className="docs-state__title">
                  {searchQuery ? 'No matching documents found' : 'No documents uploaded yet'}
                </p>
                <p className="docs-state__msg">
                  {searchQuery
                    ? `No document metadata matched "${searchQuery}". Clear your search query to see all items.`
                    : 'Files uploaded to your employee vault will appear here.'}
                </p>
                {searchQuery && (
                  <button
                    type="button"
                    className="veyra-btn veyra-btn--secondary"
                    onClick={() => setSearchQuery('')}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            ) : (
              <div className="docs-table-container veyra-table-wrap">
                <table className="docs-table veyra-table" aria-label="Uploaded documents">
                  <thead>
                    <tr>
                      <th scope="col" className="veyra-table__th-name">Document</th>
                      <th scope="col" className="veyra-table__th-type">Type</th>
                      <th scope="col" className="veyra-table__th-date">Uploaded</th>
                      <th scope="col" className="veyra-table__th-tags">Tags</th>
                      <th scope="col" className="veyra-table__th-status">Status</th>
                      <th scope="col" className="docs-table__col-actions veyra-table__th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedDocs.map((doc) => {
                      const isDownloading = downloadingId === doc.document_id
                      const isDeleting = deletingId === doc.document_id
                      const displayTags = (Array.isArray(doc.tags) && doc.tags.length > 0) ? doc.tags : getDefaultTags(doc.document_type)
                      const isEditingThisTag = editingTagsDocId === doc.document_id
                      const isSavingThisTag = savingTagsDocId === doc.document_id

                      return (
                        <tr key={doc.document_id} data-testid={`doc-row-${doc.document_id}`} className="veyra-table__row">
                          {/* Filename & Icon */}
                          <td className="docs-table__cell-name veyra-table__cell-name">
                            <div className="veyra-table__doc-meta">
                              <span className="doc-icon veyra-table__doc-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                  <polyline points="14 2 14 8 20 8"/>
                                </svg>
                              </span>
                              <div className="veyra-table__name-col">
                                <span className="doc-filename veyra-table__filename" title={doc.filename}>
                                  {doc.filename || 'Untitled Document'}
                                </span>
                                <span className="veyra-table__doc-id" title={doc.document_id}>
                                  ID: {doc.document_id}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Document Type Badge */}
                          <td>
                            <span className="doc-type-badge veyra-type-chip">
                              {getDocumentTypeLabel(doc.document_type)}
                            </span>
                          </td>

                          {/* Upload Timestamp */}
                          <td className="docs-table__cell-time veyra-table__cell-date">
                            {formatTimestamp(doc.upload_timestamp)}
                          </td>

                          {/* Tags */}
                          <td>
                            <div className="veyra-tags-group">
                              {displayTags.map((tag, tIdx) => (
                                <span key={tIdx} className="veyra-tag">
                                  <span>{tag}</span>
                                  <button
                                    type="button"
                                    className="veyra-tag__remove"
                                    onClick={() => handleRemoveTag(doc, tag)}
                                    disabled={isSavingThisTag || isAnyActionBusy}
                                    aria-label={`Remove tag ${tag} from ${doc.filename || 'document'}`}
                                    title={`Remove tag "${tag}"`}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}

                              {displayTags.length < 5 && (
                                isEditingThisTag ? (
                                  <div className="veyra-tag-input-wrap">
                                    <input
                                      type="text"
                                      className="veyra-tag-input"
                                      placeholder="New tag…"
                                      value={newTagInput}
                                      maxLength={30}
                                      onChange={(e) => setNewTagInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          handleAddTag(doc, newTagInput)
                                        } else if (e.key === 'Escape') {
                                          setEditingTagsDocId(null)
                                          setNewTagInput('')
                                        }
                                      }}
                                      autoFocus
                                      aria-label={`New tag for ${doc.filename || 'document'}`}
                                    />
                                    <button
                                      type="button"
                                      className="veyra-tag-btn veyra-tag-btn--save"
                                      onClick={() => handleAddTag(doc, newTagInput)}
                                      disabled={!newTagInput.trim() || isSavingThisTag}
                                      aria-label="Save tag"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      type="button"
                                      className="veyra-tag-btn veyra-tag-btn--cancel"
                                      onClick={() => {
                                        setEditingTagsDocId(null)
                                        setNewTagInput('')
                                      }}
                                      aria-label="Cancel adding tag"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="veyra-tag-add-btn"
                                    onClick={() => {
                                      setEditingTagsDocId(doc.document_id)
                                      setNewTagInput('')
                                    }}
                                    disabled={isSavingThisTag || isAnyActionBusy}
                                    aria-label={`Add tag to ${doc.filename || 'document'}`}
                                    title="Add persistent tag"
                                  >
                                    {isSavingThisTag ? 'Saving…' : '+ Tag'}
                                  </button>
                                )
                              )}
                            </div>
                          </td>

                          {/* Status Badge */}
                          <td>
                            <span className="doc-status-badge veyra-status-badge veyra-status-badge--available">
                              <span className="veyra-status-dot" aria-hidden="true" />
                              {doc.status || 'AVAILABLE'}
                            </span>
                          </td>

                          {/* Actions: Download, Version History, Soft-Delete */}
                          <td className="docs-table__col-actions veyra-table__cell-actions">
                            <div className="doc-action-group veyra-actions-group">
                              {/* Download Button */}
                              <button
                                type="button"
                                className="doc-btn doc-btn--download veyra-action-btn veyra-action-btn--download"
                                onClick={() => handleDownload(doc)}
                                disabled={isAnyActionBusy}
                                aria-label={`Download ${doc.filename || 'document'}`}
                                data-testid={`download-btn-${doc.document_id}`}
                                title="Download securely via presigned URL"
                              >
                                {isDownloading ? (
                                  <>
                                    <span className="btn-spinner" aria-hidden="true" />
                                    <span>Loading…</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <span>Download</span>
                                  </>
                                )}
                              </button>

                              {/* Version History Drawer Trigger */}
                              <button
                                type="button"
                                className="veyra-action-btn veyra-action-btn--history"
                                onClick={() => setVersionDrawerDoc(doc)}
                                disabled={isAnyActionBusy}
                                aria-label={`View version history for ${doc.filename || 'document'}`}
                                title="View S3 object versions & storage metadata"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                                <span>History</span>
                              </button>

                              {/* Soft-Delete Button */}
                              <button
                                type="button"
                                className="doc-btn doc-btn--delete veyra-action-btn veyra-action-btn--delete"
                                onClick={() => handleDelete(doc)}
                                disabled={isAnyActionBusy}
                                aria-label={`Delete ${doc.filename || 'document'}`}
                                data-testid={`delete-btn-${doc.document_id}`}
                                title="Soft-delete document from active list"
                              >
                                {isDeleting ? (
                                  <>
                                    <span className="btn-spinner" aria-hidden="true" />
                                    <span>Deleting…</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <span>Delete</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Version History Drawer ── */}
          <VersionHistoryDrawer
            isOpen={Boolean(versionDrawerDoc)}
            document={versionDrawerDoc}
            onClose={() => setVersionDrawerDoc(null)}
            onDownload={() => {
              if (versionDrawerDoc) handleDownload(versionDrawerDoc)
            }}
            isDownloading={Boolean(downloadingId)}
          />

          {/* ── Audit & Compliance Note ── */}
          <p className="dashboard__audit-notice veyra-footer-audit" role="note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <span>All document operations are logged to the immutable AWS AuditLog table for enterprise compliance.</span>
          </p>
        </main>
      </div>
    </div>
  )
}
