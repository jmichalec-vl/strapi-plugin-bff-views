import { RESERVED_VIEW_IDS } from '../constants';

// View ids become controller method names, route handler suffixes, and permission
// action UIDs (`plugin::bff-views.view.<id>`), so dots and other separators are
// forbidden - a dot would break handler resolution in compose-endpoint.
const VIEW_ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Source names become response object keys and generated identifiers.
const SOURCE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

const PATH_PARAM_PATTERN = /:([A-Za-z0-9_]+)/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

const validateMediaPopulate = (context: string, value: unknown, errors: string[]): void => {
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    !isStringArray(value.fields) ||
    (value.fields as readonly string[]).length === 0
  ) {
    errors.push(`${context}: \`mediaPopulate\` must be \`{ fields: [non-empty string array] }\``);
  }
};

const isValidRegExp = (source: string): boolean => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

export const pathParamNames = (path: string): readonly string[] =>
  [...path.matchAll(PATH_PARAM_PATTERN)].map((match) => match[1] ?? '');

const validateTransformers = (transformers: unknown, errors: string[]): void => {
  if (transformers === undefined) return;
  if (!isRecord(transformers)) {
    errors.push('`transformers` must be an object');
    return;
  }

  for (const [name, transformer] of Object.entries(transformers)) {
    if (!isRecord(transformer)) {
      errors.push(`transformer '${name}' must be an object`);
      continue;
    }
    const match = transformer.match;
    if (!isRecord(match) || (match.fieldType === undefined && match.fieldName === undefined)) {
      errors.push(`transformer '${name}': \`match\` must set \`fieldType\` and/or \`fieldName\``);
    } else {
      if (match.fieldType !== undefined && typeof match.fieldType !== 'string') {
        errors.push(`transformer '${name}': \`match.fieldType\` must be a string`);
      }
      if (match.fieldName !== undefined) {
        if (typeof match.fieldName !== 'string' || !isValidRegExp(match.fieldName)) {
          errors.push(
            `transformer '${name}': \`match.fieldName\` must be a valid regular-expression source string`,
          );
        }
      }
    }
    if (typeof transformer.transform !== 'function') {
      errors.push(`transformer '${name}': \`transform\` must be a function`);
    }
  }
};

const validatePlanner = (viewId: string, planner: unknown, errors: string[]): void => {
  if (!isRecord(planner)) {
    errors.push(`view '${viewId}': \`planner\` must be an object`);
    return;
  }

  if (planner.fields !== undefined && !isStringArray(planner.fields)) {
    errors.push(`view '${viewId}': \`planner.fields\` must be an array of field names`);
  }
  // A planner must select something; `fields` alone is optional because some
  // content types have no public scalars (component/relation-only types).
  const selectionKeys = [
    'fields',
    'dynamicZones',
    'componentFields',
    'mediaFields',
    'relations',
  ] as const;
  const selectsAnything = selectionKeys.some((key) => {
    const value = planner[key];
    if (Array.isArray(value)) return value.length > 0;
    return isRecord(value) && Object.keys(value).length > 0;
  });
  if (!selectsAnything) {
    errors.push(
      `view '${viewId}': \`planner\` must select at least one of \`fields\`, \`dynamicZones\`, \`componentFields\`, \`mediaFields\`, or \`relations\``,
    );
  }
  if (planner.dynamicZones !== undefined && !isStringArray(planner.dynamicZones)) {
    errors.push(`view '${viewId}': \`planner.dynamicZones\` must be an array of field names`);
  }
  if (planner.componentFields !== undefined && !isStringArray(planner.componentFields)) {
    errors.push(`view '${viewId}': \`planner.componentFields\` must be an array of field names`);
  }
  if (planner.mediaFields !== undefined && !isStringArray(planner.mediaFields)) {
    errors.push(`view '${viewId}': \`planner.mediaFields\` must be an array of field names`);
  }
  validateMediaPopulate(`view '${viewId}'`, planner.mediaPopulate, errors);
  if (planner.relations !== undefined) {
    if (!isRecord(planner.relations)) {
      errors.push(`view '${viewId}': \`planner.relations\` must be an object`);
    } else {
      for (const [field, overlay] of Object.entries(planner.relations)) {
        if (overlay !== true && !isRecord(overlay)) {
          errors.push(
            `view '${viewId}': relation overlay '${field}' must be \`true\` or an object`,
          );
        }
      }
    }
  }
  if (planner.components !== undefined && !isRecord(planner.components)) {
    errors.push(
      `view '${viewId}': \`planner.components\` must be an object keyed by component uid`,
    );
  }
  if (planner.concurrency !== undefined) {
    const concurrency = planner.concurrency;
    if (!isPositiveInteger(concurrency)) {
      errors.push(`view '${viewId}': \`planner.concurrency\` must be a positive integer`);
    }
  }
};

const validateView = (viewId: string, view: unknown, errors: string[]): void => {
  if (!VIEW_ID_PATTERN.test(viewId)) {
    errors.push(
      `view id '${viewId}' is invalid - ids must match ${VIEW_ID_PATTERN} (lowercase alphanumerics and hyphens)`,
    );
  }
  if (RESERVED_VIEW_IDS.includes(viewId)) {
    errors.push(`view id '${viewId}' is reserved`);
  }
  if (!isRecord(view)) {
    errors.push(`view '${viewId}' must be an object`);
    return;
  }

  let paramCount = -1;
  if (typeof view.path !== 'string' || !view.path.startsWith('/')) {
    errors.push(`view '${viewId}': \`path\` must be a string starting with '/'`);
  } else {
    paramCount = pathParamNames(view.path).length;
    if (paramCount > 1) {
      errors.push(`view '${viewId}': \`path\` must declare at most one parameter`);
    }
  }

  if (view.sources !== undefined) {
    // Composite view: named sources, no top-level content type/lookup/planner.
    if (view.contentType !== undefined || view.lookup !== undefined || view.planner !== undefined) {
      errors.push(
        `view '${viewId}': \`sources\` is mutually exclusive with \`contentType\`/\`lookup\`/\`planner\``,
      );
    }
    if (paramCount > 0) {
      errors.push(`view '${viewId}': composite views must have a parameterless \`path\``);
    }
    if (!isRecord(view.sources) || Object.keys(view.sources).length === 0) {
      errors.push(`view '${viewId}': \`sources\` must be a non-empty object keyed by source name`);
    } else {
      for (const [sourceName, source] of Object.entries(view.sources)) {
        if (!SOURCE_NAME_PATTERN.test(sourceName)) {
          errors.push(
            `view '${viewId}': source name '${sourceName}' is invalid - names must match ${SOURCE_NAME_PATTERN}`,
          );
        }
        if (!isRecord(source)) {
          errors.push(`view '${viewId}': source '${sourceName}' must be an object`);
          continue;
        }
        if (typeof source.contentType !== 'string' || !source.contentType.includes('::')) {
          errors.push(
            `view '${viewId}': source '${sourceName}': \`contentType\` must be a content-type uid string`,
          );
        }
        if (source.many !== undefined && typeof source.many !== 'boolean') {
          errors.push(`view '${viewId}': source '${sourceName}': \`many\` must be a boolean`);
        }
        if (source.limit !== undefined) {
          if (source.many !== true) {
            errors.push(
              `view '${viewId}': source '${sourceName}': \`limit\` is only valid with \`many: true\``,
            );
          } else if (!isPositiveInteger(source.limit)) {
            errors.push(
              `view '${viewId}': source '${sourceName}': \`limit\` must be a positive integer`,
            );
          }
        }
        validatePlanner(`${viewId}' source '${sourceName}`, source.planner, errors);
      }
    }
  } else {
    // Keyed (one path param + lookup) or singleton (no param, no lookup).
    if (typeof view.contentType !== 'string' || !view.contentType.includes('::')) {
      errors.push(`view '${viewId}': \`contentType\` must be a content-type uid string`);
    }
    if (paramCount === 1) {
      if (!isRecord(view.lookup) || typeof view.lookup.field !== 'string') {
        errors.push(`view '${viewId}': \`lookup.field\` must be a string`);
      }
    } else if (paramCount === 0 && view.lookup !== undefined) {
      errors.push(
        `view '${viewId}': \`lookup\` is only valid for keyed views (a \`path\` with one parameter)`,
      );
    }
    validatePlanner(viewId, view.planner, errors);
  }

  if (view.transforms !== undefined && !isStringArray(view.transforms)) {
    errors.push(`view '${viewId}': \`transforms\` must be an array of transformer names`);
  }
  if (view.allowPreview !== undefined && typeof view.allowPreview !== 'boolean') {
    errors.push(`view '${viewId}': \`allowPreview\` must be a boolean`);
  }
  if (view.enrich !== undefined && typeof view.enrich !== 'function') {
    errors.push(`view '${viewId}': \`enrich\` must be a function`);
  }
  if (view.assemble !== undefined && typeof view.assemble !== 'function') {
    errors.push(`view '${viewId}': \`assemble\` must be a function`);
  }
  if (view.cache !== undefined) {
    if (!isRecord(view.cache) || typeof view.cache.enabled !== 'boolean') {
      errors.push(`view '${viewId}': \`cache.enabled\` must be a boolean`);
    } else if (
      view.cache.ttlMs !== undefined &&
      (typeof view.cache.ttlMs !== 'number' || view.cache.ttlMs <= 0)
    ) {
      errors.push(`view '${viewId}': \`cache.ttlMs\` must be a positive number`);
    }
  }
};

const validator = (config: unknown): void => {
  if (config === undefined || config === null) return;
  if (!isRecord(config)) {
    throw new Error('[bff-views] plugin config must be an object');
  }

  const errors: string[] = [];

  validateTransformers(config.transformers, errors);

  if (config.views !== undefined) {
    if (!isRecord(config.views)) {
      errors.push('`views` must be an object keyed by view id');
    } else {
      for (const [viewId, view] of Object.entries(config.views)) {
        validateView(viewId, view, errors);
      }
    }
  }

  if (config.cache !== undefined) {
    if (
      !isRecord(config.cache) ||
      (config.cache.maxEntries !== undefined && !isPositiveInteger(config.cache.maxEntries))
    ) {
      errors.push('`cache.maxEntries` must be a positive integer');
    }
  }

  if (config.maxInFlightQueries !== undefined && !isPositiveInteger(config.maxInFlightQueries)) {
    errors.push('`maxInFlightQueries` must be a positive integer');
  }

  if (config.explain !== undefined && config.explain !== 'on' && config.explain !== 'off') {
    errors.push("`explain` must be 'on' or 'off'");
  }

  validateMediaPopulate('config', config.mediaPopulate, errors);

  if (errors.length > 0) {
    throw new Error(`[bff-views] invalid plugin config:\n- ${errors.join('\n- ')}`);
  }
};

export default {
  default: {
    transformers: {},
    views: {},
    cache: {},
  },
  validator,
};
