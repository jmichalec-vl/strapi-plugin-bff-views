import path from 'node:path';

const depth = __dirname.includes(path.join('dist', 'config')) ? 5 : 4;
const steps = Array.from({ length: depth }, () => '..');
const pluginRoot = path.resolve(__dirname, ...steps);

export default () => ({
  'bff-views': {
    enabled: true,
    resolve: pluginRoot,
    config: {
      explain: 'on',
      transformers: {
        'uppercase-richtext': {
          match: { fieldType: 'richtext' },
          transform: (value: unknown) => String(value).toUpperCase(),
        },
        'shout-question': {
          match: { fieldName: '^question$' },
          transform: (value: unknown) => `${String(value)}!!`,
        },
      },
      views: {
        // Singleton view (keyless, single type)
        'site-header': {
          contentType: 'api::header.header',
          path: '/site-header',
          planner: {
            fields: ['documentId'],
            componentFields: ['links'],
            dynamicZones: ['dropdowns'],
          },
        },
        // Singleton left unseeded on purpose - exercises the keyless 404
        'announcement-view': {
          contentType: 'api::announcement.announcement',
          path: '/announcement-view',
          planner: { fields: ['title', 'text', 'isVisible'] },
        },
        // Composite keyless view: two single types + one many collection
        chrome: {
          path: '/chrome',
          sources: {
            header: {
              contentType: 'api::header.header',
              planner: { componentFields: ['links'] },
            },
            footer: {
              contentType: 'api::footer.footer',
              planner: {
                fields: ['title', 'subtitle', 'copyrightNotice', 'showEmailSignUp'],
                componentFields: ['links'],
                mediaFields: ['paymentMethodsImage'],
              },
            },
            categories: {
              contentType: 'api::category.category',
              many: true,
              limit: 20,
              planner: {
                fields: ['name', 'description'],
                componentFields: ['promo'],
                // Nested override: modules.button sits INSIDE the promo
                // hero-section - its relation is only populated because
                // overrides apply at any depth of the generated tree.
                components: {
                  'modules.button': {
                    fields: ['text', 'link', 'variant'],
                    populate: { linkedPage: { fields: ['slug'] } },
                  },
                },
              },
            },
          },
          transforms: ['uppercase-richtext'],
          cache: { enabled: true },
        },
        'page-view': {
          contentType: 'api::page.page',
          path: '/page-view/:key',
          lookup: { field: 'slug' },
          allowPreview: true,
          planner: {
            fields: ['title', 'slug', 'removeFooterLinks'],
            dynamicZones: ['modules'],
            componentFields: ['seo'],
          },
          transforms: ['uppercase-richtext', 'shout-question'],
          cache: { enabled: true },
        },
        'product-view': {
          contentType: 'api::product.product',
          path: '/product-view/:key',
          lookup: { field: 'sku' },
          planner: {
            fields: ['name', 'sku', 'price', 'isActive'],
            dynamicZones: ['fulfillmentOptions', 'productMetadata'],
            componentFields: ['tags'],
            mediaFields: ['images', 'thumbnail'],
            relations: {
              variants: { fields: ['variantName', 'sku', 'price'] },
              category: { fields: ['name'] },
              relatedProduct: { fields: ['name', 'sku'] },
            },
            concurrency: 4,
          },
          assemble: (merged: unknown) => ({
            product: merged,
            assembledBy: 'product-view',
          }),
        },
      },
    },
  },
});
