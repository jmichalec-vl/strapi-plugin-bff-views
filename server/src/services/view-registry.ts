import type { Core } from '@strapi/types';

import type {
  BffViewsConfig,
  ResolvedSource,
  ResolvedView,
  SourceConfig,
  SourceManifestEntry,
  ViewConfig,
  ViewKind,
  ViewManifest,
  ViewManifestEntry,
  ViewPlannerConfig,
} from '../types';
import { MANIFEST_VERSION, PLUGIN_ID } from '../constants';
import { pathParamNames } from '../config';

interface RawAttribute {
  readonly type: string;
  readonly component?: string;
  readonly components?: readonly string[];
  readonly target?: string;
  readonly multiple?: boolean;
  readonly private?: boolean;
}

interface RawSchema {
  readonly kind?: string;
  readonly attributes?: Readonly<Record<string, RawAttribute>>;
}

// Core-query `fields` is a scalar selection; populatable/private types are
// requested through the planner instead.
const NON_SCALAR_TYPES = new Set(['relation', 'component', 'dynamiczone', 'media', 'password']);

const STATIC_ROUTE_PATHS = new Set(['/status', '/manifest']);

/**
 * Parses and validates the configured views against the loaded Strapi schemas.
 * Any error here must fail startup (the content-api router instantiates this
 * registry while routes are being mounted), so problems are aggregated into a
 * single thrown Error instead of surfacing one at a time.
 */
const viewRegistry = ({ strapi }: { strapi: Core.Strapi }) => {
  let resolved: readonly ResolvedView[] | null = null;

  const contentTypeSchema = (uid: string): RawSchema | undefined =>
    (strapi.contentTypes as unknown as Readonly<Record<string, RawSchema>>)[uid];

  const componentSchema = (uid: string): RawSchema | undefined =>
    (strapi.components as unknown as Readonly<Record<string, RawSchema>>)[uid];

  // Relations reachable through components (populated via planner.components
  // overrides) and through nested relation overlays also feed the cache, so
  // their targets must flush it too. Over-approximating (every relation on
  // every reachable component) is deliberate: a missed target means stale
  // responses, an extra one only costs hit rate.
  const componentRelationTargets = (componentUids: readonly string[]): readonly string[] =>
    componentUids.flatMap((uid) =>
      Object.values(componentSchema(uid)?.attributes ?? {}).flatMap((attribute) =>
        attribute.type === 'relation' && attribute.target ? [attribute.target] : [],
      ),
    );

  const overlayPopulateTargets = (
    targetUid: string,
    populate: Readonly<Record<string, unknown>> | undefined,
  ): readonly string[] => {
    if (!populate) return [];
    const attributes = contentTypeSchema(targetUid)?.attributes ?? {};
    return Object.entries(populate).flatMap(([field, nested]) => {
      const attribute = attributes[field];
      if (!attribute) return [];
      if (attribute.type === 'relation' && attribute.target) {
        const deeper =
          typeof nested === 'object' && nested !== null && 'populate' in nested
            ? (nested as { populate?: Readonly<Record<string, unknown>> }).populate
            : undefined;
        return [attribute.target, ...overlayPopulateTargets(attribute.target, deeper)];
      }
      const componentRoots =
        attribute.type === 'component' && attribute.component
          ? [attribute.component]
          : attribute.type === 'dynamiczone'
            ? (attribute.components ?? [])
            : [];
      const components = collectComponentUids(componentRoots);
      return [...components, ...componentRelationTargets(components)];
    });
  };

  const collectComponentUids = (rootUids: readonly string[]): readonly string[] => {
    const visited = new Set<string>();
    const visit = (uid: string): void => {
      if (visited.has(uid)) return;
      visited.add(uid);
      const attributes = componentSchema(uid)?.attributes ?? {};
      for (const attribute of Object.values(attributes)) {
        if (attribute.type === 'component' && attribute.component) visit(attribute.component);
        if (attribute.type === 'dynamiczone') (attribute.components ?? []).forEach(visit);
      }
    };
    rootUids.forEach(visit);
    return [...visited];
  };

  interface SourceResolution {
    readonly source: ResolvedSource;
    readonly participatingUids: readonly string[];
  }

  const resolveSource = (
    label: string,
    name: string | null,
    config: SourceConfig,
    globalMediaPopulate: BffViewsConfig['mediaPopulate'],
    errors: string[],
  ): SourceResolution | null => {
    const fail = (message: string): null => {
      errors.push(`${label}: ${message}`);
      return null;
    };

    const schema = contentTypeSchema(config.contentType);
    if (!schema) return fail(`unknown content type '${config.contentType}'`);
    const attributes = schema.attributes ?? {};
    const planner: ViewPlannerConfig = config.planner;

    const many = config.many === true;
    if (many && schema.kind !== 'collectionType') {
      return fail(`\`many: true\` requires a collection type - '${config.contentType}' is not one`);
    }
    // A composite single source has no lookup, so on a collection type it
    // would serve an arbitrary document; keyed views (name === null) are the
    // only unnamed sources on collections and they filter by lookup.
    if (!many && name !== null && schema.kind !== 'singleType') {
      return fail(
        `single source on collection type '${config.contentType}' would return an arbitrary document; ` +
          `use \`many: true\` (with a \`limit\`) or point it at a single type`,
      );
    }
    if (many && config.limit === undefined) {
      strapi.log.warn(
        `[bff-views] ${label}: \`many: true\` without \`limit\` returns the whole '${config.contentType}' collection; set a limit`,
      );
    }

    // Private attributes are stripped by content-API sanitization after the
    // query runs, so serving one through a view is impossible - configuring it
    // is always a mistake and must fail loudly instead of yielding a response
    // that silently lacks the field.
    const failIfPrivate = (field: string, attribute: RawAttribute): boolean => {
      if (attribute.private !== true) return false;
      fail(
        `planner selects '${field}' but it is \`private: true\` on '${config.contentType}' - ` +
          `content-API sanitization always strips private attributes, so it can never be served; ` +
          `remove it from the planner or unmark it in the schema`,
      );
      return true;
    };

    for (const field of planner.fields ?? []) {
      const attribute = attributes[field];
      if (field === 'documentId') continue;
      if (!attribute)
        return fail(`planner field '${field}' does not exist on '${config.contentType}'`);
      if (NON_SCALAR_TYPES.has(attribute.type)) {
        return fail(
          `planner field '${field}' is of type '${attribute.type}' - only scalar fields belong in \`planner.fields\``,
        );
      }
      if (failIfPrivate(field, attribute)) return null;
    }

    const dzComponents: Record<string, readonly string[]> = {};
    for (const zone of planner.dynamicZones ?? []) {
      const attribute = attributes[zone];
      if (attribute?.type !== 'dynamiczone') {
        return fail(`'${zone}' is not a dynamic zone on '${config.contentType}'`);
      }
      if (failIfPrivate(zone, attribute)) return null;
      dzComponents[zone] = attribute.components ?? [];
    }

    const componentFieldUids: Record<string, string> = {};
    for (const field of planner.componentFields ?? []) {
      const attribute = attributes[field];
      if (attribute?.type !== 'component' || !attribute.component) {
        return fail(`'${field}' is not a component field on '${config.contentType}'`);
      }
      if (failIfPrivate(field, attribute)) return null;
      componentFieldUids[field] = attribute.component;
    }

    const mediaFieldMultiples: Record<string, boolean> = {};
    for (const field of planner.mediaFields ?? []) {
      const attribute = attributes[field];
      if (attribute?.type !== 'media') {
        return fail(`'${field}' is not a media field on '${config.contentType}'`);
      }
      if (failIfPrivate(field, attribute)) return null;
      mediaFieldMultiples[field] = attribute.multiple ?? false;
    }

    const relationTargets: string[] = [];
    for (const [field, overlay] of Object.entries(planner.relations ?? {})) {
      const attribute = attributes[field];
      if (attribute?.type !== 'relation') {
        return fail(`'${field}' is not a relation field on '${config.contentType}'`);
      }
      if (failIfPrivate(field, attribute)) return null;
      if (attribute.target) {
        relationTargets.push(attribute.target);
        if (overlay !== true) {
          relationTargets.push(...overlayPopulateTargets(attribute.target, overlay.populate));
        }
      }
    }

    for (const componentUid of Object.keys(planner.components ?? {})) {
      if (!componentSchema(componentUid)) {
        return fail(`planner.components override references unknown component '${componentUid}'`);
      }
    }

    const reachableComponents = collectComponentUids([
      ...Object.values(dzComponents).flat(),
      ...Object.values(componentFieldUids),
    ]);

    return {
      source: {
        name,
        contentType: config.contentType,
        many,
        limit: config.limit,
        planner,
        coreFields: [...new Set([...(planner.fields ?? []), 'documentId'])],
        dzComponents,
        componentFieldUids,
        mediaFieldMultiples,
        mediaPopulate: planner.mediaPopulate ?? globalMediaPopulate,
      },
      participatingUids: [
        ...new Set([
          config.contentType,
          ...reachableComponents,
          ...componentRelationTargets(reachableComponents),
          ...relationTargets,
        ]),
      ],
    };
  };

  const resolveView = (
    id: string,
    view: ViewConfig,
    config: BffViewsConfig,
    errors: string[],
  ): ResolvedView | null => {
    const fail = (message: string): null => {
      errors.push(`view '${id}': ${message}`);
      return null;
    };

    for (const transformerName of view.transforms ?? []) {
      if (!config.transformers?.[transformerName]) {
        return fail(`unknown transformer '${transformerName}'`);
      }
    }

    const paramNames = pathParamNames(view.path);
    const kind: ViewKind =
      view.sources !== undefined ? 'composite' : paramNames.length === 1 ? 'keyed' : 'singleton';

    const resolutions: SourceResolution[] = [];
    if (kind === 'composite') {
      for (const [name, source] of Object.entries(view.sources ?? {})) {
        const resolution = resolveSource(
          `view '${id}' source '${name}'`,
          name,
          source,
          config.mediaPopulate,
          errors,
        );
        if (!resolution) return null;
        resolutions.push(resolution);
      }
    } else {
      if (view.contentType === undefined || view.planner === undefined) {
        return fail('`contentType` and `planner` are required for non-composite views');
      }
      const schema = contentTypeSchema(view.contentType);
      if (kind === 'singleton' && schema && schema.kind !== 'singleType') {
        return fail(
          `keyless single-source views require a single type - '${view.contentType}' is a collection; ` +
            `use a keyed path (one parameter + lookup) or a composite source with \`many: true\``,
        );
      }
      if (kind === 'keyed') {
        if (view.lookup === undefined) return fail('`lookup` is required for keyed views');
        const attributes = schema?.attributes ?? {};
        if (schema && view.lookup.field !== 'documentId' && !attributes[view.lookup.field]) {
          return fail(
            `lookup field '${view.lookup.field}' does not exist on '${view.contentType}'`,
          );
        }
      }
      const resolution = resolveSource(
        `view '${id}'`,
        null,
        { contentType: view.contentType, planner: view.planner },
        config.mediaPopulate,
        errors,
      );
      if (!resolution) return null;
      resolutions.push(resolution);
    }

    return {
      id,
      kind,
      path: view.path,
      keyParam: kind === 'keyed' ? (paramNames[0] ?? 'key') : null,
      lookup: kind === 'keyed' ? (view.lookup ?? null) : null,
      sources: resolutions.map((resolution) => resolution.source),
      transforms: view.transforms,
      enrich: view.enrich,
      assemble: view.assemble,
      cache: view.cache,
      allowPreview: view.allowPreview,
      participatingUids: [
        ...new Set(resolutions.flatMap((resolution) => resolution.participatingUids)),
      ],
    };
  };

  const resolve = (): readonly ResolvedView[] => {
    const config = (strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined) ?? {};
    const errors: string[] = [];

    const views = Object.entries(config.views ?? {})
      .map(([id, view]) => resolveView(id, view, config, errors))
      .filter((view): view is ResolvedView => view !== null);

    const seenPaths = new Map<string, string>();
    for (const view of views) {
      if (STATIC_ROUTE_PATHS.has(view.path)) {
        errors.push(`view '${view.id}': path '${view.path}' collides with a plugin route`);
      }
      const owner = seenPaths.get(view.path);
      if (owner) {
        errors.push(`views '${owner}' and '${view.id}' declare the same path '${view.path}'`);
      }
      seenPaths.set(view.path, view.id);
    }

    if (errors.length > 0) {
      throw new Error(`[bff-views] invalid view configuration:\n- ${errors.join('\n- ')}`);
    }

    return views;
  };

  const getViews = (): readonly ResolvedView[] => {
    if (!resolved) resolved = resolve();
    return resolved;
  };

  // Serializable contract for external schema generators: plain data only -
  // hooks become presence flags, transformers their match specs.
  //
  // CONTRACT - load-bearing beyond this manifest's shape. External schema
  // generators (e.g. strapi-plugin-content-schemas) also depend on runtime
  // behaviors the manifest cannot express:
  // - the response envelope ({ data, meta: { view } } on success,
  //     { data: null, error: { status, name, message } } on error),
  // - the transformer walk stopping at relation boundaries,
  // - mediaFields being served with the FULL upload entity,
  // - keyed/singleton data = the (assembled) document; composite data = the
  //     object of named source results (many sources -> arrays, absent single
  //     sources -> null).
  // Change those behaviors only together with a manifest version bump.
  const describeViews = (): ViewManifest => {
    const config = (strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined) ?? {};

    const describeSource = (source: ResolvedSource): SourceManifestEntry => ({
      contentType: source.contentType,
      many: source.many,
      ...(source.limit !== undefined && { limit: source.limit }),
      fields: source.coreFields,
      componentFields: source.componentFieldUids,
      mediaFields: Object.fromEntries(
        Object.entries(source.mediaFieldMultiples).map(([name, multiple]) => [name, { multiple }]),
      ),
      ...(source.mediaPopulate !== undefined && { mediaPopulate: source.mediaPopulate }),
      dynamicZones: source.dzComponents,
      relations: source.planner.relations ?? {},
      componentOverrides: source.planner.components ?? {},
    });

    const toEntry = (view: ResolvedView): ViewManifestEntry => {
      const shared = {
        id: view.id,
        path: view.path,
        kind: view.kind,
        transforms: (view.transforms ?? []).flatMap((name) => {
          const transformer = config.transformers?.[name];
          return transformer ? [{ name, match: transformer.match }] : [];
        }),
        hasEnrich: view.enrich !== undefined,
        hasAssemble: view.assemble !== undefined,
      };

      if (view.kind === 'composite') {
        return {
          ...shared,
          sources: Object.fromEntries(
            view.sources.map((source) => [source.name ?? '', describeSource(source)]),
          ),
        };
      }

      const root = view.sources[0] as ResolvedSource;
      return {
        ...shared,
        ...(view.keyParam !== null && { keyParam: view.keyParam }),
        ...(view.lookup !== null && { lookup: { field: view.lookup.field } }),
        // Flat shape identical to pre-0.2.0 manifests plus additive kind/many.
        ...describeSource(root),
      };
    };

    return { manifestVersion: MANIFEST_VERSION, views: getViews().map(toEntry) };
  };

  return {
    getViews,
    getView: (id: string): ResolvedView | undefined => getViews().find((view) => view.id === id),
    validateOrThrow: (): void => {
      getViews();
    },
    describeViews,
  };
};

export default viewRegistry;
