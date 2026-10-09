import type { Core, UID } from '@strapi/types';

import type { DocumentStatus, QueryPlan, ResolvedSource, SubResult } from '../types';
import { DEFAULT_CONCURRENCY } from '../constants';
import { getService, mapWithConcurrency, timed } from '../utils';

export interface ExecutionTarget {
  readonly documentId: string;
  readonly status: DocumentStatus;
  readonly locale: string | undefined;
}

/**
 * Runs all planned sub-queries against the resolved document in parallel under
 * the view's concurrency cap (and the process-wide query gate), timing each. A
 * failed sub-query rejects the whole execution: partial pages must never be
 * served or cached silently.
 */
const executor = ({ strapi }: { strapi: Core.Strapi }) => {
  const execute = async (
    plan: QueryPlan,
    view: ResolvedSource,
    target: ExecutionTarget,
  ): Promise<readonly SubResult[]> => {
    const documents = strapi.documents(view.contentType as UID.ContentType);
    const concurrency = view.planner.concurrency ?? DEFAULT_CONCURRENCY;
    const gate = getService(strapi, 'query-gate');

    return mapWithConcurrency(plan.subQueries, concurrency, async (subQuery) => {
      const query = {
        ...subQuery.params,
        filters: { documentId: { $eq: target.documentId } },
        status: target.status,
        ...(target.locale !== undefined && { locale: target.locale }),
      };

      const { result, ms } = await timed(() =>
        gate.run(() => documents.findFirst(query as Parameters<typeof documents.findFirst>[0])),
      );

      return {
        subQuery,
        document: (result as Record<string, unknown> | null) ?? null,
        ms,
      };
    });
  };

  return { execute };
};

export default executor;
