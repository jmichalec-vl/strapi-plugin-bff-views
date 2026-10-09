import { describe, it, expect } from 'vitest';

import config from '../../../server/src/config';
import { createValidViewsConfig } from '../../helpers/fixtures/test-schemas';

const { validator } = config;

const validView = () => ({
  contentType: 'api::page.page',
  path: '/page-view/:key',
  lookup: { field: 'slug' },
  planner: { fields: ['title'] },
});

const withView = (overrides: Record<string, unknown>) => ({
  views: { 'page-view': { ...validView(), ...overrides } },
});

describe('config validator', () => {
  it('accepts undefined and empty config', () => {
    expect(() => validator(undefined)).not.toThrow();
    expect(() => validator({})).not.toThrow();
  });

  it('accepts a fully populated valid config', () => {
    expect(() => validator(createValidViewsConfig())).not.toThrow();
  });

  it('rejects non-object config', () => {
    expect(() => validator('nope')).toThrow('[bff-views]');
  });

  describe('view ids', () => {
    it.each(['Page', 'page.view', '-page', 'page-', 'page_view'])(
      'rejects invalid view id %s',
      (id) => {
        expect(() => validator({ views: { [id]: validView() } })).toThrow('is invalid');
      },
    );

    it('rejects reserved view ids', () => {
      expect(() => validator({ views: { status: validView() } })).toThrow('reserved');
    });
  });

  describe('view shape', () => {
    it('rejects a missing content type uid', () => {
      expect(() => validator(withView({ contentType: 'page' }))).toThrow('content-type uid');
    });

    it('rejects a path without leading slash', () => {
      expect(() => validator(withView({ path: 'page/:key' }))).toThrow("starting with '/'");
    });

    it('rejects a path with more than one parameter', () => {
      expect(() => validator(withView({ path: '/page/:a/:b' }))).toThrow('at most one');
    });

    it('rejects lookup on a parameterless path', () => {
      expect(() => validator(withView({ path: '/page' }))).toThrow(
        '`lookup` is only valid for keyed views',
      );
    });

    it('accepts a parameterless path without lookup as a singleton view', () => {
      expect(() =>
        validator({
          views: {
            'page-view': {
              contentType: 'api::page.page',
              path: '/page',
              planner: { fields: ['title'] },
            },
          },
        }),
      ).not.toThrow();
    });

    it('rejects a missing lookup field', () => {
      expect(() => validator(withView({ lookup: {} }))).toThrow('lookup.field');
    });

    it('rejects a planner that selects nothing', () => {
      expect(() => validator(withView({ planner: { fields: [] } }))).toThrow(
        'must select at least one',
      );
      expect(() => validator(withView({ planner: {} }))).toThrow('must select at least one');
    });

    it('accepts a planner without fields when it selects something else', () => {
      expect(() => validator(withView({ planner: { componentFields: ['seo'] } }))).not.toThrow();
      expect(() =>
        validator(withView({ planner: { fields: [], relations: { author: true } } })),
      ).not.toThrow();
    });

    it('rejects non-array planner fields', () => {
      expect(() => validator(withView({ planner: { fields: 'title' } }))).toThrow(
        'array of field names',
      );
    });

    it('rejects a non-integer concurrency', () => {
      expect(() => validator(withView({ planner: { fields: ['title'], concurrency: 0 } }))).toThrow(
        'positive integer',
      );
    });

    it('rejects invalid relation overlays', () => {
      expect(() =>
        validator(withView({ planner: { fields: ['title'], relations: { author: false } } })),
      ).toThrow('must be `true` or an object');
    });

    it('rejects a non-boolean allowPreview', () => {
      expect(() => validator(withView({ allowPreview: 'yes' }))).toThrow(
        '`allowPreview` must be a boolean',
      );
    });

    it('rejects non-function hooks', () => {
      expect(() => validator(withView({ enrich: 'nope' }))).toThrow('`enrich` must be a function');
      expect(() => validator(withView({ assemble: 42 }))).toThrow('`assemble` must be a function');
    });

    it('rejects invalid cache config', () => {
      expect(() => validator(withView({ cache: { enabled: 'yes' } }))).toThrow('cache.enabled');
      expect(() => validator(withView({ cache: { enabled: true, ttlMs: -1 } }))).toThrow(
        'cache.ttlMs',
      );
    });
  });

  describe('composite views', () => {
    const validSources = () => ({
      config: {
        contentType: 'api::site-config.site-config',
        planner: { fields: ['title'] },
      },
    });

    const withCompositeView = (overrides: Record<string, unknown>) => ({
      views: { chrome: { path: '/chrome', sources: validSources(), ...overrides } },
    });

    it('accepts a parameterless composite view with named sources', () => {
      expect(() => validator(withCompositeView({}))).not.toThrow();
    });

    it('rejects sources combined with a top-level content type, lookup, or planner', () => {
      expect(() => validator(withView({ sources: validSources() }))).toThrow('mutually exclusive');
    });

    it('rejects a composite view with a path parameter', () => {
      expect(() => validator(withCompositeView({ path: '/chrome/:key' }))).toThrow('parameterless');
    });

    it('rejects invalid source names', () => {
      expect(() =>
        validator(withCompositeView({ sources: { 'my-source': validSources().config } })),
      ).toThrow('source name');
    });

    it('rejects an empty sources object', () => {
      expect(() => validator(withCompositeView({ sources: {} }))).toThrow('non-empty object');
    });

    it('rejects a non-boolean many flag', () => {
      expect(() =>
        validator(
          withCompositeView({
            sources: { config: { ...validSources().config, many: 'yes' } },
          }),
        ),
      ).toThrow('`many` must be a boolean');
    });
  });

  describe('transformers', () => {
    it('rejects a transformer without match criteria', () => {
      expect(() =>
        validator({ transformers: { t: { match: {}, transform: () => null } } }),
      ).toThrow('fieldType');
    });

    it('rejects an invalid fieldName regex', () => {
      expect(() =>
        validator({
          transformers: { t: { match: { fieldName: '[' }, transform: () => null } },
        }),
      ).toThrow('regular-expression');
    });

    it('rejects a non-function transform', () => {
      expect(() =>
        validator({ transformers: { t: { match: { fieldType: 'richtext' } } } }),
      ).toThrow('`transform` must be a function');
    });
  });

  describe('many-source limit', () => {
    const compositeWith = (source: Record<string, unknown>) => ({
      views: {
        chrome: {
          path: '/chrome',
          sources: {
            items: {
              contentType: 'api::category.category',
              planner: { fields: ['title'] },
              ...source,
            },
          },
        },
      },
    });

    it('accepts a positive integer limit on a many source', () => {
      expect(() => validator(compositeWith({ many: true, limit: 20 }))).not.toThrow();
    });

    it('rejects limit without many: true', () => {
      expect(() => validator(compositeWith({ limit: 20 }))).toThrow('only valid with `many: true`');
    });

    it('rejects a non-positive or fractional limit', () => {
      expect(() => validator(compositeWith({ many: true, limit: 0 }))).toThrow('positive integer');
      expect(() => validator(compositeWith({ many: true, limit: 1.5 }))).toThrow(
        'positive integer',
      );
      expect(() => validator(compositeWith({ many: true, limit: '10' }))).toThrow(
        'positive integer',
      );
    });
  });

  describe('top-level options', () => {
    it('rejects invalid maxInFlightQueries', () => {
      expect(() => validator({ maxInFlightQueries: 0 })).toThrow('maxInFlightQueries');
      expect(() => validator({ maxInFlightQueries: 2.5 })).toThrow('maxInFlightQueries');
      expect(() => validator({ maxInFlightQueries: 16 })).not.toThrow();
    });

    it('rejects invalid cache.maxEntries', () => {
      expect(() => validator({ cache: { maxEntries: 0 } })).toThrow('maxEntries');
    });

    it('rejects invalid explain values', () => {
      expect(() => validator({ explain: 'yes' })).toThrow("'on' or 'off'");
    });

    it('rejects invalid mediaPopulate, globally and per view', () => {
      expect(() => validator({ mediaPopulate: { fields: [] } })).toThrow('mediaPopulate');
      expect(() => validator({ mediaPopulate: ['url'] })).toThrow('mediaPopulate');
      expect(() =>
        validator(withView({ planner: { fields: ['title'], mediaPopulate: { fields: 'url' } } })),
      ).toThrow('mediaPopulate');
    });

    it('aggregates multiple errors into one message', () => {
      let message = '';
      try {
        validator({ explain: 'yes', cache: { maxEntries: 0 } });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('explain');
      expect(message).toContain('maxEntries');
    });
  });
});
