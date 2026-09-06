/**
 * authUtils.test.js
 *
 * Unit tests for the pure authentication helper functions in authUtils.js.
 * No React, no Amplify — runs without any live Cognito connection.
 */
import { describe, it, expect } from 'vitest';
import {
  ROLES,
  extractRole,
  extractEmployeeId,
  isHRAdmin,
  isManagerOrAbove,
  roleLabel,
} from '../authUtils';

// ─── ROLES constant ──────────────────────────────────────────────────────────

describe('ROLES', () => {
  it('exposes the three canonical role strings', () => {
    expect(ROLES.HR_ADMIN).toBe('HR_Admin');
    expect(ROLES.MANAGER).toBe('Manager');
    expect(ROLES.EMPLOYEE).toBe('Employee');
  });
});

// ─── extractRole ─────────────────────────────────────────────────────────────

describe('extractRole', () => {
  it('returns HR_Admin when HR_Admin is in the groups list', () => {
    expect(extractRole(['HR_Admin'])).toBe(ROLES.HR_ADMIN);
  });

  it('returns HR_Admin even when other roles are also present (priority)', () => {
    expect(extractRole(['Employee', 'Manager', 'HR_Admin'])).toBe(ROLES.HR_ADMIN);
  });

  it('returns Manager when Manager is present and HR_Admin is not', () => {
    expect(extractRole(['Employee', 'Manager'])).toBe(ROLES.MANAGER);
  });

  it('returns Employee when only Employee group is present', () => {
    expect(extractRole(['Employee'])).toBe(ROLES.EMPLOYEE);
  });

  it('returns null when groups list is empty', () => {
    expect(extractRole([])).toBeNull();
  });

  it('returns null for unrecognised group names', () => {
    expect(extractRole(['SomeOtherGroup'])).toBeNull();
  });

  it('defaults to empty array when called with no argument', () => {
    expect(extractRole()).toBeNull();
  });
});

// ─── extractEmployeeId ───────────────────────────────────────────────────────

describe('extractEmployeeId', () => {
  it('returns the employee ID from the custom claim', () => {
    const payload = { 'custom:employee_id': 'EMP-001', sub: 'abc' };
    expect(extractEmployeeId(payload)).toBe('EMP-001');
  });

  it('returns null when the custom claim is absent', () => {
    expect(extractEmployeeId({ sub: 'abc' })).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(extractEmployeeId({})).toBeNull();
  });

  it('defaults to empty object when called with no argument', () => {
    expect(extractEmployeeId()).toBeNull();
  });

  it('handles EMP-MGR1 style IDs', () => {
    expect(extractEmployeeId({ 'custom:employee_id': 'EMP-MGR1' })).toBe('EMP-MGR1');
  });
});

// ─── isHRAdmin ───────────────────────────────────────────────────────────────

describe('isHRAdmin', () => {
  it('returns true for HR_Admin role', () => {
    expect(isHRAdmin(ROLES.HR_ADMIN)).toBe(true);
  });

  it('returns false for Manager role', () => {
    expect(isHRAdmin(ROLES.MANAGER)).toBe(false);
  });

  it('returns false for Employee role', () => {
    expect(isHRAdmin(ROLES.EMPLOYEE)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isHRAdmin(null)).toBe(false);
  });
});

// ─── isManagerOrAbove ────────────────────────────────────────────────────────

describe('isManagerOrAbove', () => {
  it('returns true for Manager', () => {
    expect(isManagerOrAbove(ROLES.MANAGER)).toBe(true);
  });

  it('returns true for HR_Admin (higher than Manager)', () => {
    expect(isManagerOrAbove(ROLES.HR_ADMIN)).toBe(true);
  });

  it('returns false for Employee', () => {
    expect(isManagerOrAbove(ROLES.EMPLOYEE)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isManagerOrAbove(null)).toBe(false);
  });
});

// ─── roleLabel ───────────────────────────────────────────────────────────────

describe('roleLabel', () => {
  it('returns "HR Admin" for HR_Admin', () => {
    expect(roleLabel(ROLES.HR_ADMIN)).toBe('HR Admin');
  });

  it('returns "Manager" for Manager', () => {
    expect(roleLabel(ROLES.MANAGER)).toBe('Manager');
  });

  it('returns "Employee" for Employee', () => {
    expect(roleLabel(ROLES.EMPLOYEE)).toBe('Employee');
  });

  it('returns "Unknown" for null', () => {
    expect(roleLabel(null)).toBe('Unknown');
  });

  it('returns "Unknown" for an unrecognised string', () => {
    expect(roleLabel('SuperAdmin')).toBe('Unknown');
  });
});
