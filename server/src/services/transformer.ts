import type { Core } from '@strapi/types';

import type { AttributeIR, BffViewsConfig, TransformerConfig, TransformerFn } from '../types';
import { PLUGIN_ID } from '../constants';
import { getService } from '../utils';
import { collectAttributeVisits, getAtPath, setAtPath } from '../utils/walk';

interface CompiledTransformer {
  readonly matches: (attribute: AttributeIR) => boolean;
  readonly transform: TransformerFn;
}

// Regexes are compiled once per transformer, not once per field visit.
const compile = (config: TransformerConfig): CompiledTransformer => {
  const { fieldType, fieldName } = config.match;
  const namePattern = fieldName !== undefined ? new RegExp(fieldName) : undefined;
  return {
    matches: (attribute) =>
      (fieldType === undefined || attribute.type === fieldType) &&
      (namePattern === undefined || namePattern.test(attribute.name)),
    transform: config.transform,
  };
};

/**
 * Applies configured field transformers over a document tree of the given
 * content type (composite views call this once per source, each with its own
 * schema IR). The walk is IR-guided (attribute types from the schema, not
 * guessed from values). Transformers run sequentially in configured order;
 * within one transformer all matching fields run in a single Promise.all batch
 * so async transforms (e.g. MDX serialization) can parallelize internally.
 */
const transformer = ({ strapi }: { strapi: Core.Strapi }) => {
  let compiled: Readonly<Record<string, CompiledTransformer>> | null = null;

  const configured = (): Readonly<Record<string, CompiledTransformer>> => {
    if (compiled) return compiled;
    const config = strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined;
    compiled = Object.fromEntries(
      Object.entries(config?.transformers ?? {}).map(([name, entry]) => [name, compile(entry)]),
    );
    return compiled;
  };

  const apply = async (
    tree: unknown,
    contentTypeUid: string,
    names: readonly string[],
  ): Promise<unknown> => {
    if (names.length === 0 || typeof tree !== 'object' || tree === null) return tree;

    const irBridge = getService(strapi, 'ir-bridge');
    const contentType = irBridge.getContentTypeIR(contentTypeUid);
    if (!contentType) return tree;
    const registry = irBridge.getComponentRegistry();

    const transformers = configured();
    const clone = structuredClone(tree);
    const documents = (Array.isArray(clone) ? clone : [clone]) as Record<string, unknown>[];

    for (const name of names) {
      const entry = transformers[name];
      if (!entry) continue;

      for (const document of documents) {
        // Re-collect per transformer so each one sees the previous one's output.
        const visits = collectAttributeVisits(document, contentType, registry).filter((visit) =>
          entry.matches(visit.ctx.attribute),
        );

        const results = await Promise.all(
          visits.map((visit) =>
            Promise.resolve(entry.transform(getAtPath(document, visit.path), visit.ctx)),
          ),
        );

        visits.forEach((visit, index) => setAtPath(document, visit.path, results[index]));
      }
    }

    return clone;
  };

  return { apply };
};

export default transformer;
