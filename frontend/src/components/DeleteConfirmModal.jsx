/**
 * DeleteConfirmModal.jsx
 *
 * Accessible confirmation dialog for document soft-deletion.
 */
import './DeleteConfirmModal.css'

export default function DeleteConfirmModal({
  isOpen,
  documentTitle,
  onConfirm,
  onCancel,
  isDeleting,
}) {
  if (!isOpen) return null

  return (
    <div className="veyra-modal__backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
      <div className="veyra-modal__card">
        <div className="veyra-modal__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </div>

        <div className="veyra-modal__content">
          <h3 id="delete-dialog-title" className="veyra-modal__title">
            Delete document?
          </h3>
          <p className="veyra-modal__desc">
            <strong>{documentTitle || 'This document'}</strong> will be removed from your active document list.
            Underlying version history in the S3 vault will remain protected by policy.
          </p>
        </div>

        <div className="veyra-modal__actions">
          <button
            type="button"
            className="veyra-btn veyra-btn--secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="veyra-btn veyra-btn--danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete document'}
          </button>
        </div>
      </div>
    </div>
  )
}
