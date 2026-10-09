import type { AttributeIR, ComponentIR, ComponentRegistry, ContentTypeIR } from '../types';

// Maps raw Strapi schemas (the shape found in strapi.contentTypes /
// strapi.components) into the plugin's IR. Pure functions - callers pass the
// raw records in, which keeps this testable without a Strapi instance.

interface RawAttribute {
  readonly type: string;
  readonly required?: boolean;
  readonly enum?: readonly string[];
  readonly component?: string;
  readonly components?: readonly string[];
  readonly repeatable?: boolean;
  readonly relation?: string;
  readonly target?: string;
  readonly multiple?: boolean;
  readonly unique?: boolean;
  readonly default?: string | number | boolean;
  readonly allowedTypes?: readonly string[];
}

interface RawSchema {
  readonly uid?: string;
  readonly kind?: string;
  readonly info?: {
    readonly singularName?: string;
    readonly pluralName?: string;
    readonly displayName?: string;
  };
  readonly attributes?: Readonly<Record<string, RawAttribute>>;
}

export type RawSchemaRecord = Readonly<Record<string, RawSchema>>;

// Never part of a served payload's content surface: password values are
// secrets, `id` is superseded by documentId, and the admin/i18n bookkeeping
// fields are not content.
const SKIPPED_TYPES = new Set(['password']);
const EXCLUDED_FIELDS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

const mapToAttributeIR = (name: string, attr: RawAttribute): AttributeIR => ({
  name,
  type: attr.type as AttributeIR['type'],
  required: attr.required ?? false,
  ...(attr.enum && { enumValues: attr.enum }),
  ...(attr.component && { componentUID: attr.component }),
  ...(attr.components && { componentUIDs: attr.components }),
  ...(attr.repeatable !== undefined && { repeatable: attr.repeatable }),
  ...(attr.relation && { relationKind: attr.relation as AttributeIR['relationKind'] }),
  ...(attr.target && { relationTarget: attr.target }),
  ...(attr.multiple !== undefined && { mediaMultiple: attr.multiple }),
  ...(attr.unique && { unique: true }),
  ...(attr.default !== undefined && { defaultValue: attr.default }),
  ...(attr.allowedTypes && { mediaAllowedTypes: attr.allowedTypes }),
});

const mapAttributes = (
  attributes: Readonly<Record<string, RawAttribute>>,
  isContentType: boolean,
): readonly AttributeIR[] => {
  const mapped = Object.entries(attributes)
    .filter(([, attr]) => !SKIPPED_TYPES.has(attr.type))
    .filter(([name]) => !EXCLUDED_FIELDS.has(name))
    .map(([name, attr]) => mapToAttributeIR(name, attr));

  // documentId is excluded above (raw schemas vary on declaring it) and
  // re-added synthetically so content-type IRs always expose it.
  if (isContentType) {
    return [{ name: 'documentId', type: 'string', required: true }, ...mapped];
  }
  return mapped;
};

export const readContentTypeIR = (
  contentTypes: RawSchemaRecord,
  uid: string,
): ContentTypeIR | undefined => {
  const schema = contentTypes[uid];
  if (!schema) return undefined;

  return {
    uid,
    singularName: schema.info?.singularName ?? uid,
    pluralName: schema.info?.pluralName ?? uid,
    displayName: schema.info?.displayName ?? uid,
    kind: (schema.kind as ContentTypeIR['kind']) ?? 'collectionType',
    attributes: mapAttributes(schema.attributes ?? {}, true),
  };
};

export const buildComponentRegistry = (components: RawSchemaRecord): ComponentRegistry =>
  Object.fromEntries(
    Object.entries(components).map(([uid, schema]): [string, ComponentIR] => [
      uid,
      {
        uid,
        category: uid.split('.')[0] ?? uid,
        displayName: schema.info?.displayName ?? uid,
        attributes: mapAttributes(schema.attributes ?? {}, false),
      },
    ]),
  );
