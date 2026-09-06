/**
 * AuthContext.jsx
 *
 * Calls useAuth() exactly once at the top of the component tree and
 * distributes the auth state to every descendant via React context.
 *
 * Consuming components use useAuthContext() instead of calling useAuth()
 * directly — this guarantees a single source of truth and makes unit
 * testing straightforward (wrap with <AuthContext.Provider value={mock}>).
 */
import { createContext, useContext } from 'react'
import { useAuth } from '../hooks/useAuth'

/** @type {React.Context<ReturnType<typeof useAuth> | null>} */
export const AuthContext = createContext(null)

/**
 * Wraps the application (or a subtree) and provides auth state.
 * Must be placed above any component that calls useAuthContext().
 *
 * @param {{ children: React.ReactNode }} props
 */
export function AuthProvider({ children }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

/**
 * Consume the auth context.
 * Throws a descriptive error when called outside an <AuthProvider>.
 *
 * @returns {ReturnType<typeof useAuth>}
 */
export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error(
      'useAuthContext() must be used inside <AuthProvider>. ' +
        'Wrap your component tree with <AuthProvider> in main.jsx or App.jsx.'
    )
  }
  return ctx
}
