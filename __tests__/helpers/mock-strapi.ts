import { vi } from 'vitest';

export const createMockStrapi = () => {
  const services = new Map<string, Record<string, unknown>>();
  const pluginConfigs = new Map<string, unknown>();

  const findFirst = vi.fn();
  const findMany = vi.fn();

  const mockStrapi = {
    contentTypes: {} as Record<string, Record<string, unknown>>,
    components: {} as Record<string, Record<string, unknown>>,

    plugin: vi.fn((pluginId: string) => ({
      service: vi.fn((name: string) => services.get(`${pluginId}::${name}`) ?? {}),
    })),

    config: {
      get: vi.fn((key: string) => pluginConfigs.get(key)),
    },

    documents: vi.fn(() => ({ findFirst, findMany })),

    getModel: vi.fn((uid: string) => mockStrapi.contentTypes[uid] ?? mockStrapi.components[uid]),

    contentAPI: {
      sanitize: {
        output: vi.fn(async (data: unknown) => data),
      },
    },

    db: {
      lifecycles: {
        subscribe: vi.fn(),
      },
    },

    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };

  return {
    strapi: mockStrapi,
    services,
    findFirst,
    findMany,

    setContentTypes: (types: Record<string, Record<string, unknown>>) => {
      mockStrapi.contentTypes = types;
    },

    setComponents: (components: Record<string, Record<string, unknown>>) => {
      mockStrapi.components = components;
    },

    registerService: (pluginId: string, name: string, svc: Record<string, unknown>) => {
      services.set(`${pluginId}::${name}`, svc);
    },

    setPluginConfig: (pluginId: string, config: unknown) => {
      pluginConfigs.set(`plugin::${pluginId}`, config);
    },
  };
};

export type MockStrapi = ReturnType<typeof createMockStrapi>;
