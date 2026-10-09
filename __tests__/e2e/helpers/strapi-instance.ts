import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const STRAPI_APP_DIR = path.resolve(__dirname, '..', 'strapi-app');
const DB_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'data.db');
const TOKEN_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'api-token.txt');
const SCOPED_TOKEN_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'scoped-token.txt');
const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';
const STARTUP_TIMEOUT_MS = 120_000;

let strapiProcess: ChildProcess | null = null;

const HEALTH_OK_STATUS = 204;

const isStrapiHealthy = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE_URL}/_health`);
    return response.status === HEALTH_OK_STATUS;
  } catch {
    return false;
  }
};

const waitForHealth = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const check = async () => {
      if (Date.now() - start > STARTUP_TIMEOUT_MS) {
        reject(new Error('Strapi did not start within timeout'));
        return;
      }

      if (await isStrapiHealthy()) {
        resolve();
        return;
      }

      setTimeout(check, 1_000);
    };

    check();
  });

const waitForFile = (filePath: string, label: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > 30_000) {
        reject(new Error(`${label} did not complete within timeout`));
        return;
      }
      if (fs.existsSync(filePath)) {
        resolve();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });

export const setup = async (): Promise<void> => {
  // CI starts Strapi itself (production build + `strapi start`); the harness
  // then only waits for readiness instead of spawning a second instance.
  if (process.env.STRAPI_E2E_EXTERNAL === 'true') {
    console.log('[strapi] External instance mode - waiting for readiness...');
    await waitForHealth();
    await waitForFile(TOKEN_PATH, 'API token creation');
    await waitForFile(SCOPED_TOKEN_PATH, 'Scoped API token creation');
    console.log('[strapi] Ready (external).');
    return;
  }

  for (const file of [DB_PATH, TOKEN_PATH, SCOPED_TOKEN_PATH]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  console.log('[strapi] Starting Strapi in dev mode...');

  strapiProcess = spawn('npx', ['strapi', 'develop'], {
    cwd: STRAPI_APP_DIR,
    env: { ...process.env, NODE_ENV: 'development', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  strapiProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stdout.write(`[strapi] ${line}\n`);
  });

  strapiProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stderr.write(`[strapi:err] ${line}\n`);
  });

  strapiProcess.on('error', (err) => {
    console.error('[strapi] Process error:', err);
  });

  await waitForHealth();
  console.log('[strapi] Health check passed. Waiting for API tokens...');

  await waitForFile(TOKEN_PATH, 'API token creation');
  await waitForFile(SCOPED_TOKEN_PATH, 'Scoped API token creation');
  console.log('[strapi] Ready.');
};

export const teardown = async (): Promise<void> => {
  if (!strapiProcess) return;

  return new Promise((resolve) => {
    strapiProcess!.on('close', () => {
      strapiProcess = null;
      resolve();
    });

    strapiProcess!.kill('SIGTERM');

    setTimeout(() => {
      if (strapiProcess) {
        strapiProcess.kill('SIGKILL');
      }
    }, 5_000);
  });
};
