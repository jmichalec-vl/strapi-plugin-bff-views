export interface Timed<T> {
  readonly result: T;
  readonly ms: number;
}

export const timed = async <T>(fn: () => Promise<T>): Promise<Timed<T>> => {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
};
