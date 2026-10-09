import type { Core } from '@strapi/types';

import { getService } from '../utils';

/**
 * Function-valued router: Strapi instantiates it during initRouting (after all
 * plugin register() hooks, before bootstrap), which is the only window where
 * dynamically configured routes can be added declaratively. It runs exactly
 * once; view-registry validation errors thrown here fail startup.
 *
 * Route `config.auth` is deliberately not set - Strapi derives the per-route
 * auth scope from the handler string (`plugin::bff-views.view.<viewId>`), which
 * is what makes each view individually grantable to scoped API tokens.
 */
const contentApiRouter = ({ strapi }: { strapi: Core.Strapi }) => {
  const views = getService(strapi, 'view-registry').getViews();

  return {
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/status',
        handler: 'view.status',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/manifest',
        handler: 'view.manifest',
        config: { policies: [] },
      },
      ...views.map((view) => ({
        method: 'GET',
        path: view.path,
        handler: `view.${view.id}`,
        config: { policies: [] },
      })),
    ],
  };
};

export default contentApiRouter;
