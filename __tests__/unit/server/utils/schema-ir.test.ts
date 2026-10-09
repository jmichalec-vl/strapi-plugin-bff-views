import { describe, it, expect } from 'vitest';

import { buildComponentRegistry, readContentTypeIR } from '../../../../server/src/utils/schema-ir';
import {
  createTestComponents,
  createTestContentTypes,
} from '../../../helpers/fixtures/test-schemas';

describe('readContentTypeIR', () => {
  it('maps a raw schema into the IR with a synthetic required documentId first', () => {
    const ir = readContentTypeIR(createTestContentTypes(), 'api::page.page')!;

    expect(ir).toMatchObject({
      uid: 'api::page.page',
      singularName: 'page',
      pluralName: 'pages',
      displayName: 'Page',
      kind: 'collectionType',
    });
    expect(ir.attributes[0]).toEqual({ name: 'documentId', type: 'string', required: true });
  });

  it('drops bookkeeping fields and password attributes', () => {
    const names = readContentTypeIR(createTestContentTypes(), 'api::page.page')!.attributes.map(
      (attribute) => attribute.name,
    );

    expect(names).not.toContain('id');
    expect(names).not.toContain('password');
    expect(names.filter((name) => name === 'documentId')).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(['title', 'slug', 'seo', 'modules', 'author']));
  });

  it('carries component, dynamic-zone, relation and media details', () => {
    const attributes = readContentTypeIR(
      createTestContentTypes(),
      'api::product.product',
    )!.attributes;
    const byName = Object.fromEntries(attributes.map((attribute) => [attribute.name, attribute]));

    expect(byName.modules).toMatchObject({
      type: 'dynamiczone',
      componentUIDs: ['content.hero', 'content.faq'],
    });
    expect(byName.cover).toMatchObject({ type: 'media', mediaMultiple: false });
    expect(byName.variants).toMatchObject({
      type: 'relation',
      relationKind: 'oneToMany',
      relationTarget: 'api::variant.variant',
    });
  });

  it('returns undefined for unknown content types', () => {
    expect(readContentTypeIR(createTestContentTypes(), 'api::nope.nope')).toBeUndefined();
  });
});

describe('buildComponentRegistry', () => {
  it('indexes components by uid with category and attributes, without a synthetic documentId', () => {
    const registry = buildComponentRegistry(createTestComponents());

    expect(registry['content.hero']).toMatchObject({
      uid: 'content.hero',
      category: 'content',
      displayName: 'Hero',
    });
    expect(registry['content.hero']?.attributes.map((attribute) => attribute.name)).toEqual([
      'title',
      'image',
      'buttons',
    ]);
    expect(registry['content.hero']?.attributes[2]).toMatchObject({
      type: 'component',
      componentUID: 'content.button',
      repeatable: true,
    });
  });
});
