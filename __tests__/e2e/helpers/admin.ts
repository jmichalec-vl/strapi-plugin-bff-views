import { BASE_URL } from './api';

const ADMIN_CREDENTIALS = {
  email: 'admin@test.com',
  password: 'Admin1234!',
} as const;

let cachedAdminToken: string | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; data: unknown }> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cachedAdminToken ? { Authorization: `Bearer ${cachedAdminToken}` } : {}),
      ...options.headers,
    },
  });

  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;

  return { status: response.status, data };
};

export const login = async (retries = 3): Promise<string> => {
  if (cachedAdminToken) return cachedAdminToken;

  for (let attempt = 0; attempt < retries; attempt++) {
    const { status, data } = await request('/admin/login', {
      method: 'POST',
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });

    if (status === 429) {
      await sleep((attempt + 1) * 2000);
      continue;
    }

    const token = (data as { data?: { token?: string } })?.data?.token;
    if (!token) {
      throw new Error(`Login failed (${status}): ${JSON.stringify(data)}`);
    }

    cachedAdminToken = token;
    return token;
  }

  throw new Error('Login failed: rate limited after all retries');
};

export const updateDraft = async (
  uid: string,
  documentId: string,
  data: Record<string, unknown>,
): Promise<void> => {
  const { status, data: body } = await request(
    `/content-manager/collection-types/${uid}/${documentId}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
  if (status !== 200) {
    throw new Error(`Draft update failed (${status}): ${JSON.stringify(body)}`);
  }
};

export const publish = async (uid: string, documentId: string): Promise<void> => {
  const { status, data } = await request(
    `/content-manager/collection-types/${uid}/${documentId}/actions/publish`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (status !== 200) {
    throw new Error(`Publish failed (${status}): ${JSON.stringify(data)}`);
  }
};
