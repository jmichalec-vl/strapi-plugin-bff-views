import { describe, it, expect } from 'vitest';

import { get, getAnonymous, readScopedToken } from './helpers/api';

describe('view route auth', () => {
  it('rejects unauthenticated requests', async () => {
    const { status } = await getAnonymous('/api/bff-views/page-view/home');

    expect(status).toBeGreaterThanOrEqual(401);
    expect(status).toBeLessThanOrEqual(403);
  });

  it('serves a view granted to a scoped custom token', async () => {
    const { status, body } = await get('/api/bff-views/page-view/home', readScopedToken());

    expect(status).toBe(200);
    expect(body.data.title).toBe('Home');
  });

  it('rejects a view not granted to the scoped token', async () => {
    const { status } = await get('/api/bff-views/product-view/WIDGET-1', readScopedToken());

    expect(status).toBe(403);
  });
});
