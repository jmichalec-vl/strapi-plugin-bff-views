import type { Core } from '@strapi/types';

import type { PluginServices } from '../services';
import { PLUGIN_ID } from '../constants';

// The single typed boundary to Strapi's untyped service registry: every
// caller gets the real service shape instead of `any`.
export const getService = <K extends keyof PluginServices>(
  strapi: Core.Strapi,
  name: K,
): PluginServices[K] => strapi.plugin(PLUGIN_ID).service(name) as PluginServices[K];
