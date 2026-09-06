/**
 * useAuth.js
 *
 * React hook providing the authentication foundation for the Employee
 * Document Vault frontend.
 *
 * Uses Amplify v6 APIs exclusively:
 *   signIn / signOut / getCurrentUser / fetchAuthSession
 *
 * Returns:
 *  {
 *    user          – Amplify AuthUser object or null
 *    employeeId    – value of custom:employee_id claim, or null
 *    role          – one of ROLES.* or null
 *    loading       – true while the initial session check is in flight
 *    error         – last sign-in error message, or null
 *    isAuthenticated – convenience boolean
 *    signIn(email, password) – async; throws on error
 *    signOut()               – async; always clears local state
 *    getIdToken()            – async; returns current ID token string for API calls
 *  }
 *
 * Usage:
 *   const { user, role, employeeId, signIn, signOut, getIdToken } = useAuth();
 */
import { useState, useEffect, useCallback } from 'react';
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { extractRole, extractEmployeeId } from '../services/authUtils';

/**
 * Parse the Amplify session and return { role, employeeId } derived
 * from the ID token claims.  Returns null values when no session exists.
 *
 * @param {import('aws-amplify/auth').AuthSession} session
 * @returns {{ role: string|null, employeeId: string|null }}
 */
function parseSession(session) {
  const payload = session?.tokens?.idToken?.payload ?? {};
  const groups = Array.isArray(payload['cognito:groups'])
    ? payload['cognito:groups']
    : [];
  return {
    role: extractRole(groups),
    employeeId: extractEmployeeId(payload),
  };
}

/**
 * @returns {import('../types').AuthContextValue}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Load (or refresh) the current session from Amplify.
   * Called on mount and after sign-in.
   */
  const refreshSession = useCallback(async () => {
    try {
      const [authUser, session] = await Promise.all([
        getCurrentUser(),
        fetchAuthSession(),
      ]);
      const { role: parsedRole, employeeId: parsedEmpId } = parseSession(session);
      setUser(authUser);
      setRole(parsedRole);
      setEmployeeId(parsedEmpId);
    } catch {
      // No active session — clear state silently.
      setUser(null);
      setRole(null);
      setEmployeeId(null);
    }
  }, []);

  // Check for an existing session when the hook first mounts.
  useEffect(() => {
    setLoading(true);
    refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  /**
   * Sign in with email + password.
   * Amplify USER_PASSWORD_AUTH flow (matches the deployed Cognito client).
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<import('aws-amplify/auth').SignInOutput>}
   */
  const handleSignIn = useCallback(
    async (email, password) => {
      setError(null);
      try {
        const result = await amplifySignIn({ username: email, password });
        // Refresh claims so role/employeeId are immediately available.
        await refreshSession();
        return result;
      } catch (err) {
        const message = err?.message ?? 'Sign in failed. Please try again.';
        setError(message);
        throw err;
      }
    },
    [refreshSession]
  );

  /**
   * Sign out the current user.  Clears local state unconditionally.
   *
   * @returns {Promise<void>}
   */
  const handleSignOut = useCallback(async () => {
    setError(null);
    try {
      await amplifySignOut();
    } finally {
      setUser(null);
      setRole(null);
      setEmployeeId(null);
    }
  }, []);

  /**
   * Retrieve the current Cognito ID token string.
   * Pass this in the `Authorization` header for all API calls.
   *
   * @returns {Promise<string|null>}
   */
  const getIdToken = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      return session?.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  }, []);

  return {
    user,
    role,
    employeeId,
    loading,
    error,
    isAuthenticated: !!user,
    signIn: handleSignIn,
    signOut: handleSignOut,
    getIdToken,
  };
}
