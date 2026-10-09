import { describe, it, expect } from 'vitest';

import { createSemaphore, mapWithConcurrency } from '../../../../server/src/utils/concurrency';

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const results = await mapWithConcurrency([30, 5, 15], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });

    expect(results).toEqual([30, 5, 15]);
  });

  it('never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });

    expect(peak).toBe(2);
  });

  it('stops starting new work after the first rejection', async () => {
    const started: number[] = [];

    const run = mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      started.push(item);
      await tick();
      if (item === 1) throw new Error('boom');
      return item;
    });

    await expect(run).rejects.toThrow('boom');
    await tick();
    await tick();
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it('handles an empty input and a limit below one', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x)).toEqual([1, 2]);
  });
});

describe('createSemaphore', () => {
  it('runs at most max callbacks at once and queues the rest in order', async () => {
    const semaphore = createSemaphore(2);
    const order: number[] = [];
    let peak = 0;

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        semaphore.run(async () => {
          peak = Math.max(peak, semaphore.inFlight());
          order.push(n);
          await tick();
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(semaphore.inFlight()).toBe(0);
  });

  it('releases the slot when the callback throws', async () => {
    const semaphore = createSemaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    expect(semaphore.inFlight()).toBe(0);
    expect(await semaphore.run(async () => 'next')).toBe('next');
  });
});
