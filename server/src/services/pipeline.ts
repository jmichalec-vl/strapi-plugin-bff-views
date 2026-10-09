import type { Core, UID } from '@strapi/types';

import type {
  BffViewsConfig,
  HookCtx,
  PipelineResult,
  QueryPlan,
  RequestParams,
  ResolvedSource,
  ResolvedView,
  SubQuery,
  SubQueryTiming,
  ViewRequestCtx,
} from '../types';
import { PLUGIN_ID } from '../constants';
import { getService, mergeSubResults, timed } from '../utils';

type CacheStatus = 'hit' | 'miss' | 'off';

type PopulateEntry = readonly [string, unknown];

interface RenderOutcome {
  readonly data: unknown;
  readonly plan: QueryPlan;
  readonly timings: readonly SubQueryTiming[];
}

interface SourceOutcome {
  readonly data: unknown;
  readonly subQueries: readonly SubQuery[];
  readonly timings: readonly SubQueryTiming[];
}

const notFound = (view: ResolvedView, params: RequestParams): PipelineResult => ({
  status: 404,
  body: {
    data: null,
    error: {
      status: 404,
      name: 'NotFoundError',
      message:
        view.kind === 'keyed'
          ? `No document for ${view.lookup?.field}='${params.key}'`
          : `No ${params.status} document for '${view.sources[0]?.contentType}'`,
    },
  },
});

const internalError = (message: string): PipelineResult => ({
  status: 500,
  body: {
    data: null,
    error: { status: 500, name: 'BffViewError', message },
  },
});

const previewForbidden = (view: ResolvedView): PipelineResult => ({
  status: 403,
  body: {
    data: null,
    error: {
      status: 403,
      name: 'ForbiddenError',
      message: `Preview is not enabled for view '${view.id}' (set allowPreview: true)`,
    },
  },
});

// Stable per-caller identity for the response cache: sanitization output
// depends on the authenticated token/user, so entries must never be shared
// across identities with potentially different field visibility.
export const authCacheKey = (auth: unknown): string => {
  if (typeof auth !== 'object' || auth === null) return 'anon';
  const { strategy, credentials } = auth as {
    readonly strategy?: string | { readonly name?: string };
    readonly credentials?: { readonly id?: unknown } | null;
  };
  const strategyName = typeof strategy === 'string' ? strategy : (strategy?.name ?? 'unknown');
  return `${strategyName}:${credentials?.id ?? 'none'}`;
};

const scopedToSource = (name: string | null, id: string): string => (name ? `${name}:${id}` : id);

/**
 * Orchestrates the per-request stages (spec section 5.2): resolve params ->
 * cache lookup -> per-source rendering (parallel) -> per-source sanitize +
 * transform -> compose -> enrich/assemble hooks -> cache store -> respond.
 * Keyed/singleton views have one unnamed source (data = the document);
 * composite views compose `{ [sourceName]: result }`. A failed sub-query fails
 * the whole request: partial pages are never served or cached.
 */
const pipeline = ({ strapi }: { strapi: Core.Strapi }) => {
  // Concurrent misses for the same cacheable response share one render
  // instead of each hitting the database (cache stampede protection).
  const inFlightRenders = new Map<string, Promise<RenderOutcome | null>>();

  const resolveParams = (view: ResolvedView, ctx: ViewRequestCtx): RequestParams => ({
    key: view.keyParam !== null ? (ctx.params[view.keyParam] ?? '') : '',
    // Public param name kept for FE compatibility; maps to Documents API status.
    status: ctx.query.publicationState === 'preview' ? 'draft' : 'published',
    locale: typeof ctx.query.locale === 'string' ? ctx.query.locale : undefined,
    explain: ctx.query._explain === 'true',
    auth: ctx.state.auth,
  });

  const explainAllowed = (): boolean => {
    const config = strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined;
    if (config?.explain !== undefined) return config.explain === 'on';
    return process.env.NODE_ENV !== 'production';
  };

  const componentEntries = (source: ResolvedSource): readonly PopulateEntry[] => {
    const irBridge = getService(strapi, 'ir-bridge');
    // planner.components overrides apply at any depth of the generated tree
    // (the builder consults them per component); this is what lets relations
    // nested inside a plain component field be populated.
    return Object.entries(source.componentFieldUids).map(([field, uid]) => [
      field,
      irBridge.buildComponentPopulate(uid, source.mediaPopulate, source.planner.components),
    ]);
  };

  // Root media is a single flat join, safe in the core query.
  const mediaEntries = (source: ResolvedSource): readonly PopulateEntry[] =>
    Object.keys(source.mediaFieldMultiples).map((field) => [field, true]);

  const toPopulate = (
    entries: readonly PopulateEntry[],
  ): Readonly<Record<string, unknown>> | undefined =>
    entries.length > 0 ? Object.fromEntries(entries) : undefined;

  // Dynamic zones are populated just enough to learn which component types are
  // present (and their order); the planner re-queries each present component
  // type with its full generated populate in parallel.
  const buildCorePopulate = (
    source: ResolvedSource,
  ): Readonly<Record<string, unknown>> | undefined => {
    const dzEntries: readonly PopulateEntry[] = (source.planner.dynamicZones ?? []).map((zone) => [
      zone,
      {
        on: Object.fromEntries(
          (source.dzComponents[zone] ?? []).map((uid) => [uid, { fields: ['id'] }]),
        ),
      },
    ]);
    return toPopulate([...componentEntries(source), ...mediaEntries(source), ...dzEntries]);
  };

  // `many` sources trade the decomposed plan for ONE findMany with the full
  // generated populate: dynamic zones and overlays are inlined. Intended for
  // the small collections composites target (banners, nav items); per-document
  // decomposition across a collection would multiply queries instead.
  const buildInlinePopulate = (
    source: ResolvedSource,
  ): Readonly<Record<string, unknown>> | undefined => {
    const irBridge = getService(strapi, 'ir-bridge');
    const dzEntries: readonly PopulateEntry[] = (source.planner.dynamicZones ?? []).map((zone) => [
      zone,
      {
        on: Object.fromEntries(
          (source.dzComponents[zone] ?? []).map((uid) => [
            uid,
            irBridge.buildComponentPopulate(uid, source.mediaPopulate, source.planner.components),
          ]),
        ),
      },
    ]);
    const relationEntries: readonly PopulateEntry[] = Object.entries(
      source.planner.relations ?? {},
    ).map(([field, overlay]) => [
      field,
      overlay === true
        ? true
        : {
            ...(overlay.fields !== undefined && { fields: overlay.fields }),
            ...(overlay.populate !== undefined && { populate: overlay.populate }),
          },
    ]);
    return toPopulate([
      ...componentEntries(source),
      ...mediaEntries(source),
      ...dzEntries,
      ...relationEntries,
    ]);
  };

  const sanitize = (data: unknown, uid: string, auth: unknown): Promise<unknown> =>
    getService(strapi, 'sanitizer').sanitizeDocument(data, uid, auth);

  const renderManySource = async (
    source: ResolvedSource,
    params: RequestParams,
  ): Promise<SourceOutcome> => {
    const documents = strapi.documents(source.contentType as UID.ContentType);
    const query = {
      status: params.status,
      ...(params.locale !== undefined && { locale: params.locale }),
      ...(source.limit !== undefined && { limit: source.limit }),
      fields: [...source.coreFields],
      populate: buildInlinePopulate(source),
    };

    const { result, ms } = await timed(() =>
      getService(strapi, 'query-gate').run(() =>
        documents.findMany(query as Parameters<typeof documents.findMany>[0]),
      ),
    );
    const list = Array.isArray(result) ? result : [];
    const sanitized = await Promise.all(
      list.map((doc) => sanitize(doc, source.contentType, params.auth)),
    );

    const subQuery: SubQuery = {
      id: scopedToSource(source.name, 'source:findMany'),
      kind: 'source-many',
      uid: source.contentType,
      params: query as Readonly<Record<string, unknown>>,
    };
    return {
      data: sanitized,
      subQueries: [subQuery],
      timings: [{ id: subQuery.id, ms }],
    };
  };

  const renderSingleSource = async (
    view: ResolvedView,
    source: ResolvedSource,
    params: RequestParams,
  ): Promise<SourceOutcome | null> => {
    const documents = strapi.documents(source.contentType as UID.ContentType);
    const isKeyedRoot = view.kind === 'keyed' && source.name === null;
    const query = {
      ...(isKeyedRoot && view.lookup !== null
        ? { filters: { [view.lookup.field]: { $eq: params.key } } }
        : {}),
      status: params.status,
      ...(params.locale !== undefined && { locale: params.locale }),
      fields: [...source.coreFields],
      populate: buildCorePopulate(source),
    };

    const core = (await getService(strapi, 'query-gate').run(() =>
      documents.findFirst(query as Parameters<typeof documents.findFirst>[0]),
    )) as Record<string, unknown> | null;
    if (!core) return null;

    const plan = getService(strapi, 'planner').plan(source, core);
    const executed = await getService(strapi, 'executor').execute(plan, source, {
      documentId: String(core.documentId),
      status: params.status,
      locale: params.locale,
    });

    const [sanitizedCore, ...sanitizedDocs] = await Promise.all([
      sanitize(core, source.contentType, params.auth),
      ...executed.map((sub) => sanitize(sub.document, source.contentType, params.auth)),
    ]);
    const sanitizedSubs = executed.map((sub, index) => ({
      ...sub,
      document: (sanitizedDocs[index] as Record<string, unknown> | null) ?? null,
    }));

    const merged = mergeSubResults(sanitizedCore as Record<string, unknown>, source, sanitizedSubs);

    return {
      data: merged,
      subQueries: plan.subQueries.map((sub) => ({
        ...sub,
        id: scopedToSource(source.name, sub.id),
      })),
      timings: executed.map(({ subQuery, ms }) => ({
        id: scopedToSource(source.name, subQuery.id),
        ms,
      })),
    };
  };

  const render = async (
    view: ResolvedView,
    params: RequestParams,
  ): Promise<RenderOutcome | null> => {
    const transformerService = getService(strapi, 'transformer');
    const transforms = view.transforms ?? [];

    const outcomes = await Promise.all(
      view.sources.map(async (source) => {
        const outcome = source.many
          ? await renderManySource(source, params)
          : await renderSingleSource(view, source, params);
        if (!outcome) return null;
        return {
          source,
          outcome: {
            ...outcome,
            data: await transformerService.apply(outcome.data, source.contentType, transforms),
          },
        };
      }),
    );

    let data: unknown;
    if (view.kind === 'composite') {
      // Absent single sources compose as null; composites never 404.
      data = Object.fromEntries(
        view.sources.map((source, index) => [
          source.name ?? '',
          outcomes[index]?.outcome.data ?? (source.many ? [] : null),
        ]),
      );
    } else {
      const rootOutcome = outcomes[0];
      if (!rootOutcome) return null;
      data = rootOutcome.outcome.data;
    }

    const present = outcomes.flatMap((entry) => (entry ? [entry.outcome] : []));
    const timings = present.flatMap((outcome) => outcome.timings);
    const hookCtx: HookCtx = {
      strapi,
      view: view.id,
      key: params.key,
      status: params.status,
      locale: params.locale,
      timings,
    };

    const enriched = view.enrich ? await view.enrich(data, hookCtx) : data;
    const assembled = view.assemble ? await view.assemble(enriched, hookCtx) : enriched;

    return {
      data: assembled,
      plan: { subQueries: present.flatMap((outcome) => outcome.subQueries) },
      timings,
    };
  };

  const renderShared = (
    renderKey: string,
    view: ResolvedView,
    params: RequestParams,
  ): Promise<RenderOutcome | null> => {
    const pending = inFlightRenders.get(renderKey);
    if (pending) return pending;
    const started = render(view, params).finally(() => inFlightRenders.delete(renderKey));
    inFlightRenders.set(renderKey, started);
    return started;
  };

  // A hit reports the stored plan (still structurally true) but no timings:
  // those belonged to the render that filled the cache, not to this request.
  const respond = (
    view: ResolvedView,
    params: RequestParams,
    outcome: RenderOutcome,
    cacheStatus: CacheStatus,
  ): PipelineResult => ({
    status: 200,
    body: {
      data: outcome.data,
      meta: {
        view: view.id,
        ...(params.explain &&
          explainAllowed() && {
            explain: {
              cache: cacheStatus,
              plan: outcome.plan.subQueries,
              ...(cacheStatus !== 'hit' && { timings: outcome.timings }),
            },
          }),
      },
    },
  });

  const run = async (viewId: string, ctx: ViewRequestCtx): Promise<PipelineResult> => {
    const view = getService(strapi, 'view-registry').getView(viewId);
    if (!view) return internalError(`Unknown view '${viewId}'`);

    // Draft access is an explicit opt-in per view: the view permission alone
    // must not expose unpublished content.
    if (ctx.query.publicationState === 'preview' && view.allowPreview !== true) {
      return previewForbidden(view);
    }

    const params = resolveParams(view, ctx);
    const authKey = authCacheKey(params.auth);

    // Drafts are never cached: preview traffic always renders fresh.
    const useCache = view.cache?.enabled === true && params.status === 'published';
    const cacheService = getService(strapi, 'cache');

    if (useCache) {
      const hit = cacheService.get(view.id, params.key, params.status, params.locale, authKey) as
        RenderOutcome | undefined;
      if (hit) return respond(view, params, hit, 'hit');
    }

    try {
      const started = process.hrtime.bigint();
      const outcome = useCache
        ? await renderShared(
            [view.id, params.status, params.locale ?? '', authKey, params.key].join('\u0000'),
            view,
            params,
          )
        : await render(view, params);
      if (!outcome) return notFound(view, params);

      if (useCache) {
        cacheService.set(
          view.id,
          params.key,
          params.status,
          params.locale,
          outcome,
          view.cache?.ttlMs,
          authKey,
        );
      }

      const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
      strapi.log.debug(
        `[bff-views] ${view.id} key='${params.key}' subQueries=${outcome.plan.subQueries.length} totalMs=${totalMs.toFixed(1)}`,
      );

      return respond(view, params, outcome, useCache ? 'miss' : 'off');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[bff-views] view '${viewId}' failed for key='${params.key}': ${message}`);
      return internalError(`View '${viewId}' failed`);
    }
  };

  return { run };
};

export default pipeline;
