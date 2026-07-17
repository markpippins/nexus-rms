import { computed, Signal } from '@angular/core';
import { DataService } from '../../services/data.service';

/** Status color map shared by harvest-view, analysis-view, and candidates-view. */
export const CANDIDATE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  linked: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  staged: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  promoted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

/**
 * Format an ISO date string as "Mon D, YYYY" (e.g., "Jan 1, 2026").
 * Returns empty string for falsy input.
 */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format an ISO date string as "Mon D, YYYY, HH:MM" (e.g., "Jan 1, 2026, 14:30").
 * Returns em-dash for falsy input.
 */
export function formatFullDate(iso: string): string {
  if (!iso) return '\u2014'; // em-dash
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Return a Tailwind CSS class string for a status badge.
 * Uses the provided colorMap (status → classes), falling back to a neutral gray.
 */
export function getStatusColor(status: string, colorMap: Record<string, string>): string {
  return colorMap[status]
    || 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
}

/**
 * Return an emoji icon for a status using the provided iconMap.
 * Defaults to 📋 when the status is not found in the map.
 */
export function getStatusIcon(status: string, iconMap: Record<string, string>): string {
  return iconMap[status] || '\uD83D\uDCCB'; // 📋
}

/**
 * Create a computed signal that resolves the selected hierarchy into a label.
 *
 * By default returns just the name of the deepest selected entity
 * (feature name, subsystem name, or system name).
 *
 * Pass `{ fullPath: true }` for "System / Subsystem / Feature" format.
 */
export function createHierarchyLabel(
  dataService: DataService,
  options?: { fullPath?: boolean },
): Signal<string | null> {
  return computed(() => {
    const sysId = dataService.selectedSystemId();
    const subId = dataService.selectedSubsystemId();
    const featId = dataService.selectedFeatureId();
    const systems = dataService.systems();

    if (featId) {
      for (const sys of systems) {
        for (const sub of sys.subsystems) {
          for (const feat of sub.features) {
            if (feat.id === featId) {
              return options?.fullPath
                ? `${sys.name} / ${sub.name} / ${feat.name}`
                : feat.name;
            }
          }
        }
      }
    }

    if (subId) {
      for (const sys of systems) {
        for (const sub of sys.subsystems) {
          if (sub.id === subId) {
            return options?.fullPath
              ? `${sys.name} / ${sub.name}`
              : sub.name;
          }
        }
      }
    }

    if (sysId) {
      const sys = systems.find(s => s.id === sysId);
      return sys?.name || sysId.slice(0, 8);
    }

    return null;
  });
}

/**
 * Look up a single entity name by ID and type.
 * Used in templates that need a label for a specific entity (not the current selection).
 */
export function lookupHierarchyName(
  dataService: DataService,
  id: string,
  type: 'system' | 'subsystem' | 'feature',
): string {
  const systems = dataService.systems();
  if (type === 'system') {
    const sys = systems.find(s => s.id === id);
    return sys?.name || id.slice(0, 8);
  }
  for (const sys of systems) {
    if (type === 'subsystem') {
      const sub = sys.subsystems.find(s => s.id === id);
      if (sub) return sub.name || id.slice(0, 8);
    } else {
      for (const sub of sys.subsystems) {
        const feat = sub.features.find(f => f.id === id);
        if (feat) return feat.name || id.slice(0, 8);
      }
    }
  }
  return id.slice(0, 8);
}

/**
 * Return a Tailwind text color for a cohesion score (0–1 or null).
 * Thresholds: ≥0.8 = green, ≥0.6 = amber, ≥0.4 = orange, <0.4 = red, null = gray.
 */
export function getCohesionColor(score: number | null): string {
  if (score == null) return 'text-gray-400 dark:text-gray-500';
  if (score >= 0.8) return 'text-green-600 dark:text-green-400';
  if (score >= 0.6) return 'text-amber-600 dark:text-amber-400';
  if (score >= 0.4) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Return a Tailwind background class for a cohesion score (0–1 or null).
 * Same thresholds as getCohesionColor, but produces background/translucent classes.
 */
export function getCohesionBg(score: number | null): string {
  if (score == null) return 'bg-gray-100 dark:bg-gray-700';
  if (score >= 0.8) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 0.6) return 'bg-amber-100 dark:bg-amber-900/30';
  if (score >= 0.4) return 'bg-orange-100 dark:bg-orange-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

/** Tailwind classes for transcript block type badges. */
export function getBlockTypeBadgeClasses(type: string): string {
  switch (type) {
    case 'code': return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
    case 'diagram': return 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400';
    case 'quote': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400';
    case 'list': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400';
    default: return 'bg-transparent text-gray-400 dark:text-gray-500';
  }
}
