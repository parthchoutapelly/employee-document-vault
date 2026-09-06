/**
 * LoginPage.jsx
 *
 * Public page rendered at /login for VEYRA — Employee Document Workspace.
 * - Already-authenticated users are redirected to /dashboard.
 * - Uses useAuthContext().signIn() — no tokens or passwords are logged.
 * - Password field always uses type="password" (browser handles masking).
 */
import { useState } from 'react'
import { Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'
import { getErrorMessage } from '../services/errorMessages'
import './LoginPage.css'

export default function LoginPage() {
  const { isAuthenticated, loading, signIn, error: authError } = useAuthContext()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState(null)

  /* ── If a session already exists, skip the login screen ── */
  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  /* ── Initial session check ── */
  if (loading) {
    return (
      <div className="login-page" data-testid="login-page">
        <div className="page-loader">
          <div className="page-loader__spinner" role="status" aria-label="Checking session…" />
        </div>
      </div>
    )
  }

  const sessionError = location.state?.error ?? null
  const displayError = localError ?? sessionError ?? authError ?? null
  const canSubmit    = email.trim().length > 0 && password.length > 0 && !submitting

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setLocalError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setLocalError(getErrorMessage(err, 'Sign in failed. Please check your credentials.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page" data-testid="login-page">
      <main className="login-card" aria-label="Sign in to VEYRA Employee Document Workspace">

        {/* ── Brand Header ── */}
        <div className="login-card__header">
          <div className="login-card__brand">
            <div className="login-card__logo" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4h7v7H4z" fill="#2563eb" />
                <path d="M13 4h7v7h-7z" fill="#3b82f6" fillOpacity="0.8" />
                <path d="M4 13h7v7H4z" fill="#1d4ed8" fillOpacity="0.9" />
                <path d="M13 13h7v7h-7z" fill="#60a5fa" fillOpacity="0.6" />
              </svg>
            </div>
            <span className="login-card__brand-name">VEYRA</span>
          </div>
          <h1 className="login-card__title">VEYRA Employee Document Vault</h1>
          <p className="login-card__subtitle">Employee Document Workspace · Sign in with corporate credentials</p>
        </div>

        {/* ── Error banner ── */}
        {displayError && (
          <div className="login-error" role="alert" aria-live="polite" data-testid="login-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>{displayError}</span>
          </div>
        )}

        {/* ── Form ── */}
        <form
          className="login-form"
          onSubmit={handleSubmit}
          noValidate
          aria-label="Sign in form"
        >
          <div className="login-form__group">
            <label className="login-form__label" htmlFor="email">
              Work Email
            </label>
            <input
              id="email"
              className="login-form__input"
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
              aria-required="true"
            />
          </div>

          <div className="login-form__group">
            <div className="login-form__label-row">
              <label className="login-form__label" htmlFor="password">
                Password
              </label>
            </div>
            <input
              id="password"
              className="login-form__input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              aria-required="true"
            />
          </div>

          <button
            id="sign-in-btn"
            className={`login-form__submit${submitting ? ' login-form__submit--loading' : ''}`}
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <span className="login-btn-spinner" aria-hidden="true" />
                Authenticating…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* ── Security Trust Indicators ── */}
        <div className="login-card__trust">
          <span className="trust-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            KMS Encrypted
          </span>
          <span className="trust-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            RBAC Active
          </span>
          <span className="trust-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
            Audit Logged
          </span>
        </div>

        <p className="login-card__footer">
          VEYRA Employee Document Workspace · Authorized corporate access only
        </p>
      </main>
    </div>
  )
}
