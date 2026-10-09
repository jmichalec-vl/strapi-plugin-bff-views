import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Core } from '@strapi/types';

import planner from '../../../../server/src/services/planner';
import viewRegistry from '../../../../server/src/services/view-registry';
import type { ResolvedSource, SubQuery } from '../../../../server/src/types';
import { createMockStrapi } from '../../../helpers/mock-strapi';
import {
  createTestContentTypes,
  createTestComponents,
  createValidViewsConfig,
} from '../../../helpers/fixtures/test-schemas';

const GENERATED_POPULATE = { populate: { image: true } };

describe('planner', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let plan: ReturnType<typeof planner>['plan'];
  let getSource: (id: string) => ResolvedSource;
  // Mirrors the real builder's contract: a direct override replaces the tree.
  const buildComponentPopulate = vi.fn(
    (uid: string, _media?: unknown, overrides?: Record<string, unknown>) =>
      overrides?.[uid] ?? GENERATED_POPULATE,
  );

  const setup = (config: unknown) => {
    mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
    mock.setPluginConfig('bff-views', config);

    const strapi = mock.strapi as unknown as Core.Strapi;
    const registry = viewRegistry({ strapi });
    mock.registerService('bff-views', 'view-registry', registry);
    mock.registerService('bff-views', 'ir-bridge', { buildComponentPopulate });

    plan = planner({ strapi }).plan;
    getSource = (id: string) => registry.getView(id)!.sources[0] as ResolvedSource;
  };

  beforeEach(() => setup(createValidViewsConfig()));

  describe('dynamic zone sub-queries', () => {
    it('plans one query per unique component type present in the zone', () => {
      const core = {
        documentId: 'd1',
        modules: [
          { __component: 'content.hero', id: 1 },
          { __component: 'content.faq', id: 2 },
          { __component: 'content.hero', id: 3 },
        ],
      };

      const result = plan(getSource('page-view'), core);
      const dzQueries = result.subQueries.filter((q) => q.kind === 'dz-component');

      expect(dzQueries.map((q) => q.componentUid)).toEqual(['content.hero', 'content.faq']);
      expect(dzQueries[0]?.params).toEqual({
        fields: ['documentId'],
        populate: { modules: { on: { 'content.hero': GENERATED_POPULATE } } },
      });
    });

    it('plans nothing for component types absent from the core result', () => {
      const core = { documentId: 'd1', modules: [{ __component: 'content.faq', id: 1 }] };

      const result = plan(getSource('page-view'), core);
      const dzQueries = result.subQueries.filter((q) => q.kind === 'dz-component');

      expect(dzQueries).toHaveLength(1);
      expect(dzQueries[0]?.componentUid).toBe('content.faq');
    });

    it('plans zones independently across multiple dynamic zones', () => {
      const core = {
        documentId: 'd1',
        modules: [{ __component: 'content.hero', id: 1 }],
        extras: [{ __component: 'content.faq', id: 2 }],
      };

      const result = plan(getSource('product-view'), core);
      const dzQueries = result.subQueries.filter((q) => q.kind === 'dz-component');

      expect(dzQueries.map((q) => q.id)).toEqual([
        'dz:modules:content.hero',
        'dz:extras:content.faq',
      ]);
    });

    it('applies planner.components overrides instead of the generated populate', () => {
      const config = createValidViewsConfig() as unknown as {
        views: Record<string, { planner: Record<string, unknown> }>;
      };
      config.views['page-view'].planner = {
        ...config.views['page-view'].planner,
        components: { 'content.hero': { fields: ['title'] } },
      };
      setup(config);

      const core = { documentId: 'd1', modules: [{ __component: 'content.hero', id: 1 }] };
      const result = plan(getSource('page-view'), core);

      expect(result.subQueries[0]?.params.populate).toEqual({
        modules: { on: { 'content.hero': { fields: ['title'] } } },
      });
    });
  });

  describe('relation sub-queries', () => {
    it('groups flat overlays into one query and isolates nested-populate overlays', () => {
      const core = { documentId: 'd1' };

      const result = plan(getSource('product-view'), core);
      const group = result.subQueries.find((q) => q.kind === 'relation-group');
      const dedicated = result.subQueries.filter((q) => q.kind === 'relation');

      expect(group?.relationFields).toEqual(['variants']);
      expect(group?.params.populate).toEqual({ variants: { fields: ['sku', 'price'] } });
      expect(dedicated).toHaveLength(1);
      expect(dedicated[0]?.relationFields).toEqual(['category']);
      expect(dedicated[0]?.params.populate).toEqual({
        category: { fields: ['title', 'slug'], populate: {} },
      });
    });

    it('treats `true` overlays as flat', () => {
      const core = { documentId: 'd1' };

      const result = plan(getSource('page-view'), core);
      const group = result.subQueries.find((q) => q.kind === 'relation-group');

      expect(group?.params.populate).toEqual({ author: true });
    });
  });

  describe('never-whole-tree invariant', () => {
    const assertInvariant = (subQuery: SubQuery): void => {
      const populate = subQuery.params.populate as Record<string, unknown>;
      if (subQuery.kind === 'dz-component') {
        // Exactly one zone, exactly one component fragment.
        expect(Object.keys(populate)).toHaveLength(1);
        const zone = populate[subQuery.zone as string] as { on: Record<string, unknown> };
        expect(Object.keys(zone.on)).toHaveLength(1);
      } else {
        // Relation queries only populate their declared relation fields.
        expect(Object.keys(populate)).toEqual(subQuery.relationFields);
      }
      // Sub-queries never re-select document fields beyond the join key.
      expect(subQuery.params.fields).toEqual(['documentId']);
    };

    it('holds for every sub-query of a DZ-heavy plan', () => {
      const core = {
        documentId: 'd1',
        modules: [
          { __component: 'content.hero', id: 1 },
          { __component: 'content.faq', id: 2 },
        ],
        extras: [{ __component: 'content.faq', id: 3 }],
      };

      for (const view of ['page-view', 'product-view'] as const) {
        const result = plan(getSource(view), core);
        expect(result.subQueries.length).toBeGreaterThan(0);
        result.subQueries.forEach(assertInvariant);
      }
    });
  });
});
