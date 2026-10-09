import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { get } from './helpers/api';
import { login, publish, updateDraft } from './helpers/admin';

const PAGE_UID = 'api::page.page';

const explainOf = async (path: string) => {
  const { status, body } = await get(`${path}?_explain=true`);
  expect(status).toBe(200);
  return body as {
    data: Record<string, unknown>;
    meta: {
      view: string;
      explain: { cache: string; plan: unknown[]; timings?: { id: string; ms: number }[] };
    };
  };
};

describe('explain telemetry', () => {
  it('exposes cache status, plan, and timings under meta.explain', async () => {
    const body = await explainOf('/api/bff-views/page-view/home');

    expect(['hit', 'miss']).toContain(body.meta.explain.cache);
    expect(body.meta.explain.plan.length).toBeGreaterThan(0);
    if (body.meta.explain.cache === 'miss') {
      expect(body.meta.explain.timings.length).toBe(body.meta.explain.plan.length);
      for (const timing of body.meta.explain.timings) {
        expect(timing.ms).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reports no timings on a cache hit', async () => {
    await explainOf('/api/bff-views/page-view/home');
    const hit = await explainOf('/api/bff-views/page-view/home');

    expect(hit.meta.explain.cache).toBe('hit');
    expect(hit.meta.explain.timings).toBeUndefined();
    expect(hit.meta.explain.plan.length).toBeGreaterThan(0);
  });

  it('omits explain when not requested', async () => {
    const { body } = await get('/api/bff-views/page-view/home');

    expect(body.meta.explain).toBeUndefined();
  });

  it('never reports explain for views without caching as hit/miss', async () => {
    const body = await explainOf('/api/bff-views/product-view/WIDGET-1');

    expect(body.meta.explain.cache).toBe('off');
  });
});

describe('cache lifecycle', () => {
  let documentId: string;

  beforeAll(async () => {
    await login();
    const { body } = await get('/api/bff-views/page-view/home');
    documentId = body.data.documentId as string;
  });

  afterAll(async () => {
    // Restore the seeded state so test-file order never matters.
    await updateDraft(PAGE_UID, documentId, { title: 'Home' });
    await publish(PAGE_UID, documentId);
  });

  it('serves repeat requests from cache', async () => {
    await explainOf('/api/bff-views/page-view/home');
    const second = await explainOf('/api/bff-views/page-view/home');

    expect(second.meta.explain.cache).toBe('hit');
  });

  it('flushes on draft updates and re-caches afterwards', async () => {
    await explainOf('/api/bff-views/page-view/home');
    await updateDraft(PAGE_UID, documentId, { title: 'Home v2' });

    const afterUpdate = await explainOf('/api/bff-views/page-view/home');
    expect(afterUpdate.meta.explain.cache).toBe('miss');
    // The published document is unchanged until publish.
    expect(afterUpdate.data.title).toBe('Home');

    const again = await explainOf('/api/bff-views/page-view/home');
    expect(again.meta.explain.cache).toBe('hit');
  });

  it('flushes on publish and serves the newly published content', async () => {
    await explainOf('/api/bff-views/page-view/home');
    await publish(PAGE_UID, documentId);

    const afterPublish = await explainOf('/api/bff-views/page-view/home');
    expect(afterPublish.meta.explain.cache).toBe('miss');
    expect(afterPublish.data.title).toBe('Home v2');
  });

  it('flushes a composite view when a relation target nested in a component changes', async () => {
    // chrome.categories serves modules.button.linkedPage (-> api::page.page)
    // through a nested component override; a page write must flush chrome.
    await get('/api/bff-views/chrome?_explain=true');
    const warm = await get('/api/bff-views/chrome?_explain=true');
    expect(warm.body.meta.explain.cache).toBe('hit');

    await updateDraft(PAGE_UID, documentId, { title: 'Home v2' });

    const afterPageWrite = await get('/api/bff-views/chrome?_explain=true');
    expect(afterPageWrite.body.meta.explain.cache).toBe('miss');
  });

  it('never caches preview (draft) renders', async () => {
    const { body: first } = await get(
      '/api/bff-views/page-view/draft-only?publicationState=preview&_explain=true',
    );
    const { body: second } = await get(
      '/api/bff-views/page-view/draft-only?publicationState=preview&_explain=true',
    );

    expect(first.meta.explain.cache).toBe('off');
    expect(second.meta.explain.cache).toBe('off');
  });
});
