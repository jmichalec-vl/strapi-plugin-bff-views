# strapi-plugin-bff-views

> Configurable BFF ("backend-for-frontend") aggregate endpoints for Strapi v5 - one HTTP request returns a fully populated, transformed, assembled page payload, backed by parallel decomposed queries server-side.

[![npm version](https://img.shields.io/npm/v/strapi-plugin-bff-views.svg)](https://www.npmjs.com/package/strapi-plugin-bff-views)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.md)
[![strapi](https://img.shields.io/badge/strapi-v5-8c4bff.svg)](https://strapi.io)

---

## The problem

Frontends built on Strapi tend to end up in one of two bad places when rendering content-heavy pages (dynamic zones, nested components, relations):

1. **Client-side fan-out** - the frontend fires 10-20 requests per page (one core query plus one per module type, relation, sub-resource). Fast on the database side, but every request pays HTTP, auth, and serialization overhead, and build-time page generation multiplies it by every page.

2. **One deep populate** - a single request with a huge `populate` tree. Strapi resolves large populate trees serially with N+1 queries per relation and over-populates dynamic zones (every allowed component type is joined whether present or not). In practice this is dramatically slower - the measurement that motivated this plugin showed a ~4x slowdown versus the fan-out it replaced.

**This plugin keeps the decomposition but moves it inside one request.** A minimal core query discovers which dynamic-zone component types are actually present, then one tailored sub-query per present component type and per relation group runs in parallel (`Promise.all` under a concurrency cap), and the results are merged into a single document tree:

```
GET /api/bff-views/product-detail/my-product
        |
        v
+- core query ------------------------------+
| scalar fields + seo + DZ presence (ids)   |
+---------------+---------------------------+
                v plan from what is actually present
+-----------+-----------+-----------+--------------+
| dz:hero   | dz:faq    | dz:grid   | relations    |   <- parallel
+-----+-----+-----+-----+-----+-----+------+-------+
      +-----------+--- merge -+------------+
                v
   sanitize -> transform -> enrich -> assemble
                v
      { data: <assembled page>, meta }
```

## Features

- **Config-defined views** - declare an endpoint per page type in `config/plugins.ts`; no controllers or routes to write.
- **Query planner** - decomposes each request into small tailored queries; component types absent from the page cost nothing. The planner never emits a whole-document deep populate (enforced by tests, not convention).
- **Schema-derived populate trees** - nested component/media populate is generated from your content-type schemas at runtime, so views don't drift from your content model. Zero dependencies beyond Strapi itself.
- **Field transformers** - declarative value transforms (e.g. richtext -> MDX) matched by attribute type and/or field-name pattern, applied via a schema-guided tree walk.
- **Enrich & assemble hooks** - plain async functions to add computed data and shape the final payload exactly as your frontend consumes it.
- **Sanitization first** - every query result passes through `strapi.contentAPI.sanitize.output` _before_ transformers or hooks run; `private: true` fields can never leak through custom shapes.
- **Per-view API-token permissions** - each view is its own permission action, so a custom token can be scoped to exactly the views it needs.
- **Response cache** - opt-in per view: in-process LRU with TTL and automatic invalidation driven by database lifecycle events (including publish).
- **Explain telemetry** - `?_explain=true` returns the query plan, per-query timings, and cache status alongside the data.
- **Draft & Publish aware** - `publicationState=preview` serves drafts on views that opt in via `allowPreview`; drafts are never cached.
- Strict TypeScript, functional style, 110+ unit tests and a full end-to-end suite against a real Strapi app.

## Requirements

| Dependency | Version     |
| ---------- | ----------- |
| Strapi     | `^5.0.0`    |
| Node.js    | `>=20 <=24` |

No other runtime dependencies - the plugin introspects your schemas itself.

## Installation

```bash
npm install strapi-plugin-bff-views
# or
yarn add strapi-plugin-bff-views
```

Enable the plugin in `config/plugins.ts`:

```ts
export default () => ({
  'bff-views': {
    enabled: true,
    config: {
      views: {
        // see Quick start below
      },
    },
  },
});
```

Rebuild and restart Strapi. Invalid view configuration (unknown content type, unknown field, path collision, ...) **fails startup** with an aggregated error message - a broken view never boots silently.

## Quick start

Given a `page` content type with a `slug` field, an `seo` component, and a `modules` dynamic zone:

```ts
'bff-views': {
  enabled: true,
  config: {
    views: {
      'content-page': {
        contentType: 'api::page.page',
        path: '/content-page/:slug',
        lookup: { field: 'slug' },
        planner: {
          fields: ['title', 'slug'],
          componentFields: ['seo'],
          dynamicZones: ['modules'],
        },
      },
    },
  },
},
```

Request it with any API token that has access to the view (see [Authentication](#authentication--permissions)):

```bash
curl -H "Authorization: Bearer $STRAPI_TOKEN" \
  http://localhost:1337/api/bff-views/content-page/home
```

```jsonc
{
  "data": {
    "documentId": "abc123",
    "title": "Home",
    "slug": "home",
    "seo": { "metaTitle": "Home | Acme", "metaImage": { "url": "..." } },
    "modules": [
      { "__component": "modules.hero-section", "title": "...", "image": { "url": "..." }, "buttons": [ ... ] },
      { "__component": "modules.faq-section", "faqItems": [ ... ] }
    ]
  },
  "meta": { "view": "content-page" }
}
```

Every dynamic-zone entry arrives fully populated (nested components, media), in its authored order - even though no deep populate ever ran.

## Keyless views: singletons and composites

Not everything is a keyed page. Two more view kinds cover the rest (added in 0.2.0):

**Singleton views** - a parameterless `path`, a **single type** as `contentType`, no `lookup`. Same planner/transforms/hooks/cache/permissions as keyed views; `404` when the single type has no (published) document.

```ts
'site-header': {
  contentType: 'api::header.header',   // must be a single type
  path: '/site-header',
  planner: { componentFields: ['links'], dynamicZones: ['dropdowns'] },   // no public scalars -> no `fields` needed
},
```

**Composite views** - no content type of their own; named `sources` fetched in parallel, composed into one object. The classic use case is global chrome: header + footer + banners in one request instead of N.

```ts
chrome: {
  path: '/chrome',
  sources: {
    header:  { contentType: 'api::header.header', planner: { ... } },          // single type -> findFirst
    footer:  { contentType: 'api::footer.footer', planner: { ... } },
    banners: { contentType: 'api::promo-banner.promo-banner', many: true,      // collection -> findMany
               limit: 20,                                                       // result cap (recommended)
               planner: { fields: ['title', 'target'] } },
  },
  transforms: ['mdx-richtext'],   // applied per source, each with its own schema
  assemble: async (data) => data, // receives { header, footer, banners }
  cache: { enabled: true },       // keyless caching is where cache pays off (SSR/ISR chrome)
},
```

Composite semantics: `data = { [sourceName]: result }`; absent single sources compose as `null` (composites never 404); `many` sources return the sanitized list, capped by `limit` when set - consumer-side selection (e.g. banner targeting) stays in the frontend. A single source (`many` unset) must point at a single type: on a collection type it would serve an arbitrary document, so startup rejects it. Each source planner is validated exactly like a view planner. Cache invalidation covers the union of all source content types.

One deliberate trade: `many` sources run **one findMany with the full generated populate** (zones and overlays inlined) instead of the decomposed per-document plan - the right shape for the small collections composites target (banners, nav lists); large collections belong behind keyed views. The Document Service applies no default limit, so always set `limit` on a `many` source; startup logs a warning when it is missing.

Source keys: `contentType`, `planner`, `many` (default `false`), `limit` (positive integer, `many` sources only).

## Configuration reference

All configuration lives under the `config` key of the `bff-views` plugin entry. Because `config/plugins.ts` is code, hooks and transformers are plain functions - no serialization tricks needed.

### Top level

| Key                  | Type                          | Default                   | Description                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views`              | `Record<string, View>`        | `{}`                      | Views keyed by view id. Ids must match `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (lowercase alphanumerics and hyphens - they become route handlers and permission action names).                                                                                                                                          |
| `transformers`       | `Record<string, Transformer>` | `{}`                      | Named field transformers available to views.                                                                                                                                                                                                                                                                        |
| `cache.maxEntries`   | `number`                      | `500`                     | Global LRU capacity across all views.                                                                                                                                                                                                                                                                               |
| `explain`            | `'on' \| 'off'`               | `'on'` outside production | Gates the `?_explain=true` telemetry.                                                                                                                                                                                                                                                                               |
| `maxInFlightQueries` | `number`                      | `32`                      | Process-wide cap on concurrent Document Service calls issued by all views together. Requests beyond it queue in memory instead of competing for the database pool (Strapi's default pool holds 10 connections). Per-request parallelism is still bounded by `planner.concurrency`.                                  |
| `mediaPopulate`      | `{ fields: string[] }`        | full media                | Field selection for media inside GENERATED populate trees (componentFields + DZ components) - cuts the upload entity (formats, hashes, metadata) down to what you serve. Explicit populate (`mediaFields`, relation overlays, `components` overrides) is never touched. Per-view override: `planner.mediaPopulate`. |

### View

| Key            | Type                                   | Required             | Description                                                                                                                                        |
| -------------- | -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentType`  | `string`                               | yes                  | Content-type UID, e.g. `api::page.page`.                                                                                                           |
| `path`         | `string`                               | yes                  | Route path with **exactly one parameter**, e.g. `/content-page/:slug`. Mounted under `/api/bff-views`. The parameter value becomes the lookup key. |
| `lookup.field` | `string`                               | yes                  | Field the key is matched against with `findFirst` (`documentId` is allowed). Use a unique field.                                                   |
| `planner`      | `Planner`                              | yes                  | Query decomposition - see below.                                                                                                                   |
| `transforms`   | `string[]`                             | -                    | Transformer names to apply, in order.                                                                                                              |
| `enrich`       | `(draft, ctx) => data`                 | -                    | Hook after transform, before assemble.                                                                                                             |
| `assemble`     | `(merged, ctx) => body`                | -                    | Final shaping hook; default returns the merged tree.                                                                                               |
| `cache`        | `{ enabled: boolean; ttlMs?: number }` | `{ enabled: false }` | Per-view response cache - see [Caching](#caching).                                                                                                 |
| `allowPreview` | `boolean`                              | `false`              | Allow `?publicationState=preview` to serve drafts. Off by default - requesting preview on a view without it returns `403`.                         |

### Planner

| Key               | Type                              | Description                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`          | `string[]`                        | **Scalar** fields selected in the core query (validated - relations/components/media/dynamic zones are rejected here). `documentId` is always included. Optional: content types with no public scalars (component/relation-only) may omit it, as long as the planner selects _something_.           |
| `dynamicZones`    | `string[]`                        | Dynamic zones served by this view. Each is populated minimally in the core query (just component identity + order), then one sub-query per component type actually present re-fetches it fully.                                                                                                     |
| `componentFields` | `string[]`                        | Plain (non-DZ) component attributes populated in the core query with their generated populate tree - e.g. `seo`. Keep these small; big structures belong in a dynamic zone.                                                                                                                         |
| `mediaFields`     | `string[]`                        | Root media attributes populated in the core query (e.g. `images`) - a single flat join, so it needs no sub-query. Always populated FULL (unaffected by `mediaPopulate`).                                                                                                                            |
| `relations`       | `Record<string, RelationOverlay>` | Relations to populate - see below. Relations are **never** populated implicitly.                                                                                                                                                                                                                    |
| `components`      | `Record<string, PopulateObject>`  | Per-component-UID overrides replacing the generated populate for that component **wherever it appears** - componentFields trees, DZ sub-queries, many-source inline populate, at any nesting depth (e.g. to trim fields on a heavy component, or to populate a relation inside a nested component). |
| `concurrency`     | `number`                          | Max parallel sub-queries per request. Default `8`.                                                                                                                                                                                                                                                  |

### Relation overlays

The generated populate intentionally contains no relations - relation population is always an explicit, hand-written decision:

```ts
relations: {
  author: true,                             // full default population
  variants: { fields: ['sku', 'price'] },   // trimmed
  category: {                               // nested populate -> own sub-query
    fields: ['slug', 'title'],
    populate: { image: true },
  },
},
```

- Overlays **without** a nested `populate` (including `true`) are grouped into **one** sub-query.
- Overlays **with** a nested `populate` each get a **dedicated** sub-query.

### Transformers

```ts
transformers: {
  'mdx-richtext': {
    match: { fieldType: 'richtext' },       // Strapi attribute type
    transform: async (value, fieldCtx) => serializeMdx(String(value)),
  },
  'shout-title': {
    match: { fieldName: '^title$' },        // regex over the attribute name
    transform: (value) => String(value).toUpperCase(),
  },
},
```

| Key               | Type                                          | Description                                                                    |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `match.fieldType` | `string`                                      | Strapi attribute type (`richtext`, `string`, `json`, ...).                     |
| `match.fieldName` | `string`                                      | Regular-expression source tested against the attribute name.                   |
| `transform`       | `(value, ctx) => unknown \| Promise<unknown>` | Receives the current value and a `FieldCtx { path, attribute, containerUid }`. |

At least one of `fieldType` / `fieldName` is required; when both are set, both must match. Matching is **schema-guided**: the document tree is walked with the content-type/component IR, so a `richtext` field inside a component nested three levels deep inside a dynamic zone is found without any runtime type-guessing - and relation targets are never descended into.

Execution semantics:

- Transformers listed in `transforms` run **sequentially in order** - a later transformer sees the previous one's output.
- Within one transformer, all matching fields run in a single `Promise.all` batch, so async transforms (MDX serialization, syntax highlighting) parallelize internally.
- The input tree is never mutated; hooks receive a fresh tree.

### Hooks

```ts
enrich: async (draft, ctx) => {
  // add computed data - runs after sanitize + transform
  return { ...draft, theme: await resolveThemeDefaults(ctx.strapi, draft) };
},
assemble: async (merged, ctx) => {
  // return exactly what the frontend consumes
  return buildPageProps(merged);
},
```

Both hooks take the data first and a `HookCtx` second (unified in 1.0.0; before that `enrich` took the context first):

```ts
interface HookCtx {
  strapi: Core.Strapi;
  view: string; // view id
  key: string; // resolved path parameter
  status: 'draft' | 'published';
  locale: string | undefined;
  timings: { id: string; ms: number }[]; // per-sub-query timings
}
```

Because sanitization runs _before_ transform/enrich/assemble, hook code receives only data an API consumer is allowed to see - you cannot accidentally leak a private field through a custom shape.

## Endpoints

Each view mounts `GET /api/bff-views/<path>`. Additionally:

| Route                         | Description                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bff-views/status`   | Lists the configured view ids (token-authenticated).                                                                                                                                                                                                                       |
| `GET /api/bff-views/manifest` | Versioned, serializable description of every resolved view (fields, zones, relation overlays, transform match specs, hook flags). Consumed by external schema generators - notably `strapi-plugin-content-schemas`' per-view schema generation - and useful for debugging. |

### Query parameters

| Param                      | Effect                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationState=preview` | Serves the draft version (maps to Documents API `status: 'draft'` internally). Requires the view to opt in via `allowPreview: true` - otherwise `403`. Draft responses are never cached. |
| `locale=<code>`            | Locale passthrough to the core query and every sub-query.                                                                                                                                |
| `_explain=true`            | Adds `meta.explain` (plan, timings, cache status). Gated by the `explain` config flag.                                                                                                   |

No `populate`, `fields`, or `filters` parameters are accepted - the query graph is server-owned. That's the point.

### Response envelope

```jsonc
// 200
{ "data": { ...assembled page... }, "meta": { "view": "content-page" } }

// 404 - no document for the key (or draft requested without preview)
{ "data": null, "error": { "status": 404, "name": "NotFoundError", "message": "No document for slug='ghost'" } }

// 500 - any sub-query failed; partial pages are never served or cached
{ "data": null, "error": { "status": 500, "name": "BffViewError", "message": "View 'content-page' failed" } }
```

## Authentication & permissions

View routes use standard Strapi content-api token authentication. Each view registers its **own permission action**:

```
plugin::bff-views.view.<view-id>
```

To scope a read-only token to specific views: **Settings -> API Tokens -> Create new API Token -> Token type: Custom**, then enable the desired view actions under the **Bff-views** section.

Notes:

- `Full access` tokens bypass scoping entirely (Strapi behavior).
- A custom token without a view's action receives `403` on that view - this is covered by the plugin's e2e tests.

## Caching

Opt-in per view:

```ts
cache: { enabled: true, ttlMs: 60_000 }   // ttlMs optional
```

Semantics (v1 is deliberately **coarse and correct** over clever):

- In-process LRU `Map` (capacity `cache.maxEntries`, default 500), key = `view + status + locale + caller identity + key`. Entries are **never shared across tokens/users**: sanitized output depends on the caller's field-level visibility, so each authenticated identity has its own entries. Multi-instance deployments cache per process.
- **Drafts are never cached**; 404s are never cached; failed renders are never cached.
- **Invalidation** is driven by one `strapi.db.lifecycles` subscription over each view's _participating UIDs_ - its content type, every component UID reachable through its zones/components, the targets of its relation overlays (including relations reached through a nested overlay `populate`), and the targets of every relation declared on a reachable component (what `planner.components` overrides populate). Any create/update/delete touching one of them flushes **all** cached entries of the affected views. Publish, unpublish, and discard-draft are covered too (Strapi implements them as delete+create at the database layer). Media writes (`plugin::upload.file`) flush every cached view.
- **Stampede protection**: concurrent misses for the same entry (same view, key, locale and caller identity) share one render; only the first request touches the database.
- **Known blind spot:** writes performed with raw Knex (bypassing Strapi's entity layer) do not emit lifecycle events and will not flush the cache. Use a TTL if such writes exist in your app.

Under heavy editorial activity the flush-everything strategy means a low hit rate - that is the intended trade-off for v1. Precise dependency-tracked invalidation is the headline v2 feature.

## Observability

Per-request debug log (enable Strapi's `debug` log level):

```
[bff-views] content-page key='home' subQueries=3 totalMs=24.1
```

With `?_explain=true` (and `explain` not `'off'`):

```jsonc
"meta": {
  "view": "content-page",
  "explain": {
    "cache": "miss",                      // "hit" | "miss" | "off"
    "plan": [
      { "id": "dz:modules:modules.hero-section", "kind": "dz-component", ... },
      { "id": "dz:modules:modules.faq-section",  "kind": "dz-component", ... },
      { "id": "relations:group",                 "kind": "relation-group", ... }
    ],
    "timings": [
      { "id": "dz:modules:modules.hero-section", "ms": 6.2 },
      { "id": "dz:modules:modules.faq-section",  "ms": 5.8 },
      { "id": "relations:group",                 "ms": 4.9 }
    ]
  }
}
```

On a cache hit `timings` is omitted: the stored plan still describes the response, but the timings belonged to the render that filled the cache.

`explain` defaults to on in development and off in production; set `explain: 'on'` explicitly if you want it in production.

## How a request is served

1. **Resolve** - view, key from the path parameter, status (`publicationState=preview` -> draft), locale.
2. **Cache lookup** - published requests on cache-enabled views only.
3. **Core query** - `findFirst` by the lookup field: scalar `fields`, `componentFields` with generated populate, and each dynamic zone populated minimally (`on:` fragments selecting only `id`) to learn which component types are present and preserve entry order. Miss -> 404.
4. **Plan** - one sub-query per unique component type present per zone, plus relation queries from the overlays. Enforced invariant: every sub-query populates exactly one component type or one relation group.
5. **Execute** - all sub-queries in parallel under the per-request concurrency cap and the process-wide `maxInFlightQueries` gate, each timed. Any failure -> the whole request fails with 500 and no further sub-queries of that request are started.
6. **Sanitize** - every result through `strapi.contentAPI.sanitize.output` against the content-type schema and the request's auth. Private fields are stripped here, before any custom code runs.
7. **Merge** - DZ entries slotted back by (zone, order, component uid, id); relations attached to their fields.
8. **Transform** - configured transformers over the merged tree.
9. **Hooks** - `enrich`, then `assemble` (default: the merged tree).
10. **Cache store & respond** - `{ data, meta }`.

## Limitations & gotchas

- **Relations are always explicit.** Neither the core query nor the generated populate includes any relation - including relations _inside components_. A relation nested in a component is only populated if you override that component via `planner.components['<component.uid>']` - which works at any depth, including components nested inside other components.
- **`planner.fields` is scalar-only** (validated at startup). Components go in `componentFields`; media inside components comes from the generated populate.
- **`private: true` attributes cannot be served** - content-API sanitization strips them from every response, no matter what the planner requests. Selecting one anywhere in a planner (`fields`, `componentFields`, `mediaFields`, `dynamicZones`, `relations`) fails startup rather than silently returning documents without the field. If a field must be public, unmark it in the schema.
- **One path parameter per view.** The parameter name is yours (`:slug`, `:key`, ...); its value is matched against `lookup.field`.
- **View ids are identifiers.** They become controller method names and permission action UIDs, hence the restrictive id pattern (no dots, no uppercase).
- **Recursive components** (a component that references itself, directly or via a cycle) crash Strapi v5's own Document Service (`getDeepPopulate` recurses infinitely on create/publish). This is a framework limitation you'll hit before this plugin does - avoid such schemas.
- **Server-only** - no admin panel in v1. Views are code, reviewed in PRs like the rest of your config.
- The response cache is per-process; behind a load balancer each instance warms and flushes independently (lifecycle events fire on the instance that performed the write - use TTLs in multi-instance setups where writes can happen on any instance).

## Security model

- **Authentication**: every route (views, `/status`, `/manifest`) requires a content-api token. Each view is its own permission action (`plugin::bff-views.view.<id>`), so custom tokens can be scoped per view; `full access` tokens bypass scoping (Strapi behavior).
- **Draft content**: `?publicationState=preview` is rejected with `403` unless the view sets `allowPreview: true`. Enable it only on views whose tokens are trusted to see unpublished content.
- **Sanitization**: every query result passes through `strapi.contentAPI.sanitize.output` (with the request's auth) _before_ transformers and hooks - `private: true` fields and RBAC-invisible fields are stripped there. **Data your `enrich`/`assemble` hooks add themselves is not re-sanitized** - hooks are trusted code; don't inject raw records into the response from a hook without scrubbing them.
- **Cache isolation**: cache entries are keyed by caller identity (see Caching) - a response sanitized for one token is never served to another.
- **Structure disclosure**: `/manifest` (and `?_explain=true`) reveal view configuration and schema _structure_ - field names, component uids, populate shapes - but never data, hook code, or transformer code. Scope them away from tokens that shouldn't see your content model, and never grant any view action to the Public role unless the content is truly public.
- **`_explain`** defaults to off when `NODE_ENV=production` and on otherwise - make sure production actually sets `NODE_ENV`, or pin it with `explain: 'off'`.
- **Injection surface**: the only request inputs used in queries are the path key (always bound as a scalar `$eq` against the startup-validated lookup field) and `locale`/`publicationState` (mapped, never spliced). No client input ever shapes `populate`, `fields`, or `filters`.

## Versioning & stability

Public surface: the plugin config schema, the endpoint contract, the response envelope, the view manifest, and the `FieldCtx`/`HookCtx` shapes passed to transformers and hooks. Semver applies to these; see [CHANGELOG.md](./CHANGELOG.md) for the history, including the breaking hook-signature change in 1.0.0.

## Development

```bash
git clone <repo>
cd strapi-plugin-bff-views
npm install

npm run build          # @strapi/sdk-plugin server bundle
npm test               # unit tests (vitest)
npm run test:coverage  # unit tests with v8 coverage (80% thresholds)
npm run type-check     # strict TS across server + tests
npm run lint
```

### End-to-end tests

A complete Strapi v5 app lives in `__tests__/e2e/strapi-app` (SQLite, DZ-heavy content types, relations, private fields, seed data). The e2e suite boots it, waits for health + token bootstrap, and exercises the plugin over HTTP - including per-view token scoping, sanitization, transformer output, and cache flush on update/publish.

```bash
npm run build                                   # plugin dist is loaded by the app
(cd __tests__/e2e/strapi-app && npm install)    # first run only
npm run test:e2e
```

## Contributing

Issues and PRs welcome. Ground rules:

- Bug reports: include your view config, the relevant content-type schema, and `?_explain=true` output where applicable.
- New features ship with unit tests; anything touching the request pipeline also ships with an e2e test.
- The planner invariant (no whole-document deep populate, ever) is non-negotiable - it is the reason this plugin exists.
- **The schema-generation contract is versioned.** External schema generators depend on more than the manifest's shape: the response envelope (`{ data, meta: { view } }` / `{ data: null, error }`), the transformer walk stopping at relation boundaries, enrich adding unknown keys, and assemble replacing the data shape are all load-bearing. Changing any of these - or the manifest shape non-additively - requires bumping `MANIFEST_VERSION` (see the contract note on `describeViews` in `view-registry.ts`) so generators gate instead of silently emitting wrong schemas. Additive manifest fields keep the version.

## Related

- [`strapi-plugin-content-schemas`](https://www.npmjs.com/package/strapi-plugin-content-schemas) - optional companion by the same author: generates Zod/Valibot schemas and TypeScript types from your Strapi content types. When both plugins run in the same app, it also consumes this plugin's view manifest to generate **exact per-view response schemas** (`views/<view-id>.ts` in its pulled output), so your frontend validates BFF responses without hand-written composition files and its `strapi-schemas check` CI gate fails on view-config drift. Not required by this plugin.

## License

[MIT](./LICENSE.md)
