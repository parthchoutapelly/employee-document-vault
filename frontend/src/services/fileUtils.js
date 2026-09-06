/**
 * fileUtils.js
 *
 * Pure utilities for document types, size formatting, folder navigation, and tagging.
 */

/**
 * Supported document types with human-readable labels and folder sections.
 */
export const DOCUMENT_TYPES = [
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'id_proof',     label: 'ID Proof' },
  { value: 'payslip',      label: 'Payslip' },
  { value: 'appraisal',    label: 'Appraisal' },
  { value: 'resume',       label: 'Resume' },
  { value: 'other',        label: 'Other' },
];

/**
 * Folder tree definitions for navigation sidebar
 */
export const DOCUMENT_FOLDERS = [
  { id: 'all',          label: 'All Documents', type: null },
  { id: 'offer_letter', label: 'Offer Letters', type: 'offer_letter' },
  { id: 'id_proof',     label: 'ID Proof',      type: 'id_proof' },
  { id: 'payslip',      label: 'Payslips',      type: 'payslip' },
  { id: 'appraisal',    label: 'Appraisals',    type: 'appraisal' },
  { id: 'resume',       label: 'Resumes',       type: 'resume' },
  { id: 'other',        label: 'Other',         type: 'other' },
];

/** Maximum permitted file size in bytes (10 MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Helper to format file sizes for human display */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes || isNaN(bytes)) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Get human-readable label for a document type key */
export function getDocumentTypeLabel(typeKey) {
  const match = DOCUMENT_TYPES.find((t) => t.value === typeKey);
  return match ? match.label : typeKey || 'Document';
}

/** Inferred category tags based on document type (for specification metadata display) */
export function getDefaultTags(documentType) {
  switch (documentType) {
    case 'offer_letter':
      return ['Confidential', 'Onboarding'];
    case 'id_proof':
      return ['KYC', 'Verified'];
    case 'payslip':
      return ['Payroll', 'Finance'];
    case 'appraisal':
      return ['Performance', 'Internal'];
    case 'resume':
      return ['Career', 'Profile'];
    default:
      return ['General'];
  }
}
