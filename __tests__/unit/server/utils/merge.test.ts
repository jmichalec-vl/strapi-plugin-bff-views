import { describe, it, expect } from 'vitest';

import { mergeSubResults } from '../../../../server/src/utils/merge';
import type { ResolvedSource, SubResult } from '../../../../server/src/types';

const source = {
  name: null,
  contentType: 'api::page.page',
  many: false,
  coreFields: ['title', 'documentId'],
  planner: { fields: ['title'], dynamicZones: ['modules'] },
  dzComponents: { modules: ['content.hero', 'content.faq'] },
  componentFieldUids: {},
  mediaFieldMultiples: {},
} as unknown as ResolvedSource;

const dzResult = (zone: string, componentUid: string, entries: readonly unknown[]): SubResult => ({
  subQuery: {
    id: `dz:${zone}:${componentUid}`,
    kind: 'dz-component',
    uid: 'api::page.page',
    zone,
    componentUid,
    params: {},
  },
  document: { documentId: 'd1', [zone]: entries },
  ms: 1,
});

const relationResult = (
  fields: readonly string[],
  document: Record<string, unknown>,
): SubResult => ({
  subQuery: {
    id: `relation:${fields.join(',')}`,
    kind: fields.length > 1 ? 'relation-group' : 'relation',
    uid: 'api::page.page',
    relationFields: fields,
    params: {},
  },
  document: { documentId: 'd1', ...document },
  ms: 1,
});

describe('mergeSubResults', () => {
  it('slots populated DZ entries back preserving core order, including repeated component types', () => {
    const core = {
      documentId: 'd1',
      title: 'Home',
      modules: [
        { __component: 'content.hero', id: 1 },
        { __component: 'content.faq', id: 5 },
        { __component: 'content.hero', id: 2 },
      ],
    };

    const merged = mergeSubResults(core, source, [
      dzResult('modules', 'content.hero', [
        { __component: 'content.hero', id: 1, title: 'First hero' },
        { __component: 'content.hero', id: 2, title: 'Second hero' },
      ]),
      dzResult('modules', 'content.faq', [
        { __component: 'content.faq', id: 5, items: [{ question: 'Q' }] },
      ]),
    ]);

    expect(merged.modules).toEqual([
      { __component: 'content.hero', id: 1, title: 'First hero' },
      { __component: 'content.faq', id: 5, items: [{ question: 'Q' }] },
      { __component: 'content.hero', id: 2, title: 'Second hero' },
    ]);
  });

  it('keeps the minimal core entry when a populated counterpart is missing', () => {
    const core = {
      documentId: 'd1',
      modules: [
        { __component: 'content.hero', id: 1 },
        { __component: 'content.faq', id: 2 },
      ],
    };

    const merged = mergeSubResults(core, source, [
      dzResult('modules', 'content.hero', [{ __component: 'content.hero', id: 1, title: 'Hero' }]),
    ]);

    expect(merged.modules).toEqual([
      { __component: 'content.hero', id: 1, title: 'Hero' },
      { __component: 'content.faq', id: 2 },
    ]);
  });

  it('does not mix entries across zones', () => {
    const multiZoneSource = {
      ...source,
      planner: { fields: ['title'], dynamicZones: ['modules', 'extras'] },
    } as unknown as ResolvedSource;
    const core = {
      documentId: 'd1',
      modules: [{ __component: 'content.faq', id: 1 }],
      extras: [{ __component: 'content.faq', id: 1 }],
    };

    const merged = mergeSubResults(core, multiZoneSource, [
      dzResult('extras', 'content.faq', [
        { __component: 'content.faq', id: 1, title: 'Extras FAQ' },
      ]),
    ]);

    expect(merged.modules).toEqual([{ __component: 'content.faq', id: 1 }]);
    expect(merged.extras).toEqual([{ __component: 'content.faq', id: 1, title: 'Extras FAQ' }]);
  });

  it('attaches relation sub-results to their fields', () => {
    const core = { documentId: 'd1', title: 'Home' };

    const merged = mergeSubResults(core, source, [
      relationResult(['author', 'tags'], {
        author: { name: 'Ann' },
        tags: [{ label: 'news' }],
      }),
      relationResult(['category'], { category: null }),
    ]);

    expect(merged.author).toEqual({ name: 'Ann' });
    expect(merged.tags).toEqual([{ label: 'news' }]);
    expect(merged.category).toBeNull();
  });

  it('leaves the core untouched when a relation sub-result is missing the field', () => {
    const core = { documentId: 'd1', title: 'Home' };

    const merged = mergeSubResults(core, source, [relationResult(['author'], {})]);

    expect('author' in merged).toBe(false);
    expect(merged.title).toBe('Home');
  });
});
