export type MaybePromise<T> = T | Promise<T>;

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder('utf-8');

export interface CommandResult {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
  contentType: string;
}

export function ok(text = '', options: { contentType?: string } = {}): CommandResult {
  return {
    stdout: textEncoder.encode(text),
    stderr: '',
    exitCode: 0,
    contentType: options.contentType ?? 'text/plain',
  };
}

export function okBytes(data: Uint8Array, contentType = 'application/octet-stream'): CommandResult {
  return {
    stdout: data,
    stderr: '',
    exitCode: 0,
    contentType,
  };
}

export function err(message: string, options: { exitCode?: number } = {}): CommandResult {
  return {
    stdout: new Uint8Array(),
    stderr: message,
    exitCode: options.exitCode ?? 1,
    contentType: 'text/plain',
  };
}

export interface SearchHit {
  title: string;
  snippet: string;
  source?: string;
}

export interface SearchAdapter {
  search(query: string, limit?: number): MaybePromise<SearchHit[]>;
}

export interface FetchResponse {
  contentType: string;
  payload: unknown;
}

export interface FetchAdapter {
  fetch(resource: string): MaybePromise<FetchResponse>;
}

export interface ToolAdapters {
  search?: SearchAdapter;
  fetch?: FetchAdapter;
}

export interface MemoryItem {
  id: number;
  text: string;
  createdEpochMs: number;
  metadata: Record<string, unknown>;
}
