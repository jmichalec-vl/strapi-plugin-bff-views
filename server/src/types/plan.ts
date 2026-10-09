export type SubQueryKind = 'dz-component' | 'relation-group' | 'relation' | 'source-many';

export interface SubQuery {
  readonly id: string;
  readonly kind: SubQueryKind;
  /** Content-type UID the query runs against (always the view's content type). */
  readonly uid: string;
  /** Document Service findFirst params. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Dynamic zone name for dz-component queries. */
  readonly zone?: string;
  /** Component UID for dz-component queries. */
  readonly componentUid?: string;
  /** Relation field names resolved by this query. */
  readonly relationFields?: readonly string[];
}

export interface QueryPlan {
  readonly subQueries: readonly SubQuery[];
}

export interface SubResult {
  readonly subQuery: SubQuery;
  readonly document: Readonly<Record<string, unknown>> | null;
  readonly ms: number;
}
