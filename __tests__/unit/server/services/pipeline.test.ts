import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Core } from '@strapi/types';

import pipeline, { authCacheKey } from '../../../../server/src/services/pipeline';
import viewRegistry from '../../../../server/src/services/view-registry';
import type { QueryPlan, SubResult } from '../../../../server/src/types';
import { createMockStrapi } from '../../../helpers/mock-strapi';
import {
  createTestContentTypes,
  createTestComponents,
  createValidViewsConfig,
} from '../../../helpers/fixtures/test-schemas';

const requestCtx = (overrides: Partial<Record<'params' | 'query' | 'state', unknown>> = {}) => ({
  params: { key: 'home' },
  query: {},
  state: { auth: { strategy: 'api-token' } },
  ...(overrides as object),
});

describe('pipeline', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let run: ReturnType<typeof pipeline>['run'];

  const emptyPlan: QueryPlan = { subQueries: [] };
  const plan = vi.fn(() => emptyPlan);
  const execute = vi.fn(async (): Promise<readonly SubResult[]> => []);
  const sanitizeDocument = vi.fn(async (data: unknown) => data);
  const apply = vi.fn(
    async (tree: unknown, _contentTypeUid: string, _transforms: readonly string[]) =>
      Array.isArray(tree) ? tree : { ...(tree as Record<string, unknown>), transformed: true },
  );
  // Mirrors the real builder's contract: a direct override replaces the tree.
  const buildComponentPopulate = vi.fn(
    (uid: string, _media?: unknown, overrides?: Record<string, unknown>) =>
      overrides?.[uid] ?? { populate: { metaImage: true } },
  );

  const cacheGet = vi.fn((): unknown => undefined);
  const cacheSet = vi.fn();

  const setup = (config: unknown) => {
    mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
    mock.setPluginConfig('bff-views', config);

    const strapi = mock.strapi as unknown as Core.Strapi;
    mock.registerService('bff-views', 'view-registry', viewRegistry({ strapi }));
    mock.registerService('bff-views', 'ir-bridge', { buildComponentPopulate });
    mock.registerService('bff-views', 'planner', { plan });
    mock.registerService('bff-views', 'executor', { execute });
    mock.registerService('bff-views', 'sanitizer', { sanitizeDocument });
    mock.registerService('bff-views', 'transformer', { apply });
    mock.registerService('bff-views', 'cache', { get: cacheGet, set: cacheSet });
    mock.registerService('bff-views', 'query-gate', { run: (fn: () => unknown) => fn() });

    run = pipeline({ strapi }).run;
  };

  beforeEach(() => setup(createValidViewsConfig()));

  describe('core query (stages 1-3)', () => {
    it('issues the core query with lookup filter, scalar fields, and minimal DZ populate', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1', title: 'Home', modules: [] });

      await run('page-view', requestCtx());

      expect(mock.strapi.documents).toHaveBeenCalledWith('api::page.page');
      expect(mock.findFirst).toHaveBeenCalledWith({
        filters: { slug: { $eq: 'home' } },
        status: 'published',
        fields: ['title', 'slug', 'summary', 'documentId'],
        populate: {
          seo: { populate: { metaImage: true } },
          modules: {
            on: {
              'content.hero': { fields: ['id'] },
              'content.faq': { fields: ['id'] },
            },
          },
        },
      });
      expect(buildComponentPopulate).toHaveBeenCalledWith('shared.seo', undefined, undefined);
    });

    it('returns the 404 envelope when no document matches', async () => {
      mock.findFirst.mockResolvedValue(null);

      const result = await run('page-view', requestCtx({ params: { key: 'ghost' } }));

      expect(result.status).toBe(404);
      expect(result.body).toEqual({
        data: null,
        error: {
          status: 404,
          name: 'NotFoundError',
          message: "No document for slug='ghost'",
        },
      });
    });

    it('maps publicationState=preview to draft status when the view allows preview', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await run('page-view', requestCtx({ query: { publicationState: 'preview' } }));

      expect(mock.findFirst).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    });

    it('rejects preview with 403 when the view does not opt in', async () => {
      const result = await run(
        'product-view',
        requestCtx({ params: { slug: 'widget' }, query: { publicationState: 'preview' } }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toEqual({
        data: null,
        error: {
          status: 403,
          name: 'ForbiddenError',
          message: "Preview is not enabled for view 'product-view' (set allowPreview: true)",
        },
      });
      expect(mock.findFirst).not.toHaveBeenCalled();
    });

    it('passes locale through to core and sub-queries', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await run('page-view', requestCtx({ query: { locale: 'fr' } }));

      expect(mock.findFirst).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr' }));
      expect(execute).toHaveBeenCalledWith(
        emptyPlan,
        expect.objectContaining({ name: null, contentType: 'api::page.page' }),
        {
          documentId: 'd1',
          status: 'published',
          locale: 'fr',
        },
      );
    });

    it('returns 500 for an unknown view id', async () => {
      const result = await run('ghost-view', requestCtx());

      expect(result.status).toBe(500);
    });
  });

  describe('plan -> execute -> sanitize -> merge -> transform -> hooks (stages 4-9)', () => {
    it('plans from the core result and executes against the resolved document', async () => {
      const core = { documentId: 'd1', title: 'Home', modules: [] };
      mock.findFirst.mockResolvedValue(core);

      await run('page-view', requestCtx());

      expect(plan).toHaveBeenCalledWith(
        expect.objectContaining({ name: null, contentType: 'api::page.page' }),
        core,
      );
      expect(execute).toHaveBeenCalledWith(
        emptyPlan,
        expect.objectContaining({ name: null, contentType: 'api::page.page' }),
        {
          documentId: 'd1',
          status: 'published',
          locale: undefined,
        },
      );
    });

    it('sanitizes the core document and every sub-result before merging', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1', modules: [] });
      const subResult: SubResult = {
        subQuery: {
          id: 'dz:modules:content.hero',
          kind: 'dz-component',
          uid: 'api::page.page',
          zone: 'modules',
          params: {},
        },
        document: { documentId: 'd1', modules: [] },
        ms: 2,
      };
      execute.mockResolvedValueOnce([subResult]);

      await run('page-view', requestCtx());

      expect(sanitizeDocument).toHaveBeenCalledTimes(2);
      expect(sanitizeDocument).toHaveBeenCalledWith(
        { documentId: 'd1', modules: [] },
        'api::page.page',
        { strategy: 'api-token' },
      );
    });

    it('merges populated DZ entries into the response document', async () => {
      mock.findFirst.mockResolvedValue({
        documentId: 'd1',
        title: 'Home',
        modules: [{ __component: 'content.hero', id: 1 }],
      });
      execute.mockResolvedValueOnce([
        {
          subQuery: {
            id: 'dz:modules:content.hero',
            kind: 'dz-component',
            uid: 'api::page.page',
            zone: 'modules',
            componentUid: 'content.hero',
            params: {},
          },
          document: {
            documentId: 'd1',
            modules: [{ __component: 'content.hero', id: 1, title: 'Full hero' }],
          },
          ms: 3,
        },
      ]);

      const result = await run('page-view', requestCtx());

      expect(result.status).toBe(200);
      const data = (result.body as { data: Record<string, unknown> }).data;
      expect(data.modules).toEqual([{ __component: 'content.hero', id: 1, title: 'Full hero' }]);
      expect(data.transformed).toBe(true);
    });

    it('runs enrich then assemble hooks with the hook context', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1', name: 'Widget' });

      const result = await run('product-view', requestCtx({ params: { slug: 'widget' } }));

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        data: {
          product: {
            documentId: 'd1',
            name: 'Widget',
            transformed: true,
            enriched: true,
          },
        },
        meta: { view: 'product-view' },
      });
    });

    it('passes the data first and the context second to both hooks', async () => {
      const enrich = vi.fn(async (draft: unknown) => draft);
      const assemble = vi.fn(async (merged: unknown) => merged);
      const config = createValidViewsConfig() as unknown as {
        views: Record<string, Record<string, unknown>>;
      };
      config.views['page-view'] = { ...config.views['page-view'], enrich, assemble };
      setup(config);
      mock.findFirst.mockResolvedValue({ documentId: 'd1', title: 'Home' });

      await run('page-view', requestCtx());

      const hookCtx = expect.objectContaining({
        view: 'page-view',
        key: 'home',
        status: 'published',
      });
      expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'd1' }), hookCtx);
      expect(assemble).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'd1' }), hookCtx);
    });

    it('populates root media fields in the core query', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1', name: 'Widget' });

      await run('product-view', requestCtx({ params: { slug: 'widget' } }));

      expect(mock.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          populate: expect.objectContaining({ cover: true }),
        }),
      );
    });

    it('prefers planner.components overrides for componentFields in the core query', async () => {
      const config = createValidViewsConfig() as unknown as {
        views: Record<string, { planner: Record<string, unknown> }>;
      };
      config.views['page-view'].planner = {
        ...config.views['page-view'].planner,
        components: { 'shared.seo': { fields: ['metaTitle'] } },
      };
      setup(config);
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await run('page-view', requestCtx());

      expect(mock.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          populate: expect.objectContaining({ seo: { fields: ['metaTitle'] } }),
        }),
      );
      // The override map reaches the builder so it applies at any depth,
      // not just for the top-level component uid.
      expect(buildComponentPopulate).toHaveBeenCalledWith('shared.seo', undefined, {
        'shared.seo': { fields: ['metaTitle'] },
      });
    });

    it('does not consult the cache for views without caching', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await run('page-view', requestCtx());

      expect(cacheGet).not.toHaveBeenCalled();
      expect(cacheSet).not.toHaveBeenCalled();
    });

    it('fails the whole request when a sub-query fails, and never serves a partial page', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'd1', modules: [] });
      execute.mockRejectedValueOnce(new Error('db down'));

      const result = await run('page-view', requestCtx());

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        data: null,
        error: { status: 500, name: 'BffViewError', message: "View 'page-view' failed" },
      });
      expect(mock.strapi.log.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
  });

  describe('singleton views', () => {
    it('issues the core query without filters and wraps the document in the data envelope', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'sc1', title: 'Acme' });

      const result = await run('site-config', requestCtx({ params: {} }));

      expect(result.status).toBe(200);
      expect(mock.strapi.documents).toHaveBeenCalledWith('api::site-config.site-config');

      const query = mock.findFirst.mock.calls[0]?.[0] as Record<string, unknown>;
      expect('filters' in query).toBe(false);
      expect(query.fields).toEqual(['title', 'tagline', 'documentId']);
      expect(query.populate).toEqual({
        seo: { populate: { metaImage: true } },
        promo: true,
      });

      expect(result.body).toEqual({
        data: { documentId: 'sc1', title: 'Acme', transformed: true },
        meta: { view: 'site-config' },
      });
    });

    it('returns a 404 naming the content type when the single type has no document', async () => {
      mock.findFirst.mockResolvedValue(null);

      const result = await run('site-config', requestCtx({ params: {} }));

      expect(result.status).toBe(404);
      expect(result.body).toEqual({
        data: null,
        error: {
          status: 404,
          name: 'NotFoundError',
          message: "No published document for 'api::site-config.site-config'",
        },
      });
    });
  });

  describe('composite views', () => {
    const categories = [
      { documentId: 'c1', title: 'News', slug: 'news' },
      { documentId: 'c2', title: 'Guides', slug: 'guides' },
    ];

    it('composes named source results into the data object', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'sc1', title: 'Acme' });
      mock.findMany.mockResolvedValue(categories);

      const result = await run('chrome', requestCtx({ params: {} }));

      expect(result.status).toBe(200);
      expect((result.body as { data: unknown }).data).toEqual({
        config: { documentId: 'sc1', title: 'Acme', transformed: true },
        categories,
      });
    });

    it('composes null for an absent single source instead of a 404', async () => {
      mock.findFirst.mockResolvedValue(null);
      mock.findMany.mockResolvedValue(categories);

      const result = await run('chrome', requestCtx({ params: {} }));

      expect(result.status).toBe(200);
      const data = (result.body as { data: Record<string, unknown> }).data;
      expect(data.config).toBeNull();
      expect(data.categories).toEqual(categories);
    });

    it('fetches a many source with one unfiltered findMany selecting the core fields', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'sc1' });
      mock.findMany.mockResolvedValue(categories);

      await run('chrome', requestCtx({ params: {} }));

      expect(mock.findMany).toHaveBeenCalledTimes(1);
      expect(mock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ fields: ['title', 'slug', 'documentId'] }),
      );
      const query = mock.findMany.mock.calls[0]?.[0] as Record<string, unknown>;
      expect('filters' in query).toBe(false);
      expect('limit' in query).toBe(false);
    });

    it('passes the configured limit of a many source to findMany', async () => {
      const config = createValidViewsConfig() as unknown as {
        views: Record<string, { sources: Record<string, Record<string, unknown>> }>;
      };
      const chrome = config.views.chrome as { sources: Record<string, Record<string, unknown>> };
      chrome.sources.categories = { ...chrome.sources.categories, limit: 25 };
      setup(config);
      mock.findFirst.mockResolvedValue({ documentId: 'sc1' });
      mock.findMany.mockResolvedValue([]);

      await run('chrome', requestCtx({ params: {} }));

      expect(mock.findMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    });

    it('caches keyless views under the empty key', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'sc1' });
      mock.findMany.mockResolvedValue([]);

      await run('chrome', requestCtx({ params: {} }));

      expect(cacheGet).toHaveBeenCalledWith('chrome', '', 'published', undefined, 'api-token:none');
      expect(cacheSet).toHaveBeenCalledWith(
        'chrome',
        '',
        'published',
        undefined,
        expect.objectContaining({ data: expect.anything() }),
        undefined,
        'api-token:none',
      );
    });

    it('transforms each source with its own content type', async () => {
      mock.findFirst.mockResolvedValue({ documentId: 'sc1', title: 'Acme' });
      mock.findMany.mockResolvedValue(categories);

      await run('chrome', requestCtx({ params: {} }));

      expect(apply).toHaveBeenCalledWith(expect.anything(), 'api::site-config.site-config', [
        'uppercase-richtext',
      ]);
      expect(apply).toHaveBeenCalledWith(expect.anything(), 'api::category.category', [
        'uppercase-richtext',
      ]);
    });
  });

  describe('cache and explain (stages 2 and 10)', () => {
    const withCachedPageView = (explain?: 'on' | 'off') => {
      const config = createValidViewsConfig() as unknown as {
        explain?: string;
        views: Record<string, Record<string, unknown>>;
      };
      config.views['page-view'] = {
        ...config.views['page-view'],
        cache: { enabled: true, ttlMs: 60_000 },
      };
      if (explain) config.explain = explain;
      setup(config);
    };

    it('stores the published outcome and serves cache hits without re-querying', async () => {
      withCachedPageView();
      mock.findFirst.mockResolvedValue({ documentId: 'd1', title: 'Home' });

      await run('page-view', requestCtx());

      // Cache keys carry the caller identity - sanitized output is per-token.
      expect(cacheGet).toHaveBeenCalledWith(
        'page-view',
        'home',
        'published',
        undefined,
        'api-token:none',
      );
      expect(cacheSet).toHaveBeenCalledWith(
        'page-view',
        'home',
        'published',
        undefined,
        expect.objectContaining({ data: expect.anything() }),
        60_000,
        'api-token:none',
      );

      const stored = cacheSet.mock.calls[0]?.[4];
      cacheGet.mockReturnValueOnce(stored);
      mock.findFirst.mockClear();

      const result = await run('page-view', requestCtx());

      expect(result.status).toBe(200);
      expect(mock.findFirst).not.toHaveBeenCalled();
    });

    it('collapses concurrent misses for one key into a single render', async () => {
      withCachedPageView();
      let release: () => void = () => undefined;
      mock.findFirst.mockImplementation(
        () => new Promise((resolve) => (release = () => resolve({ documentId: 'd1' }))),
      );

      const first = run('page-view', requestCtx());
      const second = run('page-view', requestCtx());
      await new Promise((resolve) => setImmediate(resolve));
      release();
      const [a, b] = await Promise.all([first, second]);

      expect(mock.findFirst).toHaveBeenCalledTimes(1);
      expect(a.status).toBe(200);
      expect(b.body).toEqual(a.body);
    });

    it('does not share renders across caller identities', async () => {
      withCachedPageView();
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await Promise.all([
        run(
          'page-view',
          requestCtx({ state: { auth: { strategy: 'api-token', credentials: { id: 1 } } } }),
        ),
        run(
          'page-view',
          requestCtx({ state: { auth: { strategy: 'api-token', credentials: { id: 2 } } } }),
        ),
      ]);

      expect(mock.findFirst).toHaveBeenCalledTimes(2);
    });

    it('never caches draft (preview) renders', async () => {
      withCachedPageView();
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      await run('page-view', requestCtx({ query: { publicationState: 'preview' } }));

      expect(cacheGet).not.toHaveBeenCalled();
      expect(cacheSet).not.toHaveBeenCalled();
    });

    it('does not cache 404 outcomes', async () => {
      withCachedPageView();
      mock.findFirst.mockResolvedValue(null);

      await run('page-view', requestCtx());

      expect(cacheSet).not.toHaveBeenCalled();
    });

    it('exposes plan, timings, and cache status under meta.explain when enabled', async () => {
      withCachedPageView('on');
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      const result = await run('page-view', requestCtx({ query: { _explain: 'true' } }));

      const meta = (result.body as { meta: Record<string, unknown> }).meta;
      expect(meta.explain).toEqual({
        cache: 'miss',
        plan: [],
        timings: [],
      });
    });

    it('reports the plan but no timings on a cache hit', async () => {
      withCachedPageView('on');
      cacheGet.mockReturnValueOnce({
        data: { documentId: 'd1' },
        plan: { subQueries: [] },
        timings: [{ id: 'x', ms: 1 }],
      });

      const result = await run('page-view', requestCtx({ query: { _explain: 'true' } }));

      const meta = (result.body as { meta: Record<string, unknown> }).meta;
      expect(meta.explain).toEqual({ cache: 'hit', plan: [] });
    });

    it('omits explain when disabled by config, even if requested', async () => {
      withCachedPageView('off');
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      const result = await run('page-view', requestCtx({ query: { _explain: 'true' } }));

      const meta = (result.body as { meta: Record<string, unknown> }).meta;
      expect(meta.explain).toBeUndefined();
    });

    it('omits explain when not requested', async () => {
      withCachedPageView('on');
      mock.findFirst.mockResolvedValue({ documentId: 'd1' });

      const result = await run('page-view', requestCtx());

      const meta = (result.body as { meta: Record<string, unknown> }).meta;
      expect(meta.explain).toBeUndefined();
    });
  });
});

describe('authCacheKey', () => {
  it('maps missing or malformed auth to the anonymous identity', () => {
    expect(authCacheKey(undefined)).toBe('anon');
    expect(authCacheKey(null)).toBe('anon');
    expect(authCacheKey('token')).toBe('anon');
  });

  it('combines the strategy name with the credential id', () => {
    expect(authCacheKey({ strategy: 'api-token', credentials: { id: 7 } })).toBe('api-token:7');
    expect(
      authCacheKey({ strategy: { name: 'users-permissions' }, credentials: { id: 'u1' } }),
    ).toBe('users-permissions:u1');
  });

  it('never collapses two strategies or an unauthenticated caller into one key', () => {
    expect(authCacheKey({ strategy: 'api-token' })).toBe('api-token:none');
    expect(authCacheKey({ credentials: { id: 7 } })).toBe('unknown:7');
    expect(authCacheKey({ strategy: 'api-token', credentials: { id: 7 } })).not.toBe(
      authCacheKey({ strategy: 'users-permissions', credentials: { id: 7 } }),
    );
  });
});
