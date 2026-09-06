/**
 * ProtectedRoute.jsx
 *
 * Route guard that enforces authentication before rendering a page.
 *
 * Behaviour:
 *   - loading        → show full-page spinner (avoids flash of redirect)
 *   - unauthenticated → <Navigate to="/login" replace />
 *   - authenticated   → render children
 */
import { Navigate } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'

/**
 * @param {{ children: React.ReactNode }} props
 */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuthContext()

  if (loading) {
    return (
      <div className="page-loader" data-testid="page-loader">
        <div className="page-loader__spinner" aria-label="Loading…" role="status" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}
