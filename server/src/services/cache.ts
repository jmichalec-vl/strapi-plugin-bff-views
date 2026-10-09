import type { Core } from '@strapi/types';

import type { BffViewsConfig, DocumentStatus } from '../types';
import { DEFAULT_CACHE_MAX_ENTRIES, PLUGIN_ID } from '../constants';
import { getService } from '../utils';

const UPLOAD_FILE_UID = 'plugin::upload.file';

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number | null;
}

interface LifecycleEvent {
  readonly model: { readonly uid: string };
}

/**
 * Coarse in-memory response cache (spec section 7): LRU-capped Map, per-view
 * TTL, and lifecycle-driven invalidation. Any write touching a view's
 * participating UIDs (its content type, reachable components, relation
 * targets) flushes all of that view's entries; media writes flush every cached
 * view. Deliberately coarse: correct under heavy editing, at the cost of hit
 * rate. Known blind spot: raw Knex writes bypass db lifecycles entirely.
 */
const cache = ({ strapi }: { strapi: Core.Strapi }) => {
  const entries = new Map<string, CacheEntry>();

  const maxEntries = (): number => {
    const config = strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined;
    return config?.cache?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  };

  // authKey is the stable caller identity: sanitized output differs per
  // token/user, so entries are never shared across identities. It is a
  // required argument on purpose, so no call site can forget it.
  const cacheKey = (
    viewId: string,
    key: string,
    status: DocumentStatus,
    locale: string | undefined,
    authKey: string,
  ): string => `${viewId}:${status}:${locale ?? ''}:${authKey}:${key}`;

  const get = (
    viewId: string,
    key: string,
    status: DocumentStatus,
    locale: string | undefined,
    authKey: string,
  ): unknown => {
    const id = cacheKey(viewId, key, status, locale, authKey);
    const entry = entries.get(id);
    if (!entry) return undefined;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      entries.delete(id);
      return undefined;
    }

    // Refresh recency: Map preserves insertion order, so re-inserting makes
    // this entry the newest and eviction below drops the true LRU entry.
    entries.delete(id);
    entries.set(id, entry);
    return entry.value;
  };

  const set = (
    viewId: string,
    key: string,
    status: DocumentStatus,
    locale: string | undefined,
    value: unknown,
    ttlMs: number | undefined,
    authKey: string,
  ): void => {
    const id = cacheKey(viewId, key, status, locale, authKey);
    // Overwriting must also refresh recency, so drop the stale position first.
    entries.delete(id);
    if (entries.size >= maxEntries()) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(id, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
    });
  };

  const flushViews = (viewIds: readonly string[]): void => {
    const prefixes = viewIds.map((id) => `${id}:`);
    for (const key of [...entries.keys()]) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) entries.delete(key);
    }
  };

  const subscribe = (): void => {
    const views = getService(strapi, 'view-registry').getViews();
    const cachedViews = views.filter((view) => view.cache?.enabled === true);
    if (cachedViews.length === 0) return;

    const viewIdsByUid = new Map<string, Set<string>>();
    for (const view of cachedViews) {
      for (const uid of view.participatingUids) {
        const ids = viewIdsByUid.get(uid) ?? new Set<string>();
        ids.add(view.id);
        viewIdsByUid.set(uid, ids);
      }
    }

    const allViewIds = cachedViews.map((view) => view.id);
    const onWrite = (event: LifecycleEvent): void => {
      const uid = event.model.uid;
      if (uid === UPLOAD_FILE_UID) {
        flushViews(allViewIds);
        return;
      }
      const affected = viewIdsByUid.get(uid);
      if (affected) flushViews([...affected]);
    };

    // Covers create/update/delete and publish/unpublish/discard: the document
    // service implements publication as delete+create at the DB layer.
    strapi.db.lifecycles.subscribe({
      models: [...viewIdsByUid.keys(), UPLOAD_FILE_UID],
      afterCreate: onWrite,
      afterCreateMany: onWrite,
      afterUpdate: onWrite,
      afterUpdateMany: onWrite,
      afterDelete: onWrite,
      afterDeleteMany: onWrite,
    });
  };

  return { get, set, flushViews, subscribe, size: (): number => entries.size };
};

export default cache;
