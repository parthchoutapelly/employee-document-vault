/**
 * ClassificationBadge.jsx
 *
 * Enterprise document security classification badge.
 * Displays visually distinct badges with explicit iconography and labels for:
 *   - Restricted (Shield icon, rose/red badge)
 *   - Confidential (Lock icon, amber/orange badge)
 *   - Internal (Building icon, sky/blue badge)
 *   - Public (Globe icon, emerald/green badge)
 *
 * Adheres to accessibility requirements: does not rely solely on color.
 */
import React from 'react'

export default function ClassificationBadge({ classification = 'Internal', className = '' }) {
  const norm = String(classification || 'Internal').trim().toLowerCase()

  let typeClass = 'veyra-class-badge--internal'
  let label = 'Internal'
  let icon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  )

  if (norm.includes('restrict')) {
    typeClass = 'veyra-class-badge--restricted'
    label = 'Restricted'
    icon = (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  } else if (norm.includes('confident')) {
    typeClass = 'veyra-class-badge--confidential'
    label = 'Confidential'
    icon = (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    )
  } else if (norm.includes('public')) {
    typeClass = 'veyra-class-badge--public'
    label = 'Public'
    icon = (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    )
  }

  return (
    <span
      className={`veyra-class-badge ${typeClass} ${className}`.trim()}
      title={`Security Classification: ${label}`}
      aria-label={`Security Classification: ${label}`}
    >
      <span className="veyra-class-badge__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="veyra-class-badge__label">{label.toUpperCase()}</span>
    </span>
  )
}
