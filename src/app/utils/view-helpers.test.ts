import { describe, expect, test } from 'bun:test';
import {
  formatDate,
  getStatusColor,
  getStatusIcon,
  lookupHierarchyName,
} from './view-helpers';

// ════════════════════════════════════════════════════════════════
//  formatDate
// ════════════════════════════════════════════════════════════════

describe('formatDate', () => {
  test('returns empty string for falsy input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null as any)).toBe('');
    expect(formatDate(undefined as any)).toBe('');
  });

  test('handles invalid date string without crashing', () => {
    const result = formatDate('not-a-date');
    expect(result).toBeTruthy(); // returns "Invalid Date" or similar
    expect(typeof result).toBe('string');
  });

  test('formats a valid ISO date as "Mon D, YYYY"', () => {
    // Use a fixed date to avoid locale/timezone flakiness.
    // 2026-01-15T12:00:00Z → "Jan 15, 2026"
    const result = formatDate('2026-01-15T12:00:00Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(result).toContain('2026');
  });

  test('returns en-US locale formatted date', () => {
    const result = formatDate('2026-07-04T00:00:00Z');
    // Should contain "Jul" (en-US short month)
    expect(result).toMatch(/Jul/);
  });

  test('handles date-only ISO strings (no time)', () => {
    const result = formatDate('2026-12-25');
    expect(result).toContain('2026');
    expect(result).toMatch(/Dec/);
  });
});

// ════════════════════════════════════════════════════════════════
//  getStatusColor
// ════════════════════════════════════════════════════════════════

describe('getStatusColor', () => {
  const colorMap: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    approved: 'bg-green-100 text-green-700',
  };

  test('returns matching color for known status', () => {
    expect(getStatusColor('draft', colorMap)).toBe(colorMap.draft);
    expect(getStatusColor('approved', colorMap)).toBe(colorMap.approved);
  });

  test('handles null and undefined status gracefully', () => {
    expect(() => getStatusColor(null as any, colorMap)).not.toThrow();
    expect(() => getStatusColor(undefined as any, colorMap)).not.toThrow();
  });

  test('returns fallback for unknown status', () => {
    const fallback = getStatusColor('nonexistent', colorMap);
    expect(fallback).toContain('bg-gray-');
    expect(fallback).toContain('text-gray-');
    expect(fallback).toContain('dark:bg-gray-700');
    expect(fallback).toContain('dark:text-gray-400');
  });

  test('fallback is deterministic (same input → same output)', () => {
    expect(getStatusColor('unknown', colorMap))
      .toBe(getStatusColor('unknown', colorMap));
  });

  test('handles empty string status', () => {
    const result = getStatusColor('', colorMap);
    expect(result).toContain('bg-gray-');
  });

  test('handles empty colorMap gracefully', () => {
    const result = getStatusColor('anything', {});
    expect(result).toContain('bg-gray-');
  });
});

// ════════════════════════════════════════════════════════════════
//  getStatusIcon
// ════════════════════════════════════════════════════════════════

describe('getStatusIcon', () => {
  const iconMap: Record<string, string> = {
    pending: '⏳',
    completed: '✅',
    failed: '❌',
  };

  test('returns matching icon for known status', () => {
    expect(getStatusIcon('pending', iconMap)).toBe('⏳');
    expect(getStatusIcon('completed', iconMap)).toBe('✅');
  });

  test('returns default icon (non-empty) for unknown status', () => {
    const result = getStatusIcon('unknown', iconMap);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('handles null and undefined status gracefully', () => {
    expect(() => getStatusIcon(null as any, iconMap)).not.toThrow();
    expect(() => getStatusIcon(undefined as any, iconMap)).not.toThrow();
  });

  test('handles empty iconMap', () => {
    const result = getStatusIcon('anything', {});
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0); // emoji may be surrogate pair
  });

  test('handles empty string status', () => {
    const result = getStatusIcon('', iconMap);
    expect(result).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════
//  lookupHierarchyName
// ════════════════════════════════════════════════════════════════

describe('lookupHierarchyName', () => {
  // Create a minimal mock DataService that returns known systems
  function createMockService() {
    return {
      systems: () => [
        {
          id: 'sys-1',
          name: 'E-Commerce',
          description: '',
          subsystems: [
            {
              id: 'sub-1',
              name: 'Checkout',
              description: '',
              systemId: 'sys-1',
              features: [
                { id: 'feat-1', name: 'Payment Gateway', description: '', subsystemId: 'sub-1' },
                { id: 'feat-2', name: 'Cart', description: '', subsystemId: 'sub-1' },
              ],
            },
            {
              id: 'sub-2',
              name: 'Inventory',
              description: '',
              systemId: 'sys-1',
              features: [
                { id: 'feat-3', name: 'Stock Sync', description: '', subsystemId: 'sub-2' },
              ],
            },
          ],
          folders: [],
        },
        {
          id: 'sys-2',
          name: 'Analytics',
          description: '',
          subsystems: [],
          folders: [],
        },
      ],
    } as any;
  }

  test('resolves system name by ID', () => {
    const svc = createMockService();
    expect(lookupHierarchyName(svc, 'sys-1', 'system')).toBe('E-Commerce');
    expect(lookupHierarchyName(svc, 'sys-2', 'system')).toBe('Analytics');
  });

  test('resolves subsystem name by ID', () => {
    const svc = createMockService();
    expect(lookupHierarchyName(svc, 'sub-1', 'subsystem')).toBe('Checkout');
    expect(lookupHierarchyName(svc, 'sub-2', 'subsystem')).toBe('Inventory');
  });

  test('resolves feature name by ID', () => {
    const svc = createMockService();
    expect(lookupHierarchyName(svc, 'feat-1', 'feature')).toBe('Payment Gateway');
    expect(lookupHierarchyName(svc, 'feat-3', 'feature')).toBe('Stock Sync');
  });

  test('falls back to truncated ID when entity not found', () => {
    const svc = createMockService();
    const result = lookupHierarchyName(svc, '01234567-89ab-cdef-0123-456789abcdef', 'system');
    expect(result).toBe('01234567');
  });

  test('falls back to truncated ID for unknown type', () => {
    const svc = createMockService();
    // Looking for subsystem that doesn't exist
    const result = lookupHierarchyName(svc, 'deadbeef-0000-0000-0000-000000000000', 'subsystem');
    expect(result).toBe('deadbeef');
  });

  test('handles empty systems list', () => {
    const svc = { systems: () => [] } as any;
    const result = lookupHierarchyName(svc, '00000000-0000-0000-0000-000000000001', 'system');
    expect(result).toBe('00000000');
  });

  test('handles entity with no name gracefully', () => {
    const svc = {
      systems: () => [{
        id: 'sys-x',
        name: undefined,
        description: '',
        subsystems: [{
          id: 'sub-x',
          name: undefined,
          description: '',
          systemId: 'sys-x',
          features: [{ id: 'feat-x', name: undefined, description: '', subsystemId: 'sub-x' }],
        }],
        folders: [],
      }],
    } as any;
    // System with no name → fallback to truncated ID
    expect(lookupHierarchyName(svc, 'sys-x', 'system')).toBe('sys-x');
    // Subsystem with no name → fallback
    expect(lookupHierarchyName(svc, 'sub-x', 'subsystem')).toBe('sub-x');
    // Feature with no name → fallback
    expect(lookupHierarchyName(svc, 'feat-x', 'feature')).toBe('feat-x');
  });

  test('handles short ID (< 8 chars) without error', () => {
    const svc = { systems: () => [] } as any;
    // slice(0,8) on a 3-char string just returns the 3 chars
    expect(lookupHierarchyName(svc, 'abc', 'system')).toBe('abc');
  });
});
