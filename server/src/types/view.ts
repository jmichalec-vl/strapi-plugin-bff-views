import type { Core } from '@strapi/types';

import type { AttributeIR, StrapiAttributeType } from './ir';

export type DocumentStatus = 'draft' | 'published';

export interface FieldCtx {
  readonly path: readonly (string | number)[];
  readonly attribute: AttributeIR;
  readonly containerUid: string;
}

export type TransformerFn = (value: unknown, ctx: FieldCtx) => unknown;

export interface TransformerMatch {
  readonly fieldType?: StrapiAttributeType;
  /** Regular-expression source matched against the attribute name. */
  readonly fieldName?: string;
}

export interface TransformerConfig {
  readonly match: TransformerMatch;
  readonly transform: TransformerFn;
}

/**
 * Field selection applied to media attributes inside GENERATED populate trees
 * (componentFields trees and DZ component trees), replacing the default full
 * `populate: true`. Explicitly authored populate - `planner.mediaFields`,
 * relation overlays, `planner.components` overrides - is never touched.
 */
export interface MediaPopulateConfig {
  readonly fields: readonly string[];
}

export type RelationOverlay =
  | true
  | {
      readonly fields?: readonly string[];
      readonly populate?: Readonly<Record<string, unknown>>;
    };

export interface ViewPlannerConfig {
  /**
   * Scalar field selection for the core query. Optional - content types whose
   * public surface is entirely components/relations need none; the core query
   * then selects only `documentId`. At least one planner selection key must be
   * present overall.
   */
  readonly fields?: readonly string[];
  readonly dynamicZones?: readonly string[];
  /**
   * Plain (non-dynamic-zone) component attributes populated in the core query
   * with their generated populate tree - e.g. an `seo` component. Small trees
   * only; large components belong in a dynamic zone or their own view.
   * Per-component `components` overrides apply here too.
   */
  readonly componentFields?: readonly string[];
  /**
   * Root media attributes populated in the core query (e.g. `images`). Media
   * is a single flat join - no deep-populate risk - which is why it lives in
   * the core query rather than the parallel plan.
   */
  readonly mediaFields?: readonly string[];
  readonly relations?: Readonly<Record<string, RelationOverlay>>;
  /** Per-component populate overrides applied on top of the generated populate. */
  readonly components?: Readonly<Record<string, unknown>>;
  /** Per-view override of the global `mediaPopulate`. */
  readonly mediaPopulate?: MediaPopulateConfig;
  readonly concurrency?: number;
}

export interface ViewCacheConfig {
  readonly enabled: boolean;
  readonly ttlMs?: number;
}

export interface SubQueryTiming {
  readonly id: string;
  readonly ms: number;
}

export interface HookCtx {
  readonly strapi: Core.Strapi;
  readonly view: string;
  readonly key: string;
  readonly status: DocumentStatus;
  readonly locale: string | undefined;
  readonly timings: readonly SubQueryTiming[];
}

export type EnrichHook = (draft: unknown, ctx: HookCtx) => unknown;
export type AssembleHook = (merged: unknown, ctx: HookCtx) => unknown;

/**
 * A named data source of a composite view. `many: false` (default) targets a
 * single type via findFirst; `many: true` targets a collection via findMany
 * (the full unfiltered list - consumer-side selection stays in the frontend).
 */
export interface SourceConfig {
  readonly contentType: string;
  readonly many?: boolean;
  /**
   * Maximum documents a `many` source returns (Document Service `limit`).
   * The Document Service applies no default limit, so without this a growing
   * collection becomes the whole-collection deep populate this plugin exists
   * to avoid; startup warns when a `many` source omits it.
   */
  readonly limit?: number;
  readonly planner: ViewPlannerConfig;
}

export interface ViewConfig {
  readonly path: string;
  /** Required for keyed/singleton views; forbidden for composite views. */
  readonly contentType?: string;
  /** Required for keyed views (path with one param); forbidden otherwise. */
  readonly lookup?: { readonly field: string };
  /** Required for keyed/singleton views; forbidden for composite views. */
  readonly planner?: ViewPlannerConfig;
  /** Composite views: named sources fetched in parallel. */
  readonly sources?: Readonly<Record<string, SourceConfig>>;
  readonly transforms?: readonly string[];
  readonly enrich?: EnrichHook;
  readonly assemble?: AssembleHook;
  readonly cache?: ViewCacheConfig;
  /**
   * Allow `?publicationState=preview` to serve draft documents. Off by
   * default: the view's permission action alone should not grant access to
   * unpublished content - enabling preview is an explicit decision.
   */
  readonly allowPreview?: boolean;
}

export type ViewKind = 'keyed' | 'singleton' | 'composite';

/** One resolved data source. Keyed/singleton views have exactly one, unnamed. */
export interface ResolvedSource {
  /** null for the single source of keyed/singleton views. */
  readonly name: string | null;
  readonly contentType: string;
  readonly many: boolean;
  /** Result cap for `many` sources; undefined means unbounded. */
  readonly limit: number | undefined;
  readonly planner: ViewPlannerConfig;
  /** Core-query field selection: configured fields plus 'documentId'. */
  readonly coreFields: readonly string[];
  /** Dynamic zone name -> component UIDs allowed in that zone. */
  readonly dzComponents: Readonly<Record<string, readonly string[]>>;
  /** Component field name -> component UID, for planner.componentFields. */
  readonly componentFieldUids: Readonly<Record<string, string>>;
  /** Media field name -> whether the attribute is multiple, for planner.mediaFields. */
  readonly mediaFieldMultiples: Readonly<Record<string, boolean>>;
  /** Effective media narrowing for generated trees: per-source value, else global. */
  readonly mediaPopulate: MediaPopulateConfig | undefined;
}

export interface ResolvedView {
  readonly id: string;
  readonly kind: ViewKind;
  readonly path: string;
  /** Name of the single path parameter; null for keyless views. */
  readonly keyParam: string | null;
  /** Lookup field for keyed views; null for keyless views. */
  readonly lookup: { readonly field: string } | null;
  readonly sources: readonly ResolvedSource[];
  readonly transforms?: readonly string[];
  readonly enrich?: EnrichHook;
  readonly assemble?: AssembleHook;
  readonly cache?: ViewCacheConfig;
  readonly allowPreview?: boolean;
  /** All source content types + reachable component UIDs + relation targets; drives cache invalidation. */
  readonly participatingUids: readonly string[];
}

export interface BffViewsConfig {
  readonly transformers?: Readonly<Record<string, TransformerConfig>>;
  readonly views?: Readonly<Record<string, ViewConfig>>;
  readonly cache?: { readonly maxEntries?: number };
  readonly explain?: 'on' | 'off';
  readonly mediaPopulate?: MediaPopulateConfig;
  /** Process-wide cap on concurrent Document Service calls across all views. Default 32. */
  readonly maxInFlightQueries?: number;
}

/**
 * Serializable description of the resolved views - the versioned contract
 * consumed by external schema generators (notably strapi-plugin-content-schemas'
 * per-view schema generation). Everything here is plain data: hook functions
 * are represented only by presence flags, transformer functions only by their
 * (serializable) match specs.
 */
export interface ViewManifestTransform {
  readonly name: string;
  readonly match: TransformerMatch;
}

export interface SourceManifestEntry {
  readonly contentType: string;
  readonly many: boolean;
  /** Added in 1.0.0 (manifest still v1, additive): result cap of a `many` source. */
  readonly limit?: number;
  readonly fields: readonly string[];
  readonly componentFields: Readonly<Record<string, string>>;
  readonly mediaFields: Readonly<Record<string, { readonly multiple: boolean }>>;
  readonly mediaPopulate?: MediaPopulateConfig;
  readonly dynamicZones: Readonly<Record<string, readonly string[]>>;
  readonly relations: Readonly<Record<string, RelationOverlay>>;
  readonly componentOverrides: Readonly<Record<string, unknown>>;
}

export interface ViewManifestEntry {
  readonly id: string;
  readonly path: string;
  /** Added in bff-views 0.2.0 (manifest still v1 - additive). */
  readonly kind: ViewKind;
  /** Keyed views only. */
  readonly keyParam?: string;
  readonly lookup?: { readonly field: string };
  /** Flat source description - present for keyed/singleton views. */
  readonly contentType?: string;
  readonly limit?: number;
  readonly fields?: readonly string[];
  readonly componentFields?: Readonly<Record<string, string>>;
  readonly mediaFields?: Readonly<Record<string, { readonly multiple: boolean }>>;
  readonly mediaPopulate?: MediaPopulateConfig;
  readonly dynamicZones?: Readonly<Record<string, readonly string[]>>;
  readonly relations?: Readonly<Record<string, RelationOverlay>>;
  readonly componentOverrides?: Readonly<Record<string, unknown>>;
  /** Composite views only (0.2.0): named source descriptions. */
  readonly sources?: Readonly<Record<string, SourceManifestEntry>>;
  readonly transforms: readonly ViewManifestTransform[];
  readonly hasEnrich: boolean;
  readonly hasAssemble: boolean;
}

export interface ViewManifest {
  readonly manifestVersion: 1;
  readonly views: readonly ViewManifestEntry[];
}
