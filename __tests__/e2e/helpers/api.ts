import * as fs from 'node:fs';
import * as path from 'node:path';

const STRAPI_APP_DIR = path.resolve(__dirname, '..', 'strapi-app');

export const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';

export const readToken = (): string =>
  fs.readFileSync(path.join(STRAPI_APP_DIR, '.tmp', 'api-token.txt'), 'utf-8').trim();

export const readScopedToken = (): string =>
  fs.readFileSync(path.join(STRAPI_APP_DIR, '.tmp', 'scoped-token.txt'), 'utf-8').trim();

export interface ApiResponse {
  readonly status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: any;
}

export const get = async (pathname: string, token: string = readToken()): Promise<ApiResponse> => {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

export const getAnonymous = async (pathname: string): Promise<ApiResponse> => {
  const response = await fetch(`${BASE_URL}${pathname}`);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};
