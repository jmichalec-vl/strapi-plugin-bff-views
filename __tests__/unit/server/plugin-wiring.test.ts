import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Core } from '@strapi/types';

import createViewController from '../../../server/src/controllers/view';
import contentApiRouter from '../../../server/src/routes/content-api';
import irBridge from '../../../server/src/services/ir-bridge';
import sanitizer from '../../../server/src/services/sanitizer';
import bootstrap from '../../../server/src/bootstrap';
import { createMockStrapi } from '../../helpers/mock-strapi';
import { createTestContentTypes, createTestComponents } from '../../helpers/fixtures/test-schemas';

const views = [
  { id: 'page-view', path: '/page-view/:key' },
  { id: 'product-view', path: '/product-view/:slug' },
];

describe('view controller', () => {
  let mock: ReturnType<typeof createMockStrapi>;

  beforeEach(() => {
    mock = createMockStrapi();
    mock.registerService('bff-views', 'view-registry', { getViews: () => views });
  });

  it('exposes status and manifest plus one method per view id', () => {
    const controller = createViewController({ strapi: mock.strapi as unknown as Core.Strapi });

    expect(Object.keys(controller)).toEqual(['status', 'manifest', 'page-view', 'product-view']);
  });

  it('manifest delegates to the view registry', () => {
    const manifest = { manifestVersion: 1, views: [] };
    mock.registerService('bff-views', 'view-registry', {
      getViews: () => views,
      describeViews: () => manifest,
    });
    const controller = createViewController({ strapi: mock.strapi as unknown as Core.Strapi });
    const ctx = { params: {}, query: {}, state: {}, status: 200, body: undefined as unknown };

    (controller.manifest as (ctx: unknown) => void)(ctx);

    expect(ctx.body).toBe(manifest);
  });

  it('status lists the configured view ids', () => {
    const controller = createViewController({ strapi: mock.strapi as unknown as Core.Strapi });
    const ctx = { params: {}, query: {}, state: {}, status: 200, body: undefined as unknown };

    (controller.status as (ctx: unknown) => void)(ctx);

    expect(ctx.body).toEqual({ plugin: 'bff-views', views: ['page-view', 'product-view'] });
  });

  it('view methods delegate to the pipeline and write status and body', async () => {
    const run = vi.fn(async () => ({ status: 404, body: { data: null } }));
    mock.registerService('bff-views', 'pipeline', { run });
    const controller = createViewController({ strapi: mock.strapi as unknown as Core.Strapi });
    const ctx = { params: { key: 'x' }, query: {}, state: {}, status: 200, body: undefined };

    const handlers = controller as unknown as Record<string, (ctx: unknown) => Promise<void>>;
    await handlers['page-view']!(ctx);

    expect(run).toHaveBeenCalledWith('page-view', ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ data: null });
  });
});

describe('content-api router', () => {
  it('emits the static status route plus one scoped route per view', () => {
    const mock = createMockStrapi();
    mock.registerService('bff-views', 'view-registry', { getViews: () => views });

    const router = contentApiRouter({ strapi: mock.strapi as unknown as Core.Strapi });

    expect(router.type).toBe('content-api');
    expect(router.routes).toEqual([
      { method: 'GET', path: '/status', handler: 'view.status', config: { policies: [] } },
      { method: 'GET', path: '/manifest', handler: 'view.manifest', config: { policies: [] } },
      {
        method: 'GET',
        path: '/page-view/:key',
        handler: 'view.page-view',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/product-view/:slug',
        handler: 'view.product-view',
        config: { policies: [] },
      },
    ]);
  });
});

describe('ir-bridge', () => {
  const build = () => {
    const mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
    return { mock, bridge: irBridge({ strapi: mock.strapi as unknown as Core.Strapi }) };
  };

  it('builds fully inlined populate trees from the loaded schemas', () => {
    const { bridge } = build();

    expect(bridge.buildComponentPopulate('shared.seo')).toEqual({
      populate: { metaImage: true },
    });
    expect(bridge.buildComponentPopulate('content.hero')).toEqual({
      populate: { image: true, buttons: true },
    });
    expect(bridge.buildComponentPopulate('unknown.component')).toBe(true);
  });

  it('exposes the content-type IR with relations and dynamic zones typed', () => {
    const { bridge } = build();

    const ir = bridge.getContentTypeIR('api::page.page');
    const byName = Object.fromEntries((ir?.attributes ?? []).map((a) => [a.name, a]));

    expect(byName.documentId).toMatchObject({ type: 'string', required: true });
    expect(byName.modules).toMatchObject({
      type: 'dynamiczone',
      componentUIDs: ['content.hero', 'content.faq'],
    });
    expect(byName.author).toMatchObject({
      type: 'relation',
      relationTarget: 'api::author.author',
    });
    expect(byName.password).toBeUndefined();
    expect(bridge.getContentTypeIR('api::missing.missing')).toBeUndefined();
  });

  it('builds distinct populate trees per media narrowing variant', () => {
    const { bridge } = build();

    const full = bridge.buildComponentPopulate('shared.seo');
    const narrowed = bridge.buildComponentPopulate('shared.seo', { fields: ['url'] });

    expect(full).toEqual({ populate: { metaImage: true } });
    expect(narrowed).toEqual({ populate: { metaImage: { fields: ['url'] } } });
  });

  it('memoizes populate trees per media narrowing variant', () => {
    const { bridge } = build();

    const full = bridge.buildComponentPopulate('shared.seo');
    const narrowed = bridge.buildComponentPopulate('shared.seo', { fields: ['url'] });

    expect(bridge.buildComponentPopulate('shared.seo')).toBe(full);
    expect(bridge.buildComponentPopulate('shared.seo', { fields: ['url'] })).toBe(narrowed);
  });

  it('memoizes the component registry and populate trees per instance', () => {
    const { mock, bridge } = build();

    const first = bridge.getComponentRegistry();
    const firstTree = bridge.buildComponentPopulate('content.hero');
    // Mutating the source after the first read must not change results.
    mock.setComponents({});

    expect(bridge.getComponentRegistry()).toBe(first);
    expect(bridge.buildComponentPopulate('content.hero')).toBe(firstTree);
  });
});

describe('sanitizer', () => {
  it('sanitizes against the full content-type model with the request auth', async () => {
    const mock = createMockStrapi();
    mock.setContentTypes({ 'api::page.page': { uid: 'api::page.page' } });
    const service = sanitizer({ strapi: mock.strapi as unknown as Core.Strapi });
    const auth = { strategy: 'api-token' };

    await service.sanitizeDocument({ title: 'Home' }, 'api::page.page', auth);

    expect(mock.strapi.getModel).toHaveBeenCalledWith('api::page.page');
    expect(mock.strapi.contentAPI.sanitize.output).toHaveBeenCalledWith(
      { title: 'Home' },
      { uid: 'api::page.page' },
      { auth },
    );
  });

  it('normalizes nullish documents to null without calling sanitize', async () => {
    const mock = createMockStrapi();
    const service = sanitizer({ strapi: mock.strapi as unknown as Core.Strapi });

    expect(await service.sanitizeDocument(null, 'api::page.page', {})).toBeNull();
    expect(await service.sanitizeDocument(undefined, 'api::page.page', {})).toBeNull();
    expect(mock.strapi.contentAPI.sanitize.output).not.toHaveBeenCalled();
  });
});

describe('bootstrap', () => {
  it('validates the view registry and subscribes the cache', async () => {
    const mock = createMockStrapi();
    const validateOrThrow = vi.fn();
    const subscribe = vi.fn();
    mock.registerService('bff-views', 'view-registry', { validateOrThrow });
    mock.registerService('bff-views', 'cache', { subscribe });

    await bootstrap({ strapi: mock.strapi as unknown as Core.Strapi });

    expect(validateOrThrow).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
  });
});
