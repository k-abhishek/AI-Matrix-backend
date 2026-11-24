export interface FetchResult {
  url: string;
  finalUrl: string;
  html: string;
  httpStatus: number;
  contentBytes: number;
  fetchDurationMs: number;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  delayMs?: number;
  allowedHosts?: string[];
  signal?: AbortSignal;
}

