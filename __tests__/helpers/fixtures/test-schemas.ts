// Raw Strapi schema fixtures (the shape found in strapi.contentTypes /
// strapi.components) with DZ-heavy content types, nested components, and
// relations - shared by view-registry, planner, and pipeline unit tests.

export const createTestContentTypes = () => ({
  'api::page.page': {
    uid: 'api::page.page',
    kind: 'collectionType',
    info: { singularName: 'page', pluralName: 'pages', displayName: 'Page' },
    attributes: {
      id: { type: 'integer' },
      documentId: { type: 'string' },
      title: { type: 'string', required: true },
      slug: { type: 'uid', required: true },
      summary: { type: 'text' },
      secret: { type: 'string', private: true },
      seo: { type: 'component', component: 'shared.seo', repeatable: false },
      modules: {
        type: 'dynamiczone',
        components: ['content.hero', 'content.faq'],
      },
      author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
      password: { type: 'password' },
    },
  },

  'api::product.product': {
    uid: 'api::product.product',
    kind: 'collectionType',
    info: { singularName: 'product', pluralName: 'products', displayName: 'Product' },
    attributes: {
      id: { type: 'integer' },
      documentId: { type: 'string' },
      name: { type: 'string', required: true },
      slug: { type: 'uid', required: true },
      price: { type: 'decimal' },
      cover: { type: 'media', multiple: false },
      modules: {
        type: 'dynamiczone',
        components: ['content.hero', 'content.faq'],
      },
      extras: {
        type: 'dynamiczone',
        components: ['content.faq'],
      },
      variants: { type: 'relation', relation: 'oneToMany', target: 'api::variant.variant' },
      category: { type: 'relation', relation: 'manyToOne', target: 'api::category.category' },
    },
  },

  'api::author.author': {
    uid: 'api::author.author',
    kind: 'collectionType',
    info: { singularName: 'author', pluralName: 'authors', displayName: 'Author' },
    attributes: {
      name: { type: 'string', required: true },
    },
  },

  'api::variant.variant': {
    uid: 'api::variant.variant',
    kind: 'collectionType',
    info: { singularName: 'variant', pluralName: 'variants', displayName: 'Variant' },
    attributes: {
      sku: { type: 'string', required: true },
      price: { type: 'decimal' },
    },
  },

  'api::category.category': {
    uid: 'api::category.category',
    kind: 'collectionType',
    info: { singularName: 'category', pluralName: 'categories', displayName: 'Category' },
    attributes: {
      title: { type: 'string', required: true },
      slug: { type: 'uid', required: true },
      brand: { type: 'relation', relation: 'manyToOne', target: 'api::brand.brand' },
    },
  },

  'api::brand.brand': {
    uid: 'api::brand.brand',
    kind: 'collectionType',
    info: { singularName: 'brand', pluralName: 'brands', displayName: 'Brand' },
    attributes: {
      name: { type: 'string', required: true },
    },
  },

  'api::site-config.site-config': {
    uid: 'api::site-config.site-config',
    kind: 'singleType',
    info: {
      singularName: 'site-config',
      pluralName: 'site-configs',
      displayName: 'Site Config',
    },
    attributes: {
      documentId: { type: 'string' },
      title: { type: 'string', required: true },
      tagline: { type: 'richtext' },
      seo: { type: 'component', component: 'shared.seo', repeatable: false },
      promo: { type: 'media', multiple: false },
    },
  },
});

export const createTestComponents = () => ({
  'shared.seo': {
    uid: 'shared.seo',
    category: 'shared',
    info: { displayName: 'SEO' },
    attributes: {
      metaTitle: { type: 'string', required: true },
      metaDescription: { type: 'text' },
      metaImage: { type: 'media', multiple: false },
    },
  },

  'content.hero': {
    uid: 'content.hero',
    category: 'content',
    info: { displayName: 'Hero' },
    attributes: {
      title: { type: 'richtext', required: true },
      image: { type: 'media', multiple: false },
      buttons: { type: 'component', component: 'content.button', repeatable: true },
    },
  },

  'content.button': {
    uid: 'content.button',
    category: 'content',
    info: { displayName: 'Button' },
    attributes: {
      label: { type: 'string', required: true },
      url: { type: 'string', required: true },
      linkedPage: { type: 'relation', relation: 'oneToOne', target: 'api::page.page' },
    },
  },

  'content.faq': {
    uid: 'content.faq',
    category: 'content',
    info: { displayName: 'FAQ' },
    attributes: {
      title: { type: 'string' },
      items: { type: 'component', component: 'content.faq-item', repeatable: true },
    },
  },

  'content.faq-item': {
    uid: 'content.faq-item',
    category: 'content',
    info: { displayName: 'FAQ Item' },
    attributes: {
      question: { type: 'string', required: true },
      answer: { type: 'richtext', required: true },
    },
  },
});

export const createValidViewsConfig = () => ({
  transformers: {
    'uppercase-richtext': {
      match: { fieldType: 'richtext' },
      transform: (value: unknown) => String(value).toUpperCase(),
    },
  },
  views: {
    'page-view': {
      contentType: 'api::page.page',
      path: '/page-view/:key',
      lookup: { field: 'slug' },
      allowPreview: true,
      planner: {
        fields: ['title', 'slug', 'summary'],
        dynamicZones: ['modules'],
        componentFields: ['seo'],
        relations: { author: true },
      },
      transforms: ['uppercase-richtext'],
    },
    'product-view': {
      contentType: 'api::product.product',
      path: '/product-view/:slug',
      lookup: { field: 'slug' },
      planner: {
        fields: ['name', 'slug', 'price'],
        dynamicZones: ['modules', 'extras'],
        mediaFields: ['cover'],
        relations: {
          variants: { fields: ['sku', 'price'] },
          category: { fields: ['title', 'slug'], populate: {} },
        },
        concurrency: 4,
      },
      enrich: async (draft: unknown, _ctx: unknown) => ({
        ...(draft as Record<string, unknown>),
        enriched: true,
      }),
      assemble: async (merged: unknown) => ({ product: merged }),
    },
    'site-config': {
      contentType: 'api::site-config.site-config',
      path: '/site-config',
      planner: {
        fields: ['title', 'tagline'],
        componentFields: ['seo'],
        mediaFields: ['promo'],
      },
      allowPreview: true,
    },
    chrome: {
      path: '/chrome',
      sources: {
        config: {
          contentType: 'api::site-config.site-config',
          planner: { fields: ['title'] },
        },
        categories: {
          contentType: 'api::category.category',
          many: true,
          planner: { fields: ['title', 'slug'] },
        },
      },
      transforms: ['uppercase-richtext'],
      cache: { enabled: true },
    },
  },
});
