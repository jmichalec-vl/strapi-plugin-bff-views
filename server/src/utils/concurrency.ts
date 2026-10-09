/**
 * Maps items with at most `limit` calls in flight, preserving input order in
 * the result. Rejects with the first error; in-flight calls settle but no new
 * ones start, so a failing request does not keep issuing doomed queries.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
};

export interface Semaphore {
  readonly run: <R>(fn: () => Promise<R>) => Promise<R>;
  readonly inFlight: () => number;
}

/**
 * Counting semaphore: at most `max` callbacks run at once, the rest wait in
 * FIFO order. Used as the process-wide ceiling on Document Service calls so
 * many concurrent view requests cannot starve the database pool.
 */
export const createSemaphore = (max: number): Semaphore => {
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };

  const run = async <R>(fn: () => Promise<R>): Promise<R> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return { run, inFlight: () => active };
};
