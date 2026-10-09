import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Core } from '@strapi/types';

import cache from '../../../../server/src/services/cache';
import { createMockStrapi } from '../../../helpers/mock-strapi';

type LifecycleHandlers = Record<string, (event: { model: { uid: string } }) => void> & {
  models: readonly string[];
};

const view = (id: string, participatingUids: readonly string[], enabled = true) => ({
  id,
  cache: { enabled },
  participatingUids,
});

describe('cache', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let service: ReturnType<typeof cache>;

  const build = (config: unknown = {}, views: readonly unknown[] = []) => {
    mock = createMockStrapi();
    mock.setPluginConfig('bff-views', config);
    mock.registerService('bff-views', 'view-registry', {
      getViews: vi.fn(() => views),
    });
    service = cache({ strapi: mock.strapi as unknown as Core.Strapi });
  };

  beforeEach(() => build());

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get/set', () => {
    it('round-trips values by view, key, status, and locale', () => {
      service.set('page-view', 'home', 'published', undefined, { data: 1 }, undefined, 'anon');

      expect(service.get('page-view', 'home', 'published', undefined, 'anon')).toEqual({ data: 1 });
      expect(service.get('page-view', 'home', 'published', 'fr', 'anon')).toBeUndefined();
      expect(service.get('page-view', 'other', 'published', undefined, 'anon')).toBeUndefined();
      expect(service.get('other-view', 'home', 'published', undefined, 'anon')).toBeUndefined();
    });

    it('never shares entries across caller identities', () => {
      service.set(
        'page-view',
        'home',
        'published',
        undefined,
        'for-token-1',
        undefined,
        'api-token:1',
      );

      expect(service.get('page-view', 'home', 'published', undefined, 'api-token:1')).toBe(
        'for-token-1',
      );
      expect(
        service.get('page-view', 'home', 'published', undefined, 'api-token:2'),
      ).toBeUndefined();
      expect(service.get('page-view', 'home', 'published', undefined, 'anon')).toBeUndefined();
    });

    it('expires entries after their ttl', () => {
      vi.useFakeTimers();
      service.set('page-view', 'home', 'published', undefined, { data: 1 }, 1_000, 'anon');

      expect(service.get('page-view', 'home', 'published', undefined, 'anon')).toEqual({ data: 1 });

      vi.advanceTimersByTime(1_001);
      expect(service.get('page-view', 'home', 'published', undefined, 'anon')).toBeUndefined();
      expect(service.size()).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    beforeEach(() => build({ cache: { maxEntries: 2 } }));

    it('evicts the least recently used entry at capacity', () => {
      service.set('v', 'a', 'published', undefined, 'A', undefined, 'anon');
      service.set('v', 'b', 'published', undefined, 'B', undefined, 'anon');
      // Touch 'a' so 'b' becomes the LRU entry.
      service.get('v', 'a', 'published', undefined, 'anon');

      service.set('v', 'c', 'published', undefined, 'C', undefined, 'anon');

      expect(service.get('v', 'a', 'published', undefined, 'anon')).toBe('A');
      expect(service.get('v', 'b', 'published', undefined, 'anon')).toBeUndefined();
      expect(service.get('v', 'c', 'published', undefined, 'anon')).toBe('C');
    });

    it('does not evict when overwriting an existing key', () => {
      service.set('v', 'a', 'published', undefined, 'A', undefined, 'anon');
      service.set('v', 'b', 'published', undefined, 'B', undefined, 'anon');
      service.set('v', 'a', 'published', undefined, 'A2', undefined, 'anon');

      expect(service.get('v', 'a', 'published', undefined, 'anon')).toBe('A2');
      expect(service.get('v', 'b', 'published', undefined, 'anon')).toBe('B');
    });

    it('treats an overwritten entry as most recently used', () => {
      service.set('v', 'a', 'published', undefined, 'A', undefined, 'anon');
      service.set('v', 'b', 'published', undefined, 'B', undefined, 'anon');
      service.set('v', 'a', 'published', undefined, 'A2', undefined, 'anon');

      service.set('v', 'c', 'published', undefined, 'C', undefined, 'anon');

      expect(service.get('v', 'a', 'published', undefined, 'anon')).toBe('A2');
      expect(service.get('v', 'b', 'published', undefined, 'anon')).toBeUndefined();
    });
  });

  describe('flushViews', () => {
    it('flushes only the given views, never prefix look-alikes', () => {
      service.set('page', 'a', 'published', undefined, 1, undefined, 'anon');
      service.set('page-two', 'a', 'published', undefined, 2, undefined, 'anon');

      service.flushViews(['page']);

      expect(service.get('page', 'a', 'published', undefined, 'anon')).toBeUndefined();
      expect(service.get('page-two', 'a', 'published', undefined, 'anon')).toBe(2);
    });
  });

  describe('lifecycle subscription', () => {
    const subscribedHandlers = (): LifecycleHandlers =>
      (mock.strapi.db.lifecycles.subscribe as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as LifecycleHandlers;

    it('does not subscribe when no view has caching enabled', () => {
      build({}, [view('page-view', ['api::page.page'], false)]);

      service.subscribe();

      expect(mock.strapi.db.lifecycles.subscribe).not.toHaveBeenCalled();
    });

    it('subscribes to participating uids plus the upload model, on all write events', () => {
      build({}, [view('page-view', ['api::page.page', 'content.hero'])]);

      service.subscribe();

      const handlers = subscribedHandlers();
      expect(handlers.models).toEqual(['api::page.page', 'content.hero', 'plugin::upload.file']);
      for (const action of [
        'afterCreate',
        'afterCreateMany',
        'afterUpdate',
        'afterUpdateMany',
        'afterDelete',
        'afterDeleteMany',
      ]) {
        expect(handlers[action]).toBeTypeOf('function');
      }
    });

    it('flushes only the views participating in the written uid', () => {
      build({}, [
        view('page-view', ['api::page.page', 'content.hero']),
        view('product-view', ['api::product.product']),
      ]);
      service.subscribe();
      service.set('page-view', 'home', 'published', undefined, 1, undefined, 'anon');
      service.set('product-view', 'widget', 'published', undefined, 2, undefined, 'anon');

      subscribedHandlers().afterUpdate!({ model: { uid: 'content.hero' } });

      expect(service.get('page-view', 'home', 'published', undefined, 'anon')).toBeUndefined();
      expect(service.get('product-view', 'widget', 'published', undefined, 'anon')).toBe(2);
    });

    it('a write to a many-source content type flushes the composite view', () => {
      build({}, [view('chrome', ['api::site-config.site-config', 'api::category.category'])]);
      service.subscribe();
      service.set('chrome', '', 'published', undefined, { data: 1 }, undefined, 'anon');

      subscribedHandlers().afterUpdate!({ model: { uid: 'api::category.category' } });

      expect(service.get('chrome', '', 'published', undefined, 'anon')).toBeUndefined();
    });

    it('flushes every cached view on media writes', () => {
      build({}, [
        view('page-view', ['api::page.page']),
        view('product-view', ['api::product.product']),
      ]);
      service.subscribe();
      service.set('page-view', 'home', 'published', undefined, 1, undefined, 'anon');
      service.set('product-view', 'widget', 'published', undefined, 2, undefined, 'anon');

      subscribedHandlers().afterCreate!({ model: { uid: 'plugin::upload.file' } });

      expect(service.size()).toBe(0);
    });
  });
});
