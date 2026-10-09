import { describe, it, expect } from 'vitest';

import { get } from './helpers/api';

describe('singleton views', () => {
  it('serves the single type without a key', async () => {
    const { status, body } = await get('/api/bff-views/site-header');

    expect(status).toBe(200);
    expect(body.meta.view).toBe('site-header');
    expect(body.data.documentId).toEqual(expect.any(String));
    const links = body.data.links as { text: string; url: string }[];
    expect(links.map((link) => link.text)).toEqual(['Shop', 'About']);
  });

  it('returns the 404 envelope when the single type has no document', async () => {
    const { status, body } = await get('/api/bff-views/announcement-view');

    expect(status).toBe(404);
    expect(body.error.name).toBe('NotFoundError');
    expect(body.error.message).toContain('api::announcement.announcement');
  });

  it('rejects preview without allowPreview, same as keyed views', async () => {
    const { status } = await get('/api/bff-views/site-header?publicationState=preview');

    expect(status).toBe(403);
  });
});

describe('composite views', () => {
  it('composes named sources into one response', async () => {
    const { status, body } = await get('/api/bff-views/chrome');

    expect(status).toBe(200);
    expect(body.meta.view).toBe('chrome');

    expect(body.data.header.links).toHaveLength(2);
    expect(body.data.footer.title).toBe('Footer title');
    expect(body.data.footer.showEmailSignUp).toBe(true);

    const categories = body.data.categories as { name: string }[];
    expect(categories.map((c) => c.name)).toContain('Skincare');
  });

  it('applies nested component overrides inside many-source generated populate', async () => {
    const { body } = await get('/api/bff-views/chrome');

    const categories = body.data.categories as {
      name: string;
      promo?: { buttons?: { text: string; linkedPage?: { slug: string } | null }[] };
    }[];
    const skincare = categories.find((category) => category.name === 'Skincare');

    // linkedPage lives on modules.button NESTED inside the promo hero-section -
    // it is only served because the override applies below the top level.
    expect(skincare?.promo?.buttons?.[0]).toMatchObject({
      text: 'Shop now',
      linkedPage: { slug: 'home' },
    });
  });

  it('applies transformers per source with each source schema', async () => {
    const { body } = await get('/api/bff-views/chrome');

    // footer.subtitle is richtext -> uppercased by the view transformer
    expect(body.data.footer.subtitle).toBe('FOOTER SUBTITLE MARKDOWN');
    expect(body.data.footer.copyrightNotice).toBe('COPYRIGHT NOTICE');
  });

  it('lists per-source sub-queries in explain, including the many source', async () => {
    const { body } = await get('/api/bff-views/chrome?_explain=true');

    const planIds = (body.meta.explain.plan as { id: string }[]).map((entry) => entry.id);
    expect(planIds).toContain('categories:source:findMany');
    if (body.meta.explain.cache === 'miss') {
      expect(body.meta.explain.timings.length).toBeGreaterThan(0);
    }
  });

  it('serves repeat requests from cache (keyless cache key)', async () => {
    await get('/api/bff-views/chrome?_explain=true');
    const second = await get('/api/bff-views/chrome?_explain=true');

    expect(second.body.meta.explain.cache).toBe('hit');
  });
});
