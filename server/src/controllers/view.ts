import type { Core } from '@strapi/types';

import type { ControllerCtx } from '../types';
import { PLUGIN_ID } from '../constants';
import { getService } from '../utils';

/**
 * One dynamically named method per configured view (plus `status`). The method
 * name is what makes each view an individually grantable content-api permission
 * action: handler `view.<viewId>` -> action `plugin::bff-views.view.<viewId>`.
 */
const createViewController = ({ strapi }: { strapi: Core.Strapi }) => {
  const views = getService(strapi, 'view-registry').getViews();

  const render =
    (viewId: string) =>
    async (ctx: ControllerCtx): Promise<void> => {
      const result = await getService(strapi, 'pipeline').run(viewId, ctx);
      ctx.status = result.status;
      ctx.body = result.body;
    };

  return {
    status: (ctx: ControllerCtx): void => {
      ctx.body = { plugin: PLUGIN_ID, views: views.map((view) => view.id) };
    },
    manifest: (ctx: ControllerCtx): void => {
      ctx.body = getService(strapi, 'view-registry').describeViews();
    },
    ...Object.fromEntries(views.map((view) => [view.id, render(view.id)])),
  };
};

export default createViewController;
