import type { ResolvedSource, SubResult } from '../types';

interface DzEntryIdentity {
  readonly __component?: string;
  readonly id?: unknown;
}

const entryKey = (entry: unknown): string => {
  const identity = entry as DzEntryIdentity;
  return `${identity.__component}:${identity.id}`;
};

/**
 * Slots fully populated dynamic-zone entries back into the core document
 * (matching by component uid + entry id, preserving the core order) and
 * attaches relation sub-results to their fields.
 */
export const mergeSubResults = (
  core: Readonly<Record<string, unknown>>,
  view: ResolvedSource,
  subResults: readonly SubResult[],
): Readonly<Record<string, unknown>> => {
  const merged: Record<string, unknown> = { ...core };

  for (const zone of view.planner.dynamicZones ?? []) {
    const coreEntries = core[zone];
    if (!Array.isArray(coreEntries)) continue;

    const populatedByKey = new Map<string, unknown>();
    for (const sub of subResults) {
      if (sub.subQuery.kind !== 'dz-component' || sub.subQuery.zone !== zone) continue;
      const entries = sub.document?.[zone];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        populatedByKey.set(entryKey(entry), entry);
      }
    }

    merged[zone] = coreEntries.map((entry) => populatedByKey.get(entryKey(entry)) ?? entry);
  }

  for (const sub of subResults) {
    if (sub.subQuery.kind === 'dz-component') continue;
    for (const field of sub.subQuery.relationFields ?? []) {
      if (sub.document && field in sub.document) {
        merged[field] = sub.document[field];
      }
    }
  }

  return merged;
};
