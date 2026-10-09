import { describe, it, expect, beforeEach } from 'vitest';
import type { Core } from '@strapi/types';

import executor from '../../../../server/src/services/executor';
import queryGate from '../../../../server/src/services/query-gate';
import type { QueryPlan, ResolvedSource, SubQuery } from '../../../../server/src/types';
import { createMockStrapi } from '../../../helpers/mock-strapi';

const source = (concurrency?: number): ResolvedSource =>
  ({
    name: null,
    contentType: 'api::page.page',
    many: false,
    planner: { fields: ['title'], concurrency },
  }) as unknown as ResolvedSource;

const subQuery = (id: string): SubQuery => ({
  id,
  kind: 'dz-component',
  uid: 'api::page.page',
  zone: 'modules',
  componentUid: 'content.hero',
  params: { fields: ['documentId'], populate: { modules: {} } },
});

const target = { documentId: 'd1', status: 'published' as const, locale: undefined };

describe('executor', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let execute: ReturnType<typeof executor>['execute'];

  const build = (config: unknown = {}) => {
    mock = createMockStrapi();
    mock.setPluginConfig('bff-views', config);
    const strapi = mock.strapi as unknown as Core.Strapi;
    mock.registerService('bff-views', 'query-gate', queryGate({ strapi }));
    execute = executor({ strapi }).execute;
  };

  beforeEach(() => build());

  it('runs each sub-query against the resolved document with status and locale', async () => {
    mock.findFirst.mockResolvedValue({ documentId: 'd1' });
    const plan: QueryPlan = { subQueries: [subQuery('a')] };

    await execute(plan, source(), { ...target, locale: 'fr' });

    expect(mock.findFirst).toHaveBeenCalledWith({
      fields: ['documentId'],
      populate: { modules: {} },
      filters: { documentId: { $eq: 'd1' } },
      status: 'published',
      locale: 'fr',
    });
  });

  it('returns results in plan order with timings', async () => {
    mock.findFirst
      .mockResolvedValueOnce({ documentId: 'd1', first: true })
      .mockResolvedValueOnce({ documentId: 'd1', second: true });
    const plan: QueryPlan = { subQueries: [subQuery('a'), subQuery('b')] };

    const results = await execute(plan, source(), target);

    expect(results.map((r) => r.subQuery.id)).toEqual(['a', 'b']);
    expect(results[0]?.document).toEqual({ documentId: 'd1', first: true });
    expect(results.every((r) => r.ms >= 0)).toBe(true);
  });

  it('caps in-flight queries at the configured concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mock.findFirst.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { documentId: 'd1' };
    });
    const plan: QueryPlan = {
      subQueries: ['a', 'b', 'c', 'd', 'e', 'f'].map(subQuery),
    };

    await execute(plan, source(2), target);

    expect(maxInFlight).toBe(2);
  });

  it('caps in-flight queries across concurrent executions at maxInFlightQueries', async () => {
    build({ maxInFlightQueries: 1 });
    let inFlight = 0;
    let maxInFlight = 0;
    mock.findFirst.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { documentId: 'd1' };
    });
    const plan: QueryPlan = { subQueries: ['a', 'b', 'c'].map(subQuery) };

    await Promise.all([execute(plan, source(4), target), execute(plan, source(4), target)]);

    expect(mock.findFirst).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBe(1);
  });

  it('rejects the whole execution when any sub-query fails', async () => {
    mock.findFirst
      .mockResolvedValueOnce({ documentId: 'd1' })
      .mockRejectedValueOnce(new Error('db down'));
    const plan: QueryPlan = { subQueries: [subQuery('a'), subQuery('b')] };

    await expect(execute(plan, source(), target)).rejects.toThrow('db down');
  });

  it('normalizes missing documents to null', async () => {
    mock.findFirst.mockResolvedValue(undefined);
    const plan: QueryPlan = { subQueries: [subQuery('a')] };

    const results = await execute(plan, source(), target);

    expect(results[0]?.document).toBeNull();
  });
});
