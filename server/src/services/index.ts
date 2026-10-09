import viewRegistry from './view-registry';
import irBridge from './ir-bridge';
import pipeline from './pipeline';
import planner from './planner';
import executor from './executor';
import sanitizer from './sanitizer';
import transformer from './transformer';
import cache from './cache';
import queryGate from './query-gate';

const services = {
  'view-registry': viewRegistry,
  'ir-bridge': irBridge,
  pipeline,
  planner,
  executor,
  sanitizer,
  transformer,
  cache,
  'query-gate': queryGate,
};

export type PluginServices = {
  readonly [K in keyof typeof services]: ReturnType<(typeof services)[K]>;
};

export default services;
