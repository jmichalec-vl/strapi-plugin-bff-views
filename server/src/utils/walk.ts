import type { AttributeIR, ComponentRegistry, ContentTypeIR, FieldCtx } from '../types';

export interface AttributeVisit {
  readonly path: readonly (string | number)[];
  readonly value: unknown;
  readonly ctx: FieldCtx;
}

// Relations are not descended into: their attributes belong to other content
// types and are only present in the shallow shapes the overlays selected.
const CONTAINER_TYPES = new Set(['component', 'dynamiczone', 'relation']);

/**
 * IR-guided document walk: attribute types come from the schema IR, so field
 * matching never guesses from runtime values. Returns every scalar-ish leaf
 * with its path and typed context.
 */
export const collectAttributeVisits = (
  document: Readonly<Record<string, unknown>>,
  contentType: ContentTypeIR,
  registry: ComponentRegistry,
): readonly AttributeVisit[] => {
  const visits: AttributeVisit[] = [];

  const visitEntry = (
    entry: unknown,
    componentUid: string,
    path: readonly (string | number)[],
  ): void => {
    const component = registry[componentUid];
    if (!component || typeof entry !== 'object' || entry === null) return;
    visitObject(entry as Record<string, unknown>, component.attributes, component.uid, path);
  };

  const visitAttribute = (
    value: unknown,
    attribute: AttributeIR,
    containerUid: string,
    path: readonly (string | number)[],
  ): void => {
    if (attribute.type === 'component' && attribute.componentUID) {
      if (Array.isArray(value)) {
        value.forEach((entry, index) =>
          visitEntry(entry, attribute.componentUID as string, [...path, index]),
        );
      } else {
        visitEntry(value, attribute.componentUID, path);
      }
      return;
    }

    if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((entry, index) => {
        const uid = (entry as { __component?: string } | null)?.__component;
        if (uid) visitEntry(entry, uid, [...path, index]);
      });
      return;
    }

    if (CONTAINER_TYPES.has(attribute.type)) return;

    visits.push({ path, value, ctx: { path, attribute, containerUid } });
  };

  const visitObject = (
    obj: Readonly<Record<string, unknown>>,
    attributes: readonly AttributeIR[],
    containerUid: string,
    path: readonly (string | number)[],
  ): void => {
    for (const attribute of attributes) {
      const value = obj[attribute.name];
      if (value === undefined || value === null) continue;
      visitAttribute(value, attribute, containerUid, [...path, attribute.name]);
    }
  };

  visitObject(document, contentType.attributes, contentType.uid, []);
  return visits;
};

export const getAtPath = (
  root: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
): unknown =>
  path.reduce<unknown>(
    (node, segment) =>
      typeof node === 'object' && node !== null
        ? (node as Record<string | number, unknown>)[segment]
        : undefined,
    root,
  );

export const setAtPath = (
  root: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void => {
  const parent = getAtPath(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (typeof parent === 'object' && parent !== null && last !== undefined) {
    (parent as Record<string | number, unknown>)[last] = value;
  }
};
