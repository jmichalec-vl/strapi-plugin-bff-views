import type { Core } from '@strapi/types';

import type { BffViewsConfig } from '../types';
import { DEFAULT_MAX_IN_FLIGHT_QUERIES, PLUGIN_ID } from '../constants';
import { createSemaphore } from '../utils/concurrency';

/**
 * Process-wide ceiling on concurrent Document Service calls issued by views.
 * Per-request `planner.concurrency` bounds one request; this bounds all of
 * them together so a traffic spike queues here instead of exhausting the
 * database pool shared with the admin and the rest of the content API.
 */
const queryGate = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get(`plugin::${PLUGIN_ID}`) as BffViewsConfig | undefined;
  const semaphore = createSemaphore(config?.maxInFlightQueries ?? DEFAULT_MAX_IN_FLIGHT_QUERIES);

  return { run: semaphore.run, inFlight: semaphore.inFlight };
};

export default queryGate;
