export const PLUGIN_ID = 'bff-views';
export const PLUGIN_NAME = 'BFF Views';

// Controller method names that view ids must not collide with - every view id
// becomes a method on the `view` controller (handler `view.<viewId>`).
export const RESERVED_VIEW_IDS: readonly string[] = ['status', 'manifest'];

export const MANIFEST_VERSION = 1 as const;

export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_CACHE_MAX_ENTRIES = 500;
export const DEFAULT_MAX_IN_FLIGHT_QUERIES = 32;
