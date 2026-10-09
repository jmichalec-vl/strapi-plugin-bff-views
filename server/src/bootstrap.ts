import type { Core } from '@strapi/types';

import { getService } from './utils';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  // Idempotent - the content-api router already resolves (and thereby
  // validates) the views during initRouting; this guarantees a clear startup
  // failure even if no content-api router was mounted.
  getService(strapi, 'view-registry').validateOrThrow();
  getService(strapi, 'cache').subscribe();
};

export default bootstrap;
