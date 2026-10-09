import { describe, it, expect } from 'vitest';

import { collectAttributeVisits, getAtPath, setAtPath } from '../../../../server/src/utils/walk';
import { buildComponentRegistry, readContentTypeIR } from '../../../../server/src/utils/schema-ir';
import {
  createTestComponents,
  createTestContentTypes,
} from '../../../helpers/fixtures/test-schemas';

const registry = buildComponentRegistry(createTestComponents());
const page = readContentTypeIR(createTestContentTypes(), 'api::page.page')!;

describe('collectAttributeVisits', () => {
  it('visits scalars, nested components, repeatable components and dynamic-zone entries', () => {
    const document = {
      documentId: 'd1',
      title: 'Home',
      seo: { metaTitle: 'Meta', metaImage: { url: '/x.png' } },
      modules: [
        {
          __component: 'content.hero',
          title: 'Hero',
          buttons: [{ label: 'Go', url: '/go' }],
        },
        { __component: 'content.faq', items: [{ question: 'Q?', answer: 'A.' }] },
      ],
    };

    const visits = collectAttributeVisits(document, page, registry);
    const byPath = Object.fromEntries(visits.map((v) => [v.path.join('.'), v.ctx]));

    expect(byPath['title']).toMatchObject({ containerUid: 'api::page.page' });
    expect(byPath['seo.metaTitle']).toMatchObject({ containerUid: 'shared.seo' });
    expect(byPath['seo.metaImage']?.attribute.type).toBe('media');
    expect(byPath['modules.0.title']).toMatchObject({ containerUid: 'content.hero' });
    expect(byPath['modules.0.buttons.0.label']).toMatchObject({ containerUid: 'content.button' });
    expect(byPath['modules.1.items.0.answer']?.attribute.type).toBe('richtext');
  });

  it('stops at relation boundaries and skips null or missing values', () => {
    const document = {
      documentId: 'd1',
      title: null,
      author: { name: 'Someone', documentId: 'a1' },
      modules: [
        {
          __component: 'content.hero',
          title: 'Hero',
          buttons: [{ label: 'Go', url: '/go', linkedPage: { title: 'Linked' } }],
        },
      ],
    };

    const paths = collectAttributeVisits(document, page, registry).map((v) => v.path.join('.'));

    expect(paths).not.toContain('title');
    expect(paths.some((p) => p.startsWith('author'))).toBe(false);
    expect(paths.some((p) => p.includes('linkedPage'))).toBe(false);
    expect(paths).toContain('modules.0.buttons.0.label');
  });

  it('ignores dynamic-zone entries of unknown components', () => {
    const document = { documentId: 'd1', modules: [{ __component: 'ghost.block', title: 'x' }] };

    const paths = collectAttributeVisits(document, page, registry).map((v) => v.path.join('.'));

    expect(paths).toEqual(['documentId']);
  });
});

describe('getAtPath / setAtPath', () => {
  it('reads and writes nested paths through objects and arrays', () => {
    const root: Record<string, unknown> = { a: [{ b: 1 }] };

    expect(getAtPath(root, ['a', 0, 'b'])).toBe(1);
    setAtPath(root, ['a', 0, 'b'], 2);
    expect(getAtPath(root, ['a', 0, 'b'])).toBe(2);
  });

  it('returns undefined for missing paths and ignores writes to them', () => {
    const root: Record<string, unknown> = { a: 1 };

    expect(getAtPath(root, ['x', 'y'])).toBeUndefined();
    setAtPath(root, ['x', 'y'], 5);
    expect(root).toEqual({ a: 1 });
  });
});
