/**
 * authUtils.js
 *
 * Pure helper functions for Cognito JWT claim parsing.
 * No React, no Amplify — fully testable without mocks.
 *
 * All functions operate on plain objects derived from the Amplify v6
 * `fetchAuthSession()` response:
 *   session.tokens.idToken.payload  →  the decoded ID token claims dict
 */

/** Canonical role identifiers matching Cognito group names. */
export const ROLES = /** @type {const} */ ({
  HR_ADMIN: 'HR_Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
});

/**
 * Derive the single effective role from a list of Cognito group names.
 *
 * Priority (highest wins):
 *   HR_Admin  >  Manager  >  Employee
 *
 * @param {string[]} groups - value of the `cognito:groups` JWT claim
 * @returns {string|null}   - one of ROLES.* or null if no known group
 */
export function extractRole(groups = []) {
  if (groups.includes(ROLES.HR_ADMIN)) return ROLES.HR_ADMIN;
  if (groups.includes(ROLES.MANAGER)) return ROLES.MANAGER;
  if (groups.includes(ROLES.EMPLOYEE)) return ROLES.EMPLOYEE;
  return null;
}

/**
 * Extract the custom employee ID from the ID token payload.
 *
 * @param {Record<string, unknown>} payload - decoded ID token claims
 * @returns {string|null}
 */
export function extractEmployeeId(payload = {}) {
  return payload['custom:employee_id'] ?? null;
}

/**
 * Return true when the provided role has HR Admin privileges.
 * @param {string|null} role
 */
export function isHRAdmin(role) {
  return role === ROLES.HR_ADMIN;
}

/**
 * Return true when the provided role has Manager or higher privileges.
 * @param {string|null} role
 */
export function isManagerOrAbove(role) {
  return role === ROLES.MANAGER || role === ROLES.HR_ADMIN;
}

/**
 * Return a human-friendly display label for a role value.
 * @param {string|null} role
 * @returns {string}
 */
export function roleLabel(role) {
  switch (role) {
    case ROLES.HR_ADMIN:
      return 'HR Admin';
    case ROLES.MANAGER:
      return 'Manager';
    case ROLES.EMPLOYEE:
      return 'Employee';
    default:
      return 'Unknown';
  }
}
