import { describe, it, expect } from 'vitest';

import { get } from './helpers/api';

describe('fully populated page tree (plan -> execute -> merge)', () => {
  it('returns DZ entries fully populated with nested components, in core order', async () => {
    const { status, body } = await get('/api/bff-views/page-view/home');

    expect(status).toBe(200);
    const modules = body.data.modules as Record<string, unknown>[];

    expect(modules.map((m) => m.__component)).toEqual([
      'modules.hero-section',
      'modules.content-block',
      'modules.faq-section',
      'modules.content-block',
    ]);

    const hero = modules[0] as { title: string; buttons: { text: string }[] };
    expect(hero.title).toBe('WELCOME TO THE TEST SUITE');
    expect(hero.buttons).toHaveLength(1);
    expect(hero.buttons[0]).toMatchObject({ text: 'Shop now', link: '/products' });

    const faq = modules[2] as { faqItems: { question: string; answer: string }[] };
    expect(faq.faqItems.map((i) => i.question)).toEqual(['Does it work!!', 'Is it fast!!']);
    expect(faq.faqItems.map((i) => i.answer)).toEqual(['YES IT DOES', 'VERY FAST']);
  });

  it('applies richtext transformers to top-level DZ component fields', async () => {
    const { body } = await get('/api/bff-views/page-view/home');

    const blocks = (body.data.modules as { __component: string; content?: string }[]).filter(
      (m) => m.__component === 'modules.content-block',
    );
    expect(blocks.map((b) => b.content)).toEqual(['RICH CONTENT BODY', 'SECOND CONTENT BLOCK']);
  });
});

describe('fully populated product tree (relations + assemble hook)', () => {
  it('returns the assembled shape with relations attached', async () => {
    const { status, body } = await get('/api/bff-views/product-view/WIDGET-1');

    expect(status).toBe(200);
    expect(body.data.assembledBy).toBe('product-view');

    const product = body.data.product as Record<string, unknown>;
    expect(product.name).toBe('Widget');
    expect(product.sku).toBe('WIDGET-1');

    const variants = product.variants as { variantName: string; sku: string }[];
    expect(variants.map((v) => v.sku).sort()).toEqual(['WIDGET-1-L', 'WIDGET-1-S']);

    expect(product.category).toMatchObject({ name: 'Skincare' });
    expect(product.relatedProduct).toMatchObject({ name: 'Gadget', sku: 'GADGET-1' });
  });

  it('fully populates both dynamic zones and component fields', async () => {
    const { body } = await get('/api/bff-views/product-view/WIDGET-1');
    const product = body.data.product as Record<string, unknown>;

    const fulfillment = product.fulfillmentOptions as Record<string, unknown>[];
    expect(fulfillment.map((f) => f.__component)).toEqual([
      'catalog.one-time-option',
      'catalog.subscription-option',
    ]);
    expect(fulfillment[0]).toMatchObject({ sku: 'WIDGET-1-OT', fulfillmentMethod: 'shipped' });
    expect(fulfillment[1]).toMatchObject({ sku: 'WIDGET-1-SUB', intervalDays: 30 });

    const metadata = product.productMetadata as Record<string, unknown>[];
    expect(metadata[0]).toMatchObject({
      __component: 'catalog.operations-metadata',
      category: 'skincare',
    });

    const tags = product.tags as { name: string }[];
    expect(tags.map((t) => t.name)).toEqual(['bestseller', 'new']);
  });

  it('populates root media fields in the core query', async () => {
    const { body } = await get('/api/bff-views/product-view/WIDGET-1');
    const product = body.data.product as Record<string, unknown>;

    // No uploads are seeded - presence of the keys proves the populate ran
    // (absent media populates come back as null/[]).
    expect('images' in product).toBe(true);
    expect('thumbnail' in product).toBe(true);
  });
});

describe('sanitization (private fields never leak)', () => {
  it('strips private top-level fields and private component fields', async () => {
    const { body } = await get('/api/bff-views/product-view/WIDGET-1');
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('must never leak');
    expect(serialized).not.toContain('internalNotes');
    expect(serialized).not.toContain('internalCode');
  });
});
