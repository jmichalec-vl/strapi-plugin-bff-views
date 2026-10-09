# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-10-09

First stable release. Prepared by a full code audit before open-sourcing.

### Breaking

- `enrich` hooks now receive the data first and the context second,
  `enrich(draft, ctx)`, matching `assemble(merged, ctx)`. Swap the two
  parameters in existing hooks.
- A composite source without `many: true` must point at a single type.
  On a collection type it returned an arbitrary document; startup now rejects
  it. Use `many: true` with a `limit`, or a keyed view.

### Added

- `limit` on `many` sources (positive integer, passed to `findMany`). The
  Document Service has no default limit, so startup warns when a `many`
  source omits it. Exposed in the manifest as `limit` (additive, manifest
  version stays 1).
- `maxInFlightQueries` (default 32): process-wide cap on concurrent Document
  Service calls across all views, enforced by an in-process semaphore.
- Cache stampede protection: concurrent misses for one cache entry share a
  single render.
- `CHANGELOG.md`.

### Fixed

- Cache invalidation missed relation targets reached through
  `planner.components` overrides (relations inside components) and through
  nested relation overlay `populate`. Those targets now participate in
  invalidation, so editing a document linked from inside a component flushes
  the views that serve it.
- A failing sub-query no longer keeps starting the remaining sub-queries of
  the same request.
- Overwriting a cache entry now refreshes its LRU position.

### Changed

- `?_explain=true` on a cache hit reports `cache: "hit"` and the stored plan
  but omits `timings`, which belonged to the render that filled the cache.
- Transformer `fieldName` patterns are compiled once per transformer instead
  of once per field visit.
- Service access inside the plugin is fully typed; no `any` remains in the
  server source.
- All comments and docs use plain ASCII punctuation.

## 0.2.2 - 2026-10-07

- `planner.components` overrides apply at any depth of generated populate
  trees, so a relation inside a nested component can be populated.

## 0.2.1

- `planner.fields` is optional when the planner selects something else.
- Startup rejects `private: true` attributes anywhere in a planner.

## 0.2.0

- Keyless views: `singleton` (single type, no lookup) and `composite` (named
  `sources` fetched in parallel, `many: true` for small collections).
- Manifest gains `kind` and `sources` (additive, manifest version 1).

## 0.1.4 - 2026-07-21

- `mediaPopulate` (global and per planner) narrows media inside generated
  populate trees.

## 0.1.3

- Security hardening: `allowPreview` opt-in per view, cache entries keyed by
  caller identity, README security section.

## 0.1.2

- `planner.mediaFields`; `componentFields` honour `planner.components`
  overrides.

## 0.1.0 - 2026-07-18

- Initial release: planner, executor, transformers, enrich/assemble hooks,
  per-view cache with lifecycle invalidation, explain telemetry, per-view
  API-token permissions, view manifest.
