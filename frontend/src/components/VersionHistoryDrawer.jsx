/**
 * VersionHistoryDrawer.jsx
 *
 * Slide-over drawer presenting real S3 object version history & storage metadata.
 * Fetches actual S3 versions via GET /files/{doc_id}/versions.
 */
import { useState, useEffect, useCallback } from 'react'
import { getDocumentVersions } from '../services/api'
import { formatFileSize, getDocumentTypeLabel, getDocumentClassification } from '../services/fileUtils'
import { getErrorMessage } from '../services/errorMessages'
import ClassificationBadge from './ClassificationBadge'
import './VersionHistoryDrawer.css'

function formatTimestamp(ts) {
  if (!ts) return '—'
  const num = Number(ts)
  const d = !isNaN(num) && num > 0 ? new Date(num) : new Date(ts)
  if (isNaN(d.getTime())) return String(ts)
  return d.toUTCString()
}

export default function VersionHistoryDrawer({
  isOpen,
  document: docProp,
  doc: docAlias,
  onClose,
  onDownload,
  isDownloading,
}) {
  const doc = docProp || docAlias
  const docId = doc?.document_id
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [versionError, setVersionError] = useState(null)

  const fetchVersions = useCallback(async () => {
    if (!docId) return
    setLoadingVersions(true)
    setVersionError(null)
    try {
      const data = await getDocumentVersions(docId)
      setVersions(Array.isArray(data?.versions) ? data.versions : [])
    } catch (err) {
      setVersionError(getErrorMessage(err, 'Failed to retrieve version history from S3.'))
    } finally {
      setLoadingVersions(false)
    }
  }, [docId])

  useEffect(() => {
    if (isOpen && docId) {
      fetchVersions()
    } else {
      setVersions([])
      setVersionError(null)
    }
  }, [isOpen, docId, fetchVersions])

  if (!isOpen || !doc) return null

  return (
    <div className="veyra-drawer__backdrop" onClick={onClose}>
      <aside
        className="veyra-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Drawer Header */}
        <div className="veyra-drawer__header">
          <div className="veyra-drawer__header-left">
            <span className="veyra-drawer__badge">Document Details &amp; History</span>
            <h3 id="drawer-title" className="veyra-drawer__title">
              {doc.filename || 'Document Details'}
            </h3>
          </div>
          <button
            type="button"
            className="veyra-drawer__close"
            onClick={onClose}
            aria-label="Close version history"
          >
            ×
          </button>
        </div>

        {/* Drawer Content */}
        <div className="veyra-drawer__body">
          {/* Metadata Card */}
          <div className="veyra-drawer__card">
            <h4 className="veyra-drawer__section-title">Document Security &amp; Storage</h4>
            <dl className="veyra-drawer__dl">
              <div className="veyra-drawer__row">
                <dt>Classification</dt>
                <dd>
                  <ClassificationBadge classification={getDocumentClassification(doc)} />
                </dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>Document Type</dt>
                <dd className="veyra-drawer__type-pill">{getDocumentTypeLabel(doc.document_type)}</dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>Owner / Vault</dt>
                <dd className="veyra-drawer__mono">{doc.employee_id || '—'}</dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>Document ID</dt>
                <dd className="veyra-drawer__mono">{doc.document_id}</dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>S3 Storage Key</dt>
                <dd className="veyra-drawer__mono veyra-drawer__mono--wrap">{doc.s3_key || '—'}</dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>Encryption</dt>
                <dd className="veyra-drawer__sec-chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>SSE-KMS (AWS KMS 40ee685d)</span>
                </dd>
              </div>
              <div className="veyra-drawer__row">
                <dt>Access Policy</dt>
                <dd className="veyra-drawer__text-sm">RBAC Enforced (Cognito &amp; IAM)</dd>
              </div>
            </dl>
          </div>

          {/* Versions Timeline */}
          <div className="veyra-drawer__timeline">
            <div className="veyra-drawer__timeline-header">
              <h4 className="veyra-drawer__section-title">Object Versions</h4>
              {!loadingVersions && !versionError && (
                <span className="veyra-drawer__v-count">
                  {versions.length} {versions.length === 1 ? 'version' : 'versions'}
                </span>
              )}
            </div>

            {/* Loading state */}
            {loadingVersions ? (
              <div className="veyra-drawer__loading" data-testid="versions-loading">
                <div className="veyra-spinner" role="status" aria-label="Loading version history…" />
                <p>Querying S3 object versions…</p>
              </div>
            ) : versionError ? (
              <div className="veyra-drawer__error" data-testid="versions-error">
                <p className="veyra-drawer__error-title">Unable to load versions</p>
                <p className="veyra-drawer__error-msg">{versionError}</p>
                <button
                  type="button"
                  className="veyra-btn veyra-btn--sm veyra-btn--primary"
                  onClick={fetchVersions}
                >
                  Retry
                </button>
              </div>
            ) : versions.length === 0 ? (
              /* Fallback if S3 returned empty versions list */
              <div className="veyra-drawer__version-item veyra-drawer__version-item--current">
                <div className="veyra-drawer__version-marker" aria-hidden="true">
                  <span className="veyra-drawer__dot veyra-drawer__dot--active" />
                </div>
                <div className="veyra-drawer__version-details">
                  <div className="veyra-drawer__version-header">
                    <span className="veyra-drawer__v-tag">Current Version</span>
                    <span className="veyra-drawer__v-status">Active</span>
                  </div>
                  <p className="veyra-drawer__v-time">{formatTimestamp(doc.upload_timestamp)}</p>
                  <div className="veyra-drawer__v-meta">
                    <span>Author: {doc.uploaded_by || doc.employee_id || 'Employee'}</span>
                    <span>Status: {doc.status || 'AVAILABLE'}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Real S3 Object Versions */
              <div className="veyra-drawer__v-list" data-testid="versions-list">
                {versions.map((ver, idx) => {
                  const isLatest = ver.is_latest
                  const isDeleteMarker = ver.is_delete_marker

                  return (
                    <div
                      key={ver.version_id || idx}
                      className={`veyra-drawer__version-item ${
                        isLatest ? 'veyra-drawer__version-item--current' : ''
                      } ${isDeleteMarker ? 'veyra-drawer__version-item--deleted' : ''}`}
                    >
                      <div className="veyra-drawer__version-marker" aria-hidden="true">
                        <span
                          className={`veyra-drawer__dot ${
                            isDeleteMarker
                              ? 'veyra-drawer__dot--deleted'
                              : isLatest
                              ? 'veyra-drawer__dot--active'
                              : 'veyra-drawer__dot--previous'
                          }`}
                        />
                        {idx < versions.length - 1 && <span className="veyra-drawer__line" />}
                      </div>

                      <div className="veyra-drawer__version-details">
                        <div className="veyra-drawer__version-header">
                          <span
                            className={`veyra-drawer__v-tag ${
                              isDeleteMarker ? 'veyra-drawer__v-tag--deleted' : ''
                            }`}
                          >
                            {isDeleteMarker
                              ? isLatest
                                ? 'Current Delete Marker'
                                : 'Delete Marker'
                              : isLatest
                              ? 'Current Version'
                              : 'Previous Version'}
                          </span>
                          <span
                            className={`veyra-drawer__v-status ${
                              isDeleteMarker ? 'veyra-drawer__v-status--deleted' : ''
                            }`}
                          >
                            {isDeleteMarker ? 'Soft-Deleted' : isLatest ? 'Active' : 'Archived'}
                          </span>
                        </div>

                        <div className="veyra-drawer__v-id-row">
                          <span className="veyra-drawer__v-id-label">Version ID:</span>
                          <code className="veyra-drawer__v-id-code" title={ver.version_id}>
                            {ver.version_id}
                          </code>
                        </div>

                        <p className="veyra-drawer__v-time">{formatTimestamp(ver.last_modified)}</p>

                        <div className="veyra-drawer__v-meta">
                          <span>
                            Size: {isDeleteMarker ? '0 B (Delete Marker)' : formatFileSize(ver.size)}
                          </span>
                        </div>

                        {!isDeleteMarker && (
                          <div className="veyra-drawer__v-actions">
                            <button
                              type="button"
                              className="veyra-btn veyra-btn--sm veyra-btn--primary"
                              onClick={() => onDownload?.(doc.document_id, ver.version_id)}
                              disabled={isDownloading}
                              aria-label={`Download version ${ver.version_id} of ${doc.filename || 'document'}`}
                              data-testid={`download-version-btn-${ver.version_id}`}
                            >
                              {isDownloading ? 'Downloading…' : 'Download Version'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* S3 Bucket Versioning Info */}
            <div className="veyra-drawer__version-notice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div>
                <strong>S3 Object Versioning Enabled</strong>
                <p>
                  Each overwrite or soft-deletion generates an immutable version marker in S3.
                  Historical versions are retained in storage according to lifecycle retention rules.
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
