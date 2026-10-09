import type { Core } from '@strapi/types';

import type {
  ComponentRegistry,
  ContentTypeIR,
  MediaPopulateConfig,
  RuntimePopulateValue,
} from '../types';
import {
  buildComponentRegistry,
  readContentTypeIR,
  type RawSchemaRecord,
} from '../utils/schema-ir';
import { buildComponentPopulateTree, type PopulateOverrides } from '../utils/populate-tree';

/**
 * Single access point for schema IR and generated populate trees. Results are
 * memoized per service instance - content types and components are immutable
 * after Strapi loads (dev auto-reload restarts the process).
 */
const irBridge = ({ strapi }: { strapi: Core.Strapi }) => {
  let registry: ComponentRegistry | null = null;
  const contentTypeCache = new Map<string, ContentTypeIR | undefined>();
  const populateCache = new Map<string, RuntimePopulateValue>();

  const getComponentRegistry = (): ComponentRegistry => {
    if (!registry) {
      registry = buildComponentRegistry((strapi.components ?? {}) as unknown as RawSchemaRecord);
    }
    return registry;
  };

  const getContentTypeIR = (uid: string): ContentTypeIR | undefined => {
    if (!contentTypeCache.has(uid)) {
      contentTypeCache.set(
        uid,
        readContentTypeIR(strapi.contentTypes as unknown as RawSchemaRecord, uid),
      );
    }
    return contentTypeCache.get(uid);
  };

  const buildComponentPopulate = (
    uid: string,
    mediaPopulate?: MediaPopulateConfig,
    overrides?: PopulateOverrides,
  ): RuntimePopulateValue => {
    // Views can carry different media narrowing and different override maps -
    // cache per (uid, narrowing, overrides). Override maps are small static
    // config objects, so serializing them into the key is cheap and stable.
    const cacheId = `${uid}|${mediaPopulate ? mediaPopulate.fields.join(',') : 'full'}|${
      overrides ? JSON.stringify(overrides) : 'none'
    }`;
    const cached = populateCache.get(cacheId);
    if (cached !== undefined) return cached;
    const tree = buildComponentPopulateTree(
      uid,
      getComponentRegistry(),
      mediaPopulate,
      undefined,
      overrides,
    );
    populateCache.set(cacheId, tree);
    return tree;
  };

  return { getComponentRegistry, getContentTypeIR, buildComponentPopulate };
};

export default irBridge;
