import { describe, it, expect } from 'vitest';

import { get } from './helpers/api';

describe('GET /api/bff-views/status', () => {
  it('lists the configured views', async () => {
    const { status, body } = await get('/api/bff-views/status');

    expect(status).toBe(200);
    expect(body.plugin).toBe('bff-views');
    expect(body.views).toEqual(expect.arrayContaining(['page-view', 'product-view']));
  });
});

describe('GET /api/bff-views/page-view/:key (core document)', () => {
  it('serves the published page with scalar fields and view meta', async () => {
    const { status, body } = await get('/api/bff-views/page-view/home');

    expect(status).toBe(200);
    expect(body.meta.view).toBe('page-view');
    expect(body.data.title).toBe('Home');
    expect(body.data.slug).toBe('home');
    expect(body.data.documentId).toEqual(expect.any(String));
  });

  it('populates configured component fields in the core query', async () => {
    const { body } = await get('/api/bff-views/page-view/home');

    expect(body.data.seo).toMatchObject({ metaTitle: 'Home | Test' });
  });

  it('returns dynamic zone entries with component identity, preserving order', async () => {
    const { body } = await get('/api/bff-views/page-view/home');

    const components = body.data.modules.map((entry: { __component: string }) => entry.__component);
    expect(components).toEqual([
      'modules.hero-section',
      'modules.content-block',
      'modules.faq-section',
      'modules.content-block',
    ]);
  });

  it('returns the 404 envelope for an unknown slug', async () => {
    const { status, body } = await get('/api/bff-views/page-view/ghost');

    expect(status).toBe(404);
    expect(body).toEqual({
      data: null,
      error: {
        status: 404,
        name: 'NotFoundError',
        message: "No document for slug='ghost'",
      },
    });
  });

  it('hides draft documents unless publicationState=preview is set', async () => {
    const withoutPreview = await get('/api/bff-views/page-view/draft-only');
    expect(withoutPreview.status).toBe(404);

    const withPreview = await get('/api/bff-views/page-view/draft-only?publicationState=preview');
    expect(withPreview.status).toBe(200);
    expect(withPreview.body.data.title).toBe('Draft Only');
  });

  it('rejects preview with 403 on views that do not opt in via allowPreview', async () => {
    const { status, body } = await get(
      '/api/bff-views/product-view/WIDGET-1?publicationState=preview',
    );

    expect(status).toBe(403);
    expect(body.error.name).toBe('ForbiddenError');
    expect(body.error.message).toContain('allowPreview');
  });
});
