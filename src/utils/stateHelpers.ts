/**
 * State Helper Utilities
 * 
 * Defensive utilities for safely accessing state properties across the application.
 * These helpers prevent "Cannot read properties of undefined" errors.
 */

import type { PaginatedResponse } from '../state/appState';

/**
 * Safely extract items array from paginated response or array
 * Handles both legacy array format and new PaginatedResponse format
 * 
 * @example
 * const systems = safeGetItems(state.registeredSystems);
 * // Returns [] if undefined, the array if already an array, or .items if paginated
 */
export function safeGetItems<T>(
  data: PaginatedResponse<T> | T[] | undefined | null
): T[] {
  // Handle null/undefined
  if (!data) {
    return [];
  }

  // Already an array - return it
  if (Array.isArray(data)) {
    return data;
  }

  // Paginated response - extract items
  if (typeof data === 'object' && 'items' in data) {
    if (Array.isArray(data.items)) {
      return data.items;
    }
    // Malformed paginated response - items exists but isn't an array
    console.warn('Malformed PaginatedResponse: items property is not an array', data);
    return [];
  }

  // Unexpected format - return empty array
  console.warn('Unexpected data format in safeGetItems:', typeof data);
  return [];
}

/**
 * Safely get total count from paginated response or array
 * 
 * @example
 * const totalSystems = safeGetTotal(state.registeredSystems);
 */
export function safeGetTotal<T>(
  data: PaginatedResponse<T> | T[] | undefined | null
): number {
  // Handle null/undefined
  if (!data) {
    return 0;
  }

  // Array - return length
  if (Array.isArray(data)) {
    return data.length;
  }

  // Paginated response - extract total
  if (typeof data === 'object') {
    if ('totalItems' in data && typeof data.totalItems === 'number') {
      return data.totalItems;
    }
    if ('total' in data && typeof data.total === 'number') {
      return data.total;
    }
    // Fallback to items length if available
    if ('items' in data && Array.isArray(data.items)) {
      return data.items.length;
    }
  }

  return 0;
}

/**
 * Safely get page number from paginated response
 */
export function safeGetPage<T>(
  data: PaginatedResponse<T> | T[] | undefined | null,
  defaultPage: number = 1
): number {
  if (!data || Array.isArray(data)) {
    return defaultPage;
  }

  if (typeof data === 'object' && 'page' in data && typeof data.page === 'number') {
    return data.page;
  }

  return defaultPage;
}

/**
 * Safely get page size from paginated response
 */
export function safeGetPageSize<T>(
  data: PaginatedResponse<T> | T[] | undefined | null,
  defaultPageSize: number = 25
): number {
  if (!data || Array.isArray(data)) {
    return defaultPageSize;
  }

  if (typeof data === 'object' && 'pageSize' in data && typeof data.pageSize === 'number') {
    return data.pageSize;
  }

  return defaultPageSize;
}

/**
 * Type guard to check if data is PaginatedResponse
 */
export function isPaginatedResponse<T>(
  data: unknown
): data is PaginatedResponse<T> {
  return (
    data != null &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as Record<string, unknown>).items)
  );
}

/**
 * Safely access nested object properties with type safety
 * 
 * @example
 * const error = safeGet(status, ['summary', 'errors', 'analysisError'], null);
 */
export function safeGet<T>(
  obj: unknown,
  path: string[],
  defaultValue: T
): T {
  let current: unknown = obj;

  for (const key of path) {
    if (current == null || typeof current !== 'object') {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current !== undefined ? (current as T) : defaultValue;
}

/**
 * Safely access array with index checking
 * 
 * @example
 * const firstSystem = safeArrayAccess(systems, 0, null);
 */
export function safeArrayAccess<T>(
  arr: T[] | undefined | null,
  index: number,
  defaultValue: T | null = null
): T | null {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    return defaultValue;
  }

  return arr[index];
}

/**
 * Ensure a value is a valid number, return default if not
 * 
 * @example
 * const stepIndex = ensureNumber(status.stepIndex, 0);
 */
export function ensureNumber(
  value: unknown,
  defaultValue: number = 0
): number {
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    return value;
  }

  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!isNaN(parsed) && isFinite(parsed)) {
    return parsed;
  }

  return defaultValue;
}

/**
 * Ensure a value is a valid string, return default if not
 */
export function ensureString(
  value: unknown,
  defaultValue: string = ''
): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value != null) {
    return String(value);
  }

  return defaultValue;
}

/**
 * Ensure a value is a valid array, return default if not
 */
export function ensureArray<T>(
  value: unknown,
  defaultValue: T[] = []
): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return defaultValue;
}

/**
 * Safely calculate percentage with bounds checking
 * 
 * @example
 * const progress = safePercentage(completed, total); // 0-100
 */
export function safePercentage(
  numerator: number,
  denominator: number,
  decimals: number = 1
): number {
  const num = ensureNumber(numerator, 0);
  const denom = ensureNumber(denominator, 0);

  if (denom === 0) {
    return 0;
  }

  const percentage = (num / denom) * 100;
  const clamped = Math.max(0, Math.min(100, percentage));

  return parseFloat(clamped.toFixed(decimals));
}

/**
 * Merge objects with defensive copying
 * Ensures all properties from defaults exist in the result
 * 
 * Note: Arrays are validated for type but not contents.
 * If override contains an array with null/undefined items, they will be preserved.
 * Use this function when you need to ensure all default properties exist,
 * but be aware that array item validation is not performed.
 */
export function mergeWithDefaults<T extends Record<string, unknown>>(
  defaults: T,
  override: Partial<T> | undefined | null
): T {
  if (!override || typeof override !== 'object') {
    return { ...defaults };
  }

  const result: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const value = override[key];
    const defaultValue = defaults[key];

    // Type-safe merging based on default type
    // IMPORTANT: Always copy default arrays/objects to avoid mutation of defaults
    if (Array.isArray(defaultValue)) {
      result[String(key)] = Array.isArray(value) ? value : [...defaultValue];
    } else if (typeof defaultValue === 'number') {
      result[String(key)] = typeof value === 'number' ? value : defaultValue;
    } else if (typeof defaultValue === 'string') {
      result[String(key)] = typeof value === 'string' ? value : defaultValue;
    } else if (typeof defaultValue === 'boolean') {
      result[String(key)] = typeof value === 'boolean' ? value : defaultValue;
    } else if (typeof defaultValue === 'object' && defaultValue !== null) {
      result[String(key)] = typeof value === 'object' && value !== null ? value : { ...(defaultValue as Record<string, unknown>) };
    } else {
      result[String(key)] = value !== undefined ? value : defaultValue;
    }
  }

  return result as T;
}

/**
 * Format a display value with fallback for null/undefined/empty
 * 
 * @example
 * const display = formatDisplayValue(value, 'N/A');
 */
export function formatDisplayValue(
  value: unknown,
  fallback: string = 'N/A'
): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'number') {
    return isNaN(value) ? fallback : String(value);
  }

  return String(value);
}
