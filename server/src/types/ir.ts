// Schema IR: a normalized view of Strapi content-type/component schemas, built
// by utils/schema-ir.ts and consumed by the populate builder and the
// transformer walk. AttributeIR is public API - transformers receive it as
// FieldCtx.attribute.

export type StrapiAttributeType =
  | 'string'
  | 'text'
  | 'richtext'
  | 'email'
  | 'password'
  | 'uid'
  | 'boolean'
  | 'integer'
  | 'biginteger'
  | 'float'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'blocks'
  | 'enumeration'
  | 'media'
  | 'relation'
  | 'component'
  | 'dynamiczone';

export interface AttributeIR {
  readonly name: string;
  readonly type: StrapiAttributeType;
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  readonly componentUID?: string;
  readonly componentUIDs?: readonly string[];
  readonly repeatable?: boolean;
  readonly relationKind?: 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';
  readonly relationTarget?: string;
  readonly mediaMultiple?: boolean;
  readonly unique?: boolean;
  readonly defaultValue?: string | number | boolean;
  readonly mediaAllowedTypes?: readonly string[];
}

export interface ContentTypeIR {
  readonly uid: string;
  readonly singularName: string;
  readonly pluralName: string;
  readonly displayName: string;
  readonly kind: 'collectionType' | 'singleType';
  readonly attributes: readonly AttributeIR[];
}

export interface ComponentIR {
  readonly uid: string;
  readonly category: string;
  readonly displayName: string;
  readonly attributes: readonly AttributeIR[];
}

export interface ComponentRegistry {
  readonly [uid: string]: ComponentIR;
}

export type RuntimePopulateValue =
  | true
  | { readonly fields: readonly string[] }
  | { readonly populate: Readonly<Record<string, RuntimePopulateValue>> }
  | { readonly on: Readonly<Record<string, RuntimePopulateValue>> };
