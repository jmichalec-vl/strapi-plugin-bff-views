import fs from 'node:fs';
import path from 'node:path';

const ADMIN_USER = {
  username: 'admin',
  email: 'admin@test.com',
  password: 'Admin1234!',
  firstname: 'Test',
  lastname: 'Admin',
};

const depth = __dirname.includes(path.join('dist', 'src')) ? 2 : 1;
const appRoot = path.resolve(__dirname, ...Array.from({ length: depth }, () => '..'));
const TOKEN_FILE = path.join(appRoot, '.tmp', 'api-token.txt');
const SCOPED_TOKEN_FILE = path.join(appRoot, '.tmp', 'scoped-token.txt');

const ensureAdminUser = async (strapi: any): Promise<void> => {
  const existingAdmin = await strapi.db.query('admin::user').findOne({
    where: { email: ADMIN_USER.email },
  });
  if (existingAdmin) return;

  const superAdminRole = await strapi.db.query('admin::role').findOne({
    where: { code: 'strapi-super-admin' },
  });
  if (!superAdminRole) return;

  const hashedPassword = await strapi.service('admin::auth').hashPassword(ADMIN_USER.password);
  await strapi.db.query('admin::user').create({
    data: {
      ...ADMIN_USER,
      password: hashedPassword,
      isActive: true,
      blocked: false,
      roles: [superAdminRole.id],
    },
  });
};

const ensureApiToken = async (strapi: any): Promise<void> => {
  if (fs.existsSync(TOKEN_FILE)) return;

  const tokenService = strapi.service('admin::api-token');
  const token = await tokenService.create({
    name: 'e2e-test-token',
    description: 'Full-access token for e2e tests',
    type: 'full-access',
    lifespan: null,
  });
  fs.writeFileSync(TOKEN_FILE, token.accessKey, 'utf-8');
};

// Full-access tokens bypass scope checks entirely, so per-view permission
// tests need a custom token granted only the page-view action.
const ensureScopedApiToken = async (strapi: any): Promise<void> => {
  if (fs.existsSync(SCOPED_TOKEN_FILE)) return;

  const tokenService = strapi.service('admin::api-token');
  const token = await tokenService.create({
    name: 'e2e-scoped-token',
    description: 'Token granted only plugin::bff-views.view.page-view',
    type: 'custom',
    permissions: ['plugin::bff-views.view.page-view'],
    lifespan: null,
  });
  fs.writeFileSync(SCOPED_TOKEN_FILE, token.accessKey, 'utf-8');
};

const seedProducts = async (strapi: any): Promise<void> => {
  const category = await strapi.documents('api::category.category').create({
    data: { name: 'Skincare', description: 'Skincare products' },
  });

  const related = await strapi.documents('api::product.product').create({
    data: {
      name: 'Gadget',
      sku: 'GADGET-1',
      price: 5,
      quantity: 3,
      isActive: true,
      internalNotes: 'gadget internal notes',
      fulfillmentOptions: [
        {
          __component: 'catalog.one-time-option',
          sku: 'GADGET-1-OT',
          price: 5,
          fulfillmentMethod: 'virtual',
        },
      ],
    },
  });

  const widget = await strapi.documents('api::product.product').create({
    data: {
      name: 'Widget',
      sku: 'WIDGET-1',
      price: 25.5,
      quantity: 10,
      isActive: true,
      internalNotes: 'widget internal notes - must never leak',
      metadata: { source: 'seed' },
      tags: [
        { name: 'bestseller', color: '#ff0000' },
        { name: 'new', color: '#00ff00' },
      ],
      fulfillmentOptions: [
        {
          __component: 'catalog.one-time-option',
          sku: 'WIDGET-1-OT',
          price: 25.5,
          fulfillmentMethod: 'shipped',
        },
        {
          __component: 'catalog.subscription-option',
          sku: 'WIDGET-1-SUB',
          recurringCost: 19.5,
          fulfillmentMethod: 'shipped',
          intervalDays: 30,
          initialDelayDays: 0,
        },
      ],
      productMetadata: [
        {
          __component: 'catalog.operations-metadata',
          isOperationsMetadata: true,
          category: 'skincare',
          internalCode: 'OPS-INTERNAL - must never leak',
        },
      ],
      category: category.documentId,
      relatedProduct: related.documentId,
    },
  });

  await strapi.documents('api::product-variant.product-variant').create({
    data: {
      variantName: 'Widget Small',
      sku: 'WIDGET-1-S',
      price: 19.5,
      fulfillmentOptions: [
        {
          __component: 'catalog.one-time-option',
          sku: 'WIDGET-1-S-OT',
          price: 19.5,
          fulfillmentMethod: 'shipped',
        },
      ],
      product: widget.documentId,
    },
  });

  await strapi.documents('api::product-variant.product-variant').create({
    data: {
      variantName: 'Widget Large',
      sku: 'WIDGET-1-L',
      price: 29.5,
      fulfillmentOptions: [
        {
          __component: 'catalog.one-time-option',
          sku: 'WIDGET-1-L-OT',
          price: 29.5,
          fulfillmentMethod: 'shipped',
        },
      ],
      product: widget.documentId,
    },
  });
};

const seedPages = async (strapi: any): Promise<void> => {
  const home = await strapi.documents('api::page.page').create({
    data: {
      title: 'Home',
      slug: 'home',
      removeFooterLinks: false,
      seo: {
        metaTitle: 'Home | Test',
        metaDescription: 'Home page for e2e tests',
        excludeFromSitemap: false,
      },
      modules: [
        {
          __component: 'modules.hero-section',
          title: 'welcome to the test suite',
          subtitle: 'subtitle text',
          align: 'left',
          textColor: '#FFFFFF',
          buttons: [{ text: 'Shop now', link: '/products', variant: 'primary' }],
        },
        {
          __component: 'modules.content-block',
          content: 'rich content body',
          hasWideContent: true,
        },
        {
          __component: 'modules.faq-section',
          title: 'FAQ',
          faqItems: [
            { question: 'Does it work', answer: 'yes it does' },
            { question: 'Is it fast', answer: 'very fast' },
          ],
        },
        {
          __component: 'modules.content-block',
          content: 'second content block',
          hasWideContent: false,
        },
      ],
    },
  });
  await strapi.documents('api::page.page').publish({ documentId: home.documentId });

  // Draft-only page: served with publicationState=preview, 404 otherwise.
  await strapi.documents('api::page.page').create({
    data: {
      title: 'Draft Only',
      slug: 'draft-only',
      modules: [
        {
          __component: 'modules.content-block',
          content: 'draft content',
        },
      ],
    },
  });
};

const seedChrome = async (strapi: any): Promise<void> => {
  const header = await strapi.documents('api::header.header').create({
    data: {
      links: [
        { text: 'Shop', url: '/shop' },
        { text: 'About', url: '/about' },
      ],
    },
  });
  await strapi.documents('api::header.header').publish({ documentId: header.documentId });

  const footer = await strapi.documents('api::footer.footer').create({
    data: {
      title: 'Footer title',
      subtitle: 'footer subtitle markdown',
      copyrightNotice: 'copyright notice',
      showEmailSignUp: true,
      links: [{ text: 'Terms', url: '/terms' }],
    },
  });
  await strapi.documents('api::footer.footer').publish({ documentId: footer.documentId });
  // announcement intentionally NOT seeded - e2e asserts the keyless 404

  // Nested-override fixture: a category promo (hero-section) whose button
  // links a page - only reachable through a `components` override on the
  // nested modules.button (the generated populate excludes relations).
  const homePage = await strapi.documents('api::page.page').findFirst({
    filters: { slug: 'home' },
    status: 'published',
  });
  const skincare = await strapi.documents('api::category.category').findFirst({
    filters: { name: 'Skincare' },
  });
  await strapi.documents('api::category.category').update({
    documentId: skincare.documentId,
    data: {
      promo: {
        title: 'Skincare promo',
        align: 'left',
        textColor: '#FFFFFF',
        buttons: [
          { text: 'Shop now', link: '/shop', variant: 'primary', linkedPage: homePage.documentId },
        ],
      },
    },
  });
};

const ensureSeedData = async (strapi: any): Promise<void> => {
  const existing = await strapi.documents('api::page.page').findFirst({
    filters: { slug: 'home' },
    status: 'draft',
  });
  if (existing) return;

  await seedProducts(strapi);
  await seedPages(strapi);
  await seedChrome(strapi);
};

export default {
  async bootstrap({ strapi }: { strapi: any }) {
    await ensureAdminUser(strapi);
    await ensureApiToken(strapi);
    await ensureScopedApiToken(strapi);
    await ensureSeedData(strapi);
  },
};
