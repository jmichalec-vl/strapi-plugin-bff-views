import type { Schema, Struct } from '@strapi/strapi';

export interface CatalogAssociatedVariant extends Struct.ComponentSchema {
  collectionName: 'components_catalog_associated_variants';
  info: {
    displayName: 'Associated Variant';
  };
  attributes: {
    variant: Schema.Attribute.Relation<'oneToOne', 'api::product-variant.product-variant'>;
  };
}

export interface CatalogMarketingMetadata extends Struct.ComponentSchema {
  collectionName: 'components_catalog_marketing_metadata';
  info: {
    displayName: 'Marketing Metadata';
  };
  attributes: {
    category: Schema.Attribute.Enumeration<
      [
        'skincare',
        'haircare',
        'supplements',
        'consultation',
        'lab_test',
        'merchandise',
        'gift_card',
      ]
    > &
      Schema.Attribute.Required;
    isMarketingMetadata: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
  };
}

export interface CatalogOneTimeOption extends Struct.ComponentSchema {
  collectionName: 'components_catalog_one_time_options';
  info: {
    displayName: 'One Time Option';
  };
  attributes: {
    associatedVariants: Schema.Attribute.Component<'catalog.associated-variant', true>;
    fulfillmentMethod: Schema.Attribute.Enumeration<['shipped', 'local pickup', 'virtual']> &
      Schema.Attribute.Required;
    price: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    sku: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface CatalogOperationsMetadata extends Struct.ComponentSchema {
  collectionName: 'components_catalog_operations_metadata';
  info: {
    displayName: 'Operations Metadata';
  };
  attributes: {
    category: Schema.Attribute.Enumeration<['skincare', 'haircare', 'supplements', 'lab_test']> &
      Schema.Attribute.Required;
    internalCode: Schema.Attribute.String & Schema.Attribute.Private;
    isOperationsMetadata: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
  };
}

export interface CatalogSubscriptionOption extends Struct.ComponentSchema {
  collectionName: 'components_catalog_subscription_options';
  info: {
    displayName: 'Subscription Option';
  };
  attributes: {
    associatedVariants: Schema.Attribute.Component<'catalog.associated-variant', true>;
    fulfillmentMethod: Schema.Attribute.Enumeration<['shipped', 'local pickup', 'virtual']> &
      Schema.Attribute.Required;
    initialDelayDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<90>;
    intervalDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<90>;
    recurringCost: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    sku: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ModulesButton extends Struct.ComponentSchema {
  collectionName: 'components_modules_buttons';
  info: {
    displayName: 'Button';
  };
  attributes: {
    backgroundColor: Schema.Attribute.String;
    link: Schema.Attribute.String & Schema.Attribute.Required;
    linkedPage: Schema.Attribute.Relation<'oneToOne', 'api::page.page'>;
    text: Schema.Attribute.String & Schema.Attribute.Required;
    textColor: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['primary', 'secondary', 'tertiary']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'primary'>;
  };
}

export interface ModulesContentBlock extends Struct.ComponentSchema {
  collectionName: 'components_modules_content_blocks';
  info: {
    displayName: 'Content Block';
  };
  attributes: {
    content: Schema.Attribute.RichText & Schema.Attribute.Required;
    hasWideContent: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface ModulesFaqItem extends Struct.ComponentSchema {
  collectionName: 'components_modules_faq_items';
  info: {
    displayName: 'FAQ Item';
  };
  attributes: {
    answer: Schema.Attribute.RichText & Schema.Attribute.Required;
    question: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ModulesFaqSection extends Struct.ComponentSchema {
  collectionName: 'components_modules_faq_sections';
  info: {
    displayName: 'FAQ Section';
  };
  attributes: {
    faqItems: Schema.Attribute.Component<'modules.faq-item', true> &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ModulesHeroSection extends Struct.ComponentSchema {
  collectionName: 'components_modules_hero_sections';
  info: {
    displayName: 'Hero Section';
  };
  attributes: {
    align: Schema.Attribute.Enumeration<['left', 'center']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'left'>;
    buttons: Schema.Attribute.Component<'modules.button', true>;
    description: Schema.Attribute.RichText;
    image: Schema.Attribute.Media<'images'>;
    mobileImage: Schema.Attribute.Media<'images'>;
    subtitle: Schema.Attribute.RichText;
    textColor: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'#FFFFFF'>;
    title: Schema.Attribute.RichText & Schema.Attribute.Required;
  };
}

export interface ModulesImageSection extends Struct.ComponentSchema {
  collectionName: 'components_modules_image_sections';
  info: {
    displayName: 'Image Section';
  };
  attributes: {
    desktopImage: Schema.Attribute.Media<'images'>;
    image: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    removePadding: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    width: Schema.Attribute.Enumeration<['standard', 'full_width']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'standard'>;
  };
}

export interface ModulesProductGrid extends Struct.ComponentSchema {
  collectionName: 'components_modules_product_grids';
  info: {
    displayName: 'Product Grid';
  };
  attributes: {
    description: Schema.Attribute.Text;
    products: Schema.Attribute.Relation<'oneToMany', 'api::product.product'>;
    promoTiles: Schema.Attribute.Component<'modules.promo-tile', true>;
    title: Schema.Attribute.String;
  };
}

export interface ModulesPromoTile extends Struct.ComponentSchema {
  collectionName: 'components_modules_promo_tiles';
  info: {
    displayName: 'Promo Tile';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    link: Schema.Attribute.String & Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ModulesReviewSection extends Struct.ComponentSchema {
  collectionName: 'components_modules_review_sections';
  info: {
    displayName: 'Review Section';
  };
  attributes: {
    background: Schema.Attribute.Media<'images'>;
    isVisible: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    products: Schema.Attribute.Relation<'oneToMany', 'api::product.product'>;
    reviewType: Schema.Attribute.Enumeration<['company_reviews', 'product_reviews']> &
      Schema.Attribute.DefaultTo<'company_reviews'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface NavigationDropdown extends Struct.ComponentSchema {
  collectionName: 'components_navigation_dropdowns';
  info: {
    displayName: 'Dropdown';
  };
  attributes: {
    sections: Schema.Attribute.Component<'navigation.dropdown-section', true>;
    textColor: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface NavigationDropdownSection extends Struct.ComponentSchema {
  collectionName: 'components_navigation_dropdown_sections';
  info: {
    displayName: 'Dropdown Section';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'>;
    links: Schema.Attribute.Component<'navigation.link', true>;
    sectionLink: Schema.Attribute.String;
    sectionTitle: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface NavigationFooterSection extends Struct.ComponentSchema {
  collectionName: 'components_navigation_footer_sections';
  info: {
    displayName: 'Footer Section';
  };
  attributes: {
    isContent: Schema.Attribute.Boolean & Schema.Attribute.Required;
    links: Schema.Attribute.Component<'navigation.link', true>;
    sectionContent: Schema.Attribute.RichText;
    sectionLink: Schema.Attribute.String & Schema.Attribute.Required;
    sectionTitle: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface NavigationIconLink extends Struct.ComponentSchema {
  collectionName: 'components_navigation_icon_links';
  info: {
    displayName: 'Icon Link';
  };
  attributes: {
    iconImage: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface NavigationLink extends Struct.ComponentSchema {
  collectionName: 'components_navigation_links';
  info: {
    displayName: 'Link';
  };
  attributes: {
    icon: Schema.Attribute.Enumeration<['profile', 'notepad', 'gear']>;
    text: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedMetaSocial extends Struct.ComponentSchema {
  collectionName: 'components_shared_meta_socials';
  info: {
    displayName: 'Meta Social';
  };
  attributes: {
    description: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 65;
      }>;
    image: Schema.Attribute.Media<'images'>;
    socialNetwork: Schema.Attribute.Enumeration<['Facebook', 'Twitter']> &
      Schema.Attribute.Required;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    displayName: 'SEO';
  };
  attributes: {
    canonicalURL: Schema.Attribute.String;
    excludeFromSitemap: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaImage: Schema.Attribute.Media<'images'>;
    metaSocial: Schema.Attribute.Component<'shared.meta-social', true>;
    metaTitle: Schema.Attribute.Text & Schema.Attribute.Required;
    structuredData: Schema.Attribute.JSON;
  };
}

export interface SharedTag extends Struct.ComponentSchema {
  collectionName: 'components_shared_tags';
  info: {
    displayName: 'Tag';
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#000000'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'catalog.associated-variant': CatalogAssociatedVariant;
      'catalog.marketing-metadata': CatalogMarketingMetadata;
      'catalog.one-time-option': CatalogOneTimeOption;
      'catalog.operations-metadata': CatalogOperationsMetadata;
      'catalog.subscription-option': CatalogSubscriptionOption;
      'modules.button': ModulesButton;
      'modules.content-block': ModulesContentBlock;
      'modules.faq-item': ModulesFaqItem;
      'modules.faq-section': ModulesFaqSection;
      'modules.hero-section': ModulesHeroSection;
      'modules.image-section': ModulesImageSection;
      'modules.product-grid': ModulesProductGrid;
      'modules.promo-tile': ModulesPromoTile;
      'modules.review-section': ModulesReviewSection;
      'navigation.dropdown': NavigationDropdown;
      'navigation.dropdown-section': NavigationDropdownSection;
      'navigation.footer-section': NavigationFooterSection;
      'navigation.icon-link': NavigationIconLink;
      'navigation.link': NavigationLink;
      'shared.meta-social': SharedMetaSocial;
      'shared.seo': SharedSeo;
      'shared.tag': SharedTag;
    }
  }
}
