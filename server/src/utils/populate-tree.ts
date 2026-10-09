import type {
  AttributeIR,
  ComponentRegistry,
  MediaPopulateConfig,
  RuntimePopulateValue,
} from '../types';

// Builds runtime populate objects (Document Service `populate` params) from the
// schema IR: media -> `true`, components -> nested `populate`, dynamic zones ->
// `on:` fragments. Relations are intentionally excluded - relation population
// is always an explicit per-view decision (planner.relations overlays), never
// implicit, because unbounded relation traversal is what makes deep populates
// slow in the first place.

const POPULATABLE_TYPES = new Set(['media', 'relation', 'component', 'dynamiczone']);

export type PopulateOverrides = Readonly<Record<string, unknown>>;

const buildAttributePopulate = (
  attr: AttributeIR,
  registry: ComponentRegistry,
  visited: Set<string>,
  mediaPopulate: MediaPopulateConfig | undefined,
  overrides: PopulateOverrides | undefined,
): RuntimePopulateValue | null => {
  // mediaPopulate narrows GENERATED media populate only - explicitly authored
  // populate (mediaFields, overlays, component overrides) never routes here.
  if (attr.type === 'media') return mediaPopulate ? { fields: mediaPopulate.fields } : true;
  if (attr.type === 'relation') return null;

  if (attr.type === 'component' && attr.componentUID) {
    return buildComponentPopulateTree(
      attr.componentUID,
      registry,
      mediaPopulate,
      visited,
      overrides,
    );
  }

  if (attr.type === 'dynamiczone' && attr.componentUIDs) {
    // Strapi rejects `on:` keys for unknown components, so only registered
    // component UIDs may appear in the fragment map.
    const knownUIDs = attr.componentUIDs.filter((uid) => registry[uid]);
    if (knownUIDs.length === 0) return true;
    return {
      on: Object.fromEntries(
        knownUIDs.map((uid) => [
          uid,
          buildComponentPopulateTree(uid, registry, mediaPopulate, visited, overrides),
        ]),
      ),
    };
  }

  return null;
};

export const buildPopulateFromAttributes = (
  attributes: readonly AttributeIR[],
  registry: ComponentRegistry,
  mediaPopulate?: MediaPopulateConfig,
  visited: Set<string> = new Set(),
  overrides?: PopulateOverrides,
): Readonly<Record<string, RuntimePopulateValue>> | null => {
  const entries = attributes
    .filter((attr) => POPULATABLE_TYPES.has(attr.type))
    .map(
      (attr) =>
        [
          attr.name,
          buildAttributePopulate(attr, registry, visited, mediaPopulate, overrides),
        ] as const,
    )
    .filter((entry): entry is [string, RuntimePopulateValue] => entry[1] !== null);

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

export const buildComponentPopulateTree = (
  uid: string,
  registry: ComponentRegistry,
  mediaPopulate?: MediaPopulateConfig,
  visited: Set<string> = new Set(),
  overrides?: PopulateOverrides,
): RuntimePopulateValue => {
  // `planner.components` overrides replace the generated subtree at ANY depth
  // - a component nested inside another (e.g. a slide inside a banner wrapper)
  // is overridable the same way as a top-level one. This is the only way to
  // populate a relation that lives inside a nested component.
  const override = overrides?.[uid];
  if (override !== undefined) return override as RuntimePopulateValue;

  // Cycle guard: a component reachable from itself is populated shallowly.
  if (visited.has(uid)) return true;

  const component = registry[uid];
  if (!component) return true;

  visited.add(uid);
  const nested = buildPopulateFromAttributes(
    component.attributes,
    registry,
    mediaPopulate,
    visited,
    overrides,
  );
  visited.delete(uid);

  return nested ? { populate: nested } : true;
};
