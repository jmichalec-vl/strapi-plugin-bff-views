import type { Core } from '@strapi/types';

const register = (_args: { strapi: Core.Strapi }): void => {
  // View routes are registered via the function-valued content-api router
  // (routes/content-api.ts), which Strapi instantiates during initRouting.
};

export default register;
