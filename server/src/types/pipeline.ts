import type { DocumentStatus } from './view';

export interface ViewRequestCtx {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly state: { readonly auth?: unknown };
}

export interface ControllerCtx extends ViewRequestCtx {
  status: number;
  body: unknown;
}

export interface RequestParams {
  readonly key: string;
  readonly status: DocumentStatus;
  readonly locale: string | undefined;
  readonly explain: boolean;
  readonly auth: unknown;
}

export interface PipelineResult {
  readonly status: number;
  readonly body: unknown;
}
