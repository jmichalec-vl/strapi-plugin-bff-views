import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Core } from '@strapi/types';

import transformer from '../../../../server/src/services/transformer';
import type { ComponentRegistry, ContentTypeIR } from '../../../../server/src/types';
import { createMockStrapi } from '../../../helpers/mock-strapi';

const contentTypeIR: ContentTypeIR = {
  uid: 'api::page.page',
  singularName: 'page',
  pluralName: 'pages',
  displayName: 'Page',
  kind: 'collectionType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
    { name: 'body', type: 'richtext', required: false },
    { name: 'seo', type: 'component', required: false, componentUID: 'shared.seo' },
    {
      name: 'modules',
      type: 'dynamiczone',
      required: false,
      componentUIDs: ['content.hero', 'content.faq'],
    },
    { name: 'author', type: 'relation', required: false, relationTarget: 'api::author.author' },
  ],
};

const registry: ComponentRegistry = {
  'shared.seo': {
    uid: 'shared.seo',
    category: 'shared',
    displayName: 'SEO',
    attributes: [{ name: 'metaTitle', type: 'string', required: true }],
  },
  'content.hero': {
    uid: 'content.hero',
    category: 'content',
    displayName: 'Hero',
    attributes: [{ name: 'heading', type: 'richtext', required: true }],
  },
  'content.faq': {
    uid: 'content.faq',
    category: 'content',
    displayName: 'FAQ',
    attributes: [
      { name: 'title', type: 'string', required: false },
      { name: 'items', type: 'component', required: false, componentUID: 'content.faq-item' },
    ],
  },
  'content.faq-item': {
    uid: 'content.faq-item',
    category: 'content',
    displayName: 'FAQ Item',
    attributes: [
      { name: 'question', type: 'string', required: true },
      { name: 'answer', type: 'richtext', required: true },
    ],
  },
};

const CONTENT_TYPE_UID = 'api::page.page';

const document = () => ({
  documentId: 'd1',
  title: 'Home',
  body: 'raw body',
  seo: { metaTitle: 'Home | Test' },
  modules: [
    { __component: 'content.hero', id: 1, heading: 'hero heading' },
    {
      __component: 'content.faq',
      id: 2,
      title: 'FAQ',
      items: [
        { question: 'first', answer: 'first answer' },
        { question: 'second', answer: 'second answer' },
      ],
    },
  ],
  author: { name: 'ann', bio: 'should not be touched' },
});

describe('transformer', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let apply: ReturnType<typeof transformer>['apply'];

  const configure = (transformers: Record<string, unknown>) => {
    mock.setPluginConfig('bff-views', { transformers });
    mock.registerService('bff-views', 'ir-bridge', {
      getContentTypeIR: vi.fn(() => contentTypeIR),
      getComponentRegistry: vi.fn(() => registry),
    });
    apply = transformer({ strapi: mock.strapi as unknown as Core.Strapi }).apply;
  };

  beforeEach(() => {
    mock = createMockStrapi();
  });

  it('transforms matching fields everywhere in the tree, including nested DZ components', async () => {
    configure({
      'uppercase-richtext': {
        match: { fieldType: 'richtext' },
        transform: (value: unknown) => String(value).toUpperCase(),
      },
    });

    const result = (await apply(document(), CONTENT_TYPE_UID, [
      'uppercase-richtext',
    ])) as ReturnType<typeof document>;

    expect(result.body).toBe('RAW BODY');
    expect(result.modules[0]).toMatchObject({ heading: 'HERO HEADING' });
    expect(
      (result.modules[1] as { items: { answer: string }[] }).items.map((i) => i.answer),
    ).toEqual(['FIRST ANSWER', 'SECOND ANSWER']);
  });

  it('matches by field-name pattern and leaves other fields alone', async () => {
    configure({
      'shout-question': {
        match: { fieldName: '^question$' },
        transform: (value: unknown) => `${String(value)}!!`,
      },
    });

    const result = (await apply(document(), CONTENT_TYPE_UID, ['shout-question'])) as ReturnType<
      typeof document
    >;

    const faq = result.modules[1] as { items: { question: string; answer: string }[] };
    expect(faq.items.map((i) => i.question)).toEqual(['first!!', 'second!!']);
    expect(faq.items[0]?.answer).toBe('first answer');
    expect(result.title).toBe('Home');
  });

  it('does not descend into relations', async () => {
    const transform = vi.fn((value: unknown) => value);
    configure({ touch: { match: { fieldName: 'bio' }, transform } });

    await apply(document(), CONTENT_TYPE_UID, ['touch']);

    expect(transform).not.toHaveBeenCalled();
  });

  it('applies transformers sequentially so later ones see earlier output', async () => {
    configure({
      upper: {
        match: { fieldType: 'richtext' },
        transform: (value: unknown) => String(value).toUpperCase(),
      },
      exclaim: {
        match: { fieldName: '^body$' },
        transform: (value: unknown) => `${String(value)}!`,
      },
    });

    const result = (await apply(document(), CONTENT_TYPE_UID, ['upper', 'exclaim'])) as ReturnType<
      typeof document
    >;

    expect(result.body).toBe('RAW BODY!');
  });

  it('supports async transforms', async () => {
    configure({
      asyncUpper: {
        match: { fieldType: 'richtext' },
        transform: async (value: unknown) => String(value).toUpperCase(),
      },
    });

    const result = (await apply(document(), CONTENT_TYPE_UID, ['asyncUpper'])) as ReturnType<
      typeof document
    >;

    expect(result.body).toBe('RAW BODY');
    expect(result.modules[0]).toMatchObject({ heading: 'HERO HEADING' });
  });

  it('transforms every element of an array tree from a many source', async () => {
    configure({
      'uppercase-richtext': {
        match: { fieldType: 'richtext' },
        transform: (value: unknown) => String(value).toUpperCase(),
      },
    });

    const result = (await apply(
      [document(), { ...document(), documentId: 'd2', body: 'second body' }],
      CONTENT_TYPE_UID,
      ['uppercase-richtext'],
    )) as ReturnType<typeof document>[];

    expect(result).toHaveLength(2);
    expect(result[0]?.body).toBe('RAW BODY');
    expect(result[1]?.body).toBe('SECOND BODY');
    expect(result[1]?.modules[0]).toMatchObject({ heading: 'HERO HEADING' });
  });

  it('returns the tree untouched when the view declares no transforms', async () => {
    configure({});
    const input = document();

    const result = await apply(input, CONTENT_TYPE_UID, []);

    expect(result).toBe(input);
  });

  it('never mutates the input tree', async () => {
    configure({
      upper: {
        match: { fieldType: 'richtext' },
        transform: (value: unknown) => String(value).toUpperCase(),
      },
    });
    const input = document();

    await apply(input, CONTENT_TYPE_UID, ['upper']);

    expect(input.body).toBe('raw body');
    expect(input.modules[0]).toMatchObject({ heading: 'hero heading' });
  });
});
