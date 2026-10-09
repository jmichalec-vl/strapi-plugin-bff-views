import { describe, it, expect, beforeEach } from 'vitest';
import type { Core } from '@strapi/types';

import viewRegistry from '../../../../server/src/services/view-registry';
import { createMockStrapi } from '../../../helpers/mock-strapi';
import {
  createTestContentTypes,
  createTestComponents,
  createValidViewsConfig,
} from '../../../helpers/fixtures/test-schemas';

describe('view-registry', () => {
  let mock: ReturnType<typeof createMockStrapi>;

  const registryWith = (config: unknown) => {
    mock.setPluginConfig('bff-views', config);
    return viewRegistry({ strapi: mock.strapi as unknown as Core.Strapi });
  };

  beforeEach(() => {
    mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
  });

  describe('resolution', () => {
    it('resolves valid views with key param, core fields, and dz components', () => {
      const registry = registryWith(createValidViewsConfig());

      const pageView = registry.getView('page-view');
      expect(pageView).toBeDefined();
      expect(pageView?.kind).toBe('keyed');
      expect(pageView?.keyParam).toBe('key');
      expect(pageView?.sources).toHaveLength(1);

      const pageSource = pageView?.sources[0];
      expect(pageSource?.name).toBeNull();
      expect(pageSource?.coreFields).toEqual(['title', 'slug', 'summary', 'documentId']);
      expect(pageSource?.dzComponents).toEqual({ modules: ['content.hero', 'content.faq'] });
      expect(pageSource?.componentFieldUids).toEqual({ seo: 'shared.seo' });

      const productView = registry.getView('product-view');
      expect(productView?.keyParam).toBe('slug');
      expect(productView?.sources[0]?.dzComponents.extras).toEqual(['content.faq']);
      expect(productView?.sources[0]?.mediaFieldMultiples).toEqual({ cover: false });
    });

    it('resolves a singleton view with one unnamed source and no key handling', () => {
      const registry = registryWith(createValidViewsConfig());

      const siteConfig = registry.getView('site-config');
      expect(siteConfig?.kind).toBe('singleton');
      expect(siteConfig?.keyParam).toBeNull();
      expect(siteConfig?.lookup).toBeNull();
      expect(siteConfig?.sources).toHaveLength(1);
      expect(siteConfig?.sources[0]).toMatchObject({
        name: null,
        contentType: 'api::site-config.site-config',
        many: false,
        coreFields: ['title', 'tagline', 'documentId'],
        componentFieldUids: { seo: 'shared.seo' },
        mediaFieldMultiples: { promo: false },
      });
      expect(siteConfig?.participatingUids).toEqual(
        expect.arrayContaining(['api::site-config.site-config', 'shared.seo']),
      );
    });

    it('resolves a composite view with named sources in declaration order', () => {
      const registry = registryWith(createValidViewsConfig());

      const chrome = registry.getView('chrome');
      expect(chrome?.kind).toBe('composite');
      expect(chrome?.keyParam).toBeNull();
      expect(chrome?.lookup).toBeNull();
      expect(chrome?.sources.map((source) => source.name)).toEqual(['config', 'categories']);
      expect(chrome?.sources[0]?.contentType).toBe('api::site-config.site-config');
      expect(chrome?.sources[0]?.many).toBe(false);
      expect(chrome?.sources[1]?.contentType).toBe('api::category.category');
      expect(chrome?.sources[1]?.many).toBe(true);
      expect(chrome?.participatingUids).toEqual(
        expect.arrayContaining(['api::site-config.site-config', 'api::category.category']),
      );
    });

    it('computes participating uids transitively including relation targets', () => {
      const registry = registryWith(createValidViewsConfig());

      expect(registry.getView('page-view')?.participatingUids).toEqual(
        expect.arrayContaining([
          'api::page.page',
          'content.hero',
          'content.button',
          'content.faq',
          'content.faq-item',
          'shared.seo',
          'api::author.author',
        ]),
      );

      const productUids = registry.getView('product-view')?.participatingUids ?? [];
      expect(productUids).toContain('api::variant.variant');
      expect(productUids).toContain('api::category.category');
      expect(productUids).not.toContain('shared.seo');
    });

    it('includes targets of relations that live inside reachable components', () => {
      const registry = registryWith(createValidViewsConfig());

      // content.button (inside content.hero, inside the modules zone) links to a page.
      expect(registry.getView('product-view')?.participatingUids).toContain('api::page.page');
    });

    it('includes targets reached through a nested relation overlay populate', () => {
      const registry = registryWith({
        views: {
          'product-view': {
            contentType: 'api::product.product',
            path: '/product-view/:slug',
            lookup: { field: 'slug' },
            planner: {
              fields: ['name'],
              relations: { category: { fields: ['title'], populate: { brand: true } } },
            },
          },
        },
      });

      const uids = registry.getView('product-view')?.participatingUids ?? [];
      expect(uids).toContain('api::category.category');
      expect(uids).toContain('api::brand.brand');
    });

    it('carries the many-source limit into the resolved source and the manifest', () => {
      const config = createValidViewsConfig() as unknown as {
        views: Record<string, { sources: Record<string, Record<string, unknown>> }>;
      };
      config.views.chrome.sources.categories = {
        ...config.views.chrome.sources.categories,
        limit: 50,
      };
      const registry = registryWith(config);

      expect(registry.getView('chrome')?.sources[1]?.limit).toBe(50);
      const entry = registry.describeViews().views.find((view) => view.id === 'chrome');
      expect(entry?.sources?.categories?.limit).toBe(50);
      expect(entry?.sources?.config && 'limit' in entry.sources.config).toBe(false);
      expect(mock.strapi.log.warn).not.toHaveBeenCalled();
    });

    it('warns at startup when a many source has no limit', () => {
      registryWith(createValidViewsConfig()).getViews();

      expect(mock.strapi.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("source 'categories': `many: true` without `limit`"),
      );
    });

    it('resolves a planner without fields to a documentId-only core selection', () => {
      const registry = registryWith({
        views: {
          'page-view': {
            contentType: 'api::page.page',
            path: '/page-view/:key',
            lookup: { field: 'slug' },
            planner: { componentFields: ['seo'] },
          },
        },
      });

      expect(registry.getView('page-view')?.sources[0]?.coreFields).toEqual(['documentId']);
    });

    it('returns an empty list when no views are configured', () => {
      expect(registryWith(undefined).getViews()).toEqual([]);
      expect(registryWith({}).getViews()).toEqual([]);
    });

    it('resolves mediaPopulate per view, falling back to the global value', () => {
      const config = createValidViewsConfig() as unknown as {
        mediaPopulate?: unknown;
        views: Record<string, { planner: Record<string, unknown> }>;
      };
      config.mediaPopulate = { fields: ['url'] };
      config.views['product-view'].planner = {
        ...config.views['product-view'].planner,
        mediaPopulate: { fields: ['url', 'width'] },
      };
      const registry = registryWith(config);

      expect(registry.getView('page-view')?.sources[0]?.mediaPopulate).toEqual({
        fields: ['url'],
      });
      expect(registry.getView('product-view')?.sources[0]?.mediaPopulate).toEqual({
        fields: ['url', 'width'],
      });

      const manifest = registry.describeViews();
      expect(manifest.views[0]?.mediaPopulate).toEqual({ fields: ['url'] });
      expect(manifest.views[1]?.mediaPopulate).toEqual({ fields: ['url', 'width'] });
    });

    it('memoizes resolution across calls', () => {
      const registry = registryWith(createValidViewsConfig());
      expect(registry.getViews()).toBe(registry.getViews());
    });
  });

  describe('describeViews', () => {
    it('produces a serializable manifest with hook flags and transform match specs', () => {
      const registry = registryWith(createValidViewsConfig());

      const manifest = registry.describeViews();

      expect(manifest.manifestVersion).toBe(1);
      expect(manifest.views.map((view) => view.id)).toEqual([
        'page-view',
        'product-view',
        'site-config',
        'chrome',
      ]);

      const pageView = manifest.views[0]!;
      expect(pageView).toMatchObject({
        path: '/page-view/:key',
        kind: 'keyed',
        many: false,
        keyParam: 'key',
        contentType: 'api::page.page',
        lookup: { field: 'slug' },
        fields: ['title', 'slug', 'summary', 'documentId'],
        componentFields: { seo: 'shared.seo' },
        dynamicZones: { modules: ['content.hero', 'content.faq'] },
        relations: { author: true },
        componentOverrides: {},
        transforms: [{ name: 'uppercase-richtext', match: { fieldType: 'richtext' } }],
        hasEnrich: false,
        hasAssemble: false,
      });

      const productView = manifest.views[1]!;
      expect(productView.hasEnrich).toBe(true);
      expect(productView.hasAssemble).toBe(true);
      expect(productView.mediaFields).toEqual({ cover: { multiple: false } });
      expect(productView.relations).toEqual({
        variants: { fields: ['sku', 'price'] },
        category: { fields: ['title', 'slug'], populate: {} },
      });

      // Plain data only - must survive JSON round-tripping unchanged.
      expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    });

    it('describes singleton views with the flat shape and no key fields', () => {
      const manifest = registryWith(createValidViewsConfig()).describeViews();

      const entry = manifest.views.find((view) => view.id === 'site-config')!;
      expect(entry.kind).toBe('singleton');
      expect('keyParam' in entry).toBe(false);
      expect('lookup' in entry).toBe(false);
      expect(entry).toMatchObject({
        path: '/site-config',
        contentType: 'api::site-config.site-config',
        many: false,
        fields: ['title', 'tagline', 'documentId'],
        componentFields: { seo: 'shared.seo' },
        mediaFields: { promo: { multiple: false } },
        dynamicZones: {},
        relations: {},
        componentOverrides: {},
      });
    });

    it('describes composite views through a sources record without a flat source shape', () => {
      const manifest = registryWith(createValidViewsConfig()).describeViews();

      const entry = manifest.views.find((view) => view.id === 'chrome')!;
      expect(entry.kind).toBe('composite');
      expect('contentType' in entry).toBe(false);
      expect('keyParam' in entry).toBe(false);
      expect('lookup' in entry).toBe(false);
      expect(entry.sources).toEqual({
        config: {
          contentType: 'api::site-config.site-config',
          many: false,
          fields: ['title', 'documentId'],
          componentFields: {},
          mediaFields: {},
          dynamicZones: {},
          relations: {},
          componentOverrides: {},
        },
        categories: {
          contentType: 'api::category.category',
          many: true,
          fields: ['title', 'slug', 'documentId'],
          componentFields: {},
          mediaFields: {},
          dynamicZones: {},
          relations: {},
          componentOverrides: {},
        },
      });
      expect(entry.transforms).toEqual([
        { name: 'uppercase-richtext', match: { fieldType: 'richtext' } },
      ]);
    });
  });

  describe('validation failures', () => {
    const withPageView = (view: Record<string, unknown>) => ({
      views: {
        'page-view': {
          contentType: 'api::page.page',
          path: '/page-view/:key',
          lookup: { field: 'slug' },
          planner: { fields: ['title'] },
          ...view,
        },
      },
    });

    it('rejects an unknown content type', () => {
      const registry = registryWith(withPageView({ contentType: 'api::missing.missing' }));
      expect(() => registry.getViews()).toThrow("unknown content type 'api::missing.missing'");
    });

    it('rejects an unknown lookup field', () => {
      const registry = registryWith(withPageView({ lookup: { field: 'nope' } }));
      expect(() => registry.getViews()).toThrow("lookup field 'nope'");
    });

    it('rejects non-scalar planner fields', () => {
      const registry = registryWith(withPageView({ planner: { fields: ['modules'] } }));
      expect(() => registry.getViews()).toThrow('only scalar fields');
    });

    it('rejects unknown planner fields', () => {
      const registry = registryWith(withPageView({ planner: { fields: ['ghost'] } }));
      expect(() => registry.getViews()).toThrow("planner field 'ghost'");
    });

    it('rejects private planner fields - sanitization would silently strip them', () => {
      const registry = registryWith(withPageView({ planner: { fields: ['title', 'secret'] } }));
      expect(() => registry.getViews()).toThrow('`private: true`');
    });

    it('rejects a dynamic zone that is not a dynamic zone', () => {
      const registry = registryWith(
        withPageView({ planner: { fields: ['title'], dynamicZones: ['title'] } }),
      );
      expect(() => registry.getViews()).toThrow('not a dynamic zone');
    });

    it('rejects a component field that is not a component', () => {
      const registry = registryWith(
        withPageView({ planner: { fields: ['title'], componentFields: ['title'] } }),
      );
      expect(() => registry.getViews()).toThrow('not a component field');
    });

    it('rejects a media field that is not media', () => {
      const registry = registryWith(
        withPageView({ planner: { fields: ['title'], mediaFields: ['title'] } }),
      );
      expect(() => registry.getViews()).toThrow('not a media field');
    });

    it('rejects a relation overlay on a non-relation field', () => {
      const registry = registryWith(
        withPageView({ planner: { fields: ['title'], relations: { title: true } } }),
      );
      expect(() => registry.getViews()).toThrow('not a relation field');
    });

    it('rejects unknown component overrides', () => {
      const registry = registryWith(
        withPageView({
          planner: { fields: ['title'], components: { 'ghost.ghost': {} } },
        }),
      );
      expect(() => registry.getViews()).toThrow("unknown component 'ghost.ghost'");
    });

    it('rejects unknown transformer names', () => {
      const registry = registryWith(withPageView({ transforms: ['missing'] }));
      expect(() => registry.getViews()).toThrow("unknown transformer 'missing'");
    });

    it('rejects duplicate view paths', () => {
      const registry = registryWith({
        views: {
          'view-a': {
            contentType: 'api::page.page',
            path: '/shared/:key',
            lookup: { field: 'slug' },
            planner: { fields: ['title'] },
          },
          'view-b': {
            contentType: 'api::product.product',
            path: '/shared/:key',
            lookup: { field: 'slug' },
            planner: { fields: ['name'] },
          },
        },
      });
      expect(() => registry.getViews()).toThrow("same path '/shared/:key'");
    });

    it('rejects a keyless single-source view on a collection type', () => {
      const registry = registryWith({
        views: {
          'page-view': {
            contentType: 'api::page.page',
            path: '/page',
            planner: { fields: ['title'] },
          },
        },
      });
      expect(() => registry.getViews()).toThrow(/single type/);
    });

    it('rejects a composite `many: true` source on a single type', () => {
      const registry = registryWith({
        views: {
          chrome: {
            path: '/chrome',
            sources: {
              configs: {
                contentType: 'api::site-config.site-config',
                many: true,
                planner: { fields: ['title'] },
              },
            },
          },
        },
      });
      expect(() => registry.getViews()).toThrow(/collection type/);
    });

    it('rejects a composite single source on a collection type', () => {
      const registry = registryWith({
        views: {
          chrome: {
            path: '/chrome',
            sources: {
              page: { contentType: 'api::page.page', planner: { fields: ['title'] } },
            },
          },
        },
      });
      expect(() => registry.getViews()).toThrow(/arbitrary document/);
    });

    it('rejects a view path colliding with plugin routes', () => {
      const registry = registryWith({
        views: {
          'status-view': {
            contentType: 'api::site-config.site-config',
            path: '/status',
            planner: { fields: ['title'] },
          },
        },
      });
      // '/status' resolves as a valid singleton, so the collision guard alone
      // must reject it.
      expect(() => registry.getViews()).toThrow('collides');
    });

    it('aggregates errors across views', () => {
      const registry = registryWith({
        views: {
          'view-a': {
            contentType: 'api::missing.missing',
            path: '/a/:key',
            lookup: { field: 'slug' },
            planner: { fields: ['title'] },
          },
          'view-b': {
            contentType: 'api::page.page',
            path: '/b/:key',
            lookup: { field: 'ghost' },
            planner: { fields: ['title'] },
          },
        },
      });
      let message = '';
      try {
        registry.getViews();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("view 'view-a'");
      expect(message).toContain("view 'view-b'");
    });
  });
});
