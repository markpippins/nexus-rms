import { ReqType } from '../models/data.models';

/** Returns Tailwind CSS classes for a requirement type badge. */
export function getTypeBadgeClass(reqType: ReqType | null | undefined): string {
  switch (reqType) {
    case 'Epic': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-300 dark:border-purple-700';
    case 'Story': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300 dark:border-green-700';
    case 'Task': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700';
    case 'Bug': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300 dark:border-red-700';
    default: return '';
  }
}

/** Returns the display label for a requirement type, or empty string if null/undefined. */
export function getTypeLabel(reqType: ReqType | null | undefined): string {
  return reqType || '';
}
