import type { Core } from '@strapi/types';

import type {
  QueryPlan,
  RelationOverlay,
  ResolvedSource,
  RuntimePopulateValue,
  SubQuery,
} from '../types';
import { getService } from '../utils';

const isFlatOverlay = (overlay: RelationOverlay): boolean =>
  overlay === true || overlay.populate === undefined;

/**
 * Builds the parallel sub-query plan from a source's core-query result.
 * Enforced invariant: no sub-query ever populates more than one component type
 * or more than one relation group - a whole-document deep populate is never
 * emitted (that shape is the known-slow path this plugin exists to avoid).
 */
const planner = ({ strapi }: { strapi: Core.Strapi }) => {
  const componentPopulate = (view: ResolvedSource, componentUid: string): RuntimePopulateValue =>
    getService(strapi, 'ir-bridge').buildComponentPopulate(
      componentUid,
      view.mediaPopulate,
      view.planner.components,
    );

  // One sub-query per unique component type actually present in each zone -
  // absent component types cost nothing.
  const dzSubQueries = (
    view: ResolvedSource,
    core: Readonly<Record<string, unknown>>,
  ): readonly SubQuery[] =>
    (view.planner.dynamicZones ?? []).flatMap((zone) => {
      const entries = core[zone];
      if (!Array.isArray(entries)) return [];

      const presentUids = [
        ...new Set(
          entries
            .map((entry) => (entry as { __component?: string }).__component)
            .filter((uid): uid is string => typeof uid === 'string'),
        ),
      ];

      return presentUids.map((componentUid) => ({
        id: `dz:${zone}:${componentUid}`,
        kind: 'dz-component' as const,
        uid: view.contentType,
        zone,
        componentUid,
        params: {
          fields: ['documentId'],
          populate: { [zone]: { on: { [componentUid]: componentPopulate(view, componentUid) } } },
        },
      }));
    });

  // Relations come exclusively from hand-written overlays (the generated
  // populate emits none by design). Flat overlays share one grouped query;
  // any overlay with its own nested populate gets a dedicated query.
  const relationSubQueries = (view: ResolvedSource): readonly SubQuery[] => {
    const overlays = Object.entries(view.planner.relations ?? {});
    const flat = overlays.filter(([, overlay]) => isFlatOverlay(overlay));
    const nested = overlays.filter(([, overlay]) => !isFlatOverlay(overlay));

    const grouped: readonly SubQuery[] =
      flat.length > 0
        ? [
            {
              id: 'relations:group',
              kind: 'relation-group',
              uid: view.contentType,
              relationFields: flat.map(([field]) => field),
              params: {
                fields: ['documentId'],
                populate: Object.fromEntries(
                  flat.map(([field, overlay]) => [
                    field,
                    overlay === true ? true : { fields: overlay.fields },
                  ]),
                ),
              },
            },
          ]
        : [];

    const dedicated = nested.map(([field, overlay]): SubQuery => {
      const config = overlay as Exclude<RelationOverlay, true>;
      return {
        id: `relation:${field}`,
        kind: 'relation',
        uid: view.contentType,
        relationFields: [field],
        params: {
          fields: ['documentId'],
          populate: {
            [field]: {
              ...(config.fields !== undefined && { fields: config.fields }),
              populate: config.populate,
            },
          },
        },
      };
    });

    return [...grouped, ...dedicated];
  };

  const plan = (view: ResolvedSource, core: Readonly<Record<string, unknown>>): QueryPlan => ({
    subQueries: [...dzSubQueries(view, core), ...relationSubQueries(view)],
  });

  return { plan };
};

export default planner;
