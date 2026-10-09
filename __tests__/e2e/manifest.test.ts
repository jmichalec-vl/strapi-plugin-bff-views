import { describe, it, expect } from 'vitest';

import { get } from './helpers/api';

describe('GET /api/bff-views/manifest', () => {
  it('returns the versioned view manifest', async () => {
    const { status, body } = await get('/api/bff-views/manifest');

    expect(status).toBe(200);
    expect(body.manifestVersion).toBe(1);
    expect(body.views.map((view: { id: string }) => view.id)).toEqual([
      'site-header',
      'announcement-view',
      'chrome',
      'page-view',
      'product-view',
    ]);

    const chrome = body.views.find((view: { id: string }) => view.id === 'chrome');
    expect(chrome.kind).toBe('composite');
    expect(Object.keys(chrome.sources)).toEqual(['header', 'footer', 'categories']);
    expect(chrome.sources.categories.many).toBe(true);
    expect(chrome.contentType).toBeUndefined();

    const siteHeader = body.views.find((view: { id: string }) => view.id === 'site-header');
    expect(siteHeader.kind).toBe('singleton');
    expect(siteHeader.contentType).toBe('api::header.header');
    expect('keyParam' in siteHeader).toBe(false);
  });

  it('describes fields, zones, relations, transforms, and hook flags', async () => {
    const { body } = await get('/api/bff-views/manifest');

    const pageView = body.views.find((view: { id: string }) => view.id === 'page-view');
    expect(pageView).toMatchObject({
      contentType: 'api::page.page',
      keyParam: 'key',
      lookup: { field: 'slug' },
      componentFields: { seo: 'shared.seo' },
      hasAssemble: false,
    });
    expect(pageView.dynamicZones.modules).toContain('modules.hero-section');
    expect(pageView.transforms).toEqual([
      { name: 'uppercase-richtext', match: { fieldType: 'richtext' } },
      { name: 'shout-question', match: { fieldName: '^question$' } },
    ]);

    const productView = body.views.find((view: { id: string }) => view.id === 'product-view');
    expect(productView.hasAssemble).toBe(true);
    expect(productView.relations.variants).toEqual({
      fields: ['variantName', 'sku', 'price'],
    });
  });
});
