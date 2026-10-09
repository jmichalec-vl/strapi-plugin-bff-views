import { describe, it, expect } from 'vitest';

import { buildComponentRegistry, readContentTypeIR } from '../../../../server/src/utils/schema-ir';
import {
  buildComponentPopulateTree,
  buildPopulateFromAttributes,
} from '../../../../server/src/utils/populate-tree';
import {
  createTestContentTypes,
  createTestComponents,
} from '../../../helpers/fixtures/test-schemas';

const registry = () => buildComponentRegistry(createTestComponents());

describe('schema-ir', () => {
  it('maps a content type with a synthetic required documentId first', () => {
    const ir = readContentTypeIR(createTestContentTypes(), 'api::page.page');

    expect(ir?.uid).toBe('api::page.page');
    expect(ir?.kind).toBe('collectionType');
    expect(ir?.attributes[0]).toEqual({ name: 'documentId', type: 'string', required: true });
  });

  it('drops passwords, ids, and internal bookkeeping fields', () => {
    const ir = readContentTypeIR(
      {
        'api::thing.thing': {
          info: { singularName: 'thing', pluralName: 'things', displayName: 'Thing' },
          attributes: {
            id: { type: 'integer' },
            documentId: { type: 'string' },
            secret: { type: 'password' },
            createdAt: { type: 'datetime' },
            createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
            locale: { type: 'string' },
            title: { type: 'string', required: true },
          },
        },
      },
      'api::thing.thing',
    );

    expect(ir?.attributes.map((a) => a.name)).toEqual(['documentId', 'title']);
  });

  it('carries component, dynamic-zone, and relation metadata onto attributes', () => {
    const ir = readContentTypeIR(createTestContentTypes(), 'api::product.product');
    const byName = Object.fromEntries((ir?.attributes ?? []).map((a) => [a.name, a]));

    expect(byName.modules).toMatchObject({
      type: 'dynamiczone',
      componentUIDs: ['content.hero', 'content.faq'],
    });
    expect(byName.variants).toMatchObject({
      type: 'relation',
      relationKind: 'oneToMany',
      relationTarget: 'api::variant.variant',
    });
    expect(byName.cover).toMatchObject({ type: 'media', mediaMultiple: false });
  });

  it('returns undefined for unknown uids', () => {
    expect(readContentTypeIR(createTestContentTypes(), 'api::missing.missing')).toBeUndefined();
  });

  it('builds a registry keyed by component uid with category from the uid', () => {
    const components = registry();

    expect(components['content.hero']?.category).toBe('content');
    expect(components['content.hero']?.attributes.map((a) => a.name)).toEqual([
      'title',
      'image',
      'buttons',
    ]);
  });
});

describe('populate-tree', () => {
  it('builds fully inlined populate: media true, nested components, DZ on: fragments', () => {
    const ir = readContentTypeIR(createTestContentTypes(), 'api::page.page');

    const populate = buildPopulateFromAttributes(ir?.attributes ?? [], registry());

    expect(populate).toEqual({
      seo: { populate: { metaImage: true } },
      modules: {
        on: {
          'content.hero': { populate: { image: true, buttons: true } },
          'content.faq': { populate: { items: true } },
        },
      },
    });
  });

  it('excludes relations everywhere', () => {
    const ir = readContentTypeIR(createTestContentTypes(), 'api::product.product');

    const populate = buildPopulateFromAttributes(ir?.attributes ?? [], registry());

    expect(populate).not.toHaveProperty('variants');
    expect(populate).not.toHaveProperty('category');
    expect(populate).not.toHaveProperty('relatedProduct');
  });

  it('returns true for components without populatable fields or unknown uids', () => {
    expect(buildComponentPopulateTree('content.button', registry())).toBe(true);
    expect(buildComponentPopulateTree('ghost.ghost', registry())).toBe(true);
  });

  it('filters unknown component uids out of DZ fragments', () => {
    const populate = buildPopulateFromAttributes(
      [
        {
          name: 'zone',
          type: 'dynamiczone',
          required: false,
          componentUIDs: ['content.hero', 'ghost.ghost'],
        },
      ],
      registry(),
    );

    expect(populate).toEqual({
      zone: { on: { 'content.hero': { populate: { image: true, buttons: true } } } },
    });
  });

  it('narrows media to the configured fields at every depth with mediaPopulate', () => {
    const mediaPopulate = { fields: ['url', 'alternativeText', 'width', 'height'] };
    const ir = readContentTypeIR(createTestContentTypes(), 'api::page.page');

    const populate = buildPopulateFromAttributes(ir?.attributes ?? [], registry(), mediaPopulate);

    expect(populate).toEqual({
      seo: { populate: { metaImage: { fields: ['url', 'alternativeText', 'width', 'height'] } } },
      modules: {
        on: {
          'content.hero': {
            populate: {
              image: { fields: ['url', 'alternativeText', 'width', 'height'] },
              buttons: true,
            },
          },
          'content.faq': { populate: { items: true } },
        },
      },
    });
  });

  it('keeps full media populate without mediaPopulate', () => {
    const tree = buildComponentPopulateTree('shared.seo', registry());

    expect(tree).toEqual({ populate: { metaImage: true } });
  });

  it('replaces the tree with a direct override', () => {
    const override = { fields: ['title'] };

    expect(
      buildComponentPopulateTree('content.hero', registry(), undefined, undefined, {
        'content.hero': override,
      }),
    ).toBe(override);
  });

  it('applies overrides to components nested inside the generated tree', () => {
    const override = { populate: { linkedPage: true } };

    expect(
      buildComponentPopulateTree('content.hero', registry(), undefined, undefined, {
        'content.button': override,
      }),
    ).toEqual({ populate: { image: true, buttons: override } });
  });

  it('applies nested overrides inside DZ fragments of the generated tree', () => {
    const override = { fields: ['question'] };
    const ir = readContentTypeIR(createTestContentTypes(), 'api::page.page');

    const populate = buildPopulateFromAttributes(
      ir?.attributes ?? [],
      registry(),
      undefined,
      undefined,
      { 'content.faq-item': override },
    );

    expect(populate).toMatchObject({
      modules: { on: { 'content.faq': { populate: { items: override } } } },
    });
  });

  it('terminates on recursive components via the cycle guard', () => {
    const recursive = buildComponentRegistry({
      ...createTestComponents(),
      'recursive.node': {
        info: { displayName: 'Node' },
        attributes: {
          label: { type: 'string' },
          child: { type: 'component', component: 'recursive.node', repeatable: true },
        },
      },
    });

    expect(buildComponentPopulateTree('recursive.node', recursive)).toEqual({
      populate: { child: true },
    });
  });
});
