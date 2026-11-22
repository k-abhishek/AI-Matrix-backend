export interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeout?: number;
}

export type AuthTokenProvider = () => string | null | Promise<string | null>;

/**
 * Resolves and normalizes the backend API base URL from environment variables.
 * Handles trailing slashes, surrounding quotes, and ensures the '/api' prefix is preserved.
 */
export function resolveApiBaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '/api';

  // Strip wrapping quotes and trailing whitespace/slashes
  let clean = rawUrl.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  if (!clean) return '/api';

  // Ensure /api suffix exists on the base URL (unless it's just '/')
  if (!clean.endsWith('/api')) {
    clean = `${clean}/api`;
  }

  return clean;
}

const DEFAULT_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

class ApiClient {
  private baseURL: string;
  private defaultTimeout: number;
  private tokenProvider: AuthTokenProvider | null = null;

  constructor(baseURL: string = DEFAULT_BASE_URL, defaultTimeout = 15000) {
    this.baseURL = resolveApiBaseUrl(baseURL);
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Register a token provider function for future authentication
   * e.g. setAuthTokenProvider(() => localStorage.getItem('token'))
   */
  public setAuthTokenProvider(provider: AuthTokenProvider | null) {
    this.tokenProvider = provider;
  }

  public async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = await this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public getUrl(path: string, params?: RequestOptions['params']): string {
    return this.buildUrl(path, params);
  }

  private async getAuthToken(): Promise<string | null> {
    if (!this.tokenProvider) return null;
    try {
      return await this.tokenProvider();
    } catch {
      return null;
    }
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const isAbsolute = /^https?:\/\//i.test(this.baseURL);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

    const fullBase = isAbsolute
      ? this.baseURL.replace(/\/+$/, '')
      : `${origin}${this.baseURL.startsWith('/') ? '' : '/'}${this.baseURL}`.replace(/\/+$/, '');

    const url = new URL(`${fullBase}${cleanPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Preserve full absolute origin for cross-origin backend deployments
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
  }

  public async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, body, timeout = this.defaultTimeout, headers: customHeaders, ...init } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = new Headers(customHeaders);
    if (!headers.has('Content-Type') && body !== undefined && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    // Attach Bearer token if token provider is configured
    const token = await this.getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const url = this.buildUrl(path, params);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        body: body !== undefined ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      const data = isJson ? await response.json() : null;

      if (!response.ok) {
        const errorMessage =
          data?.message ||
          data?.error ||
          `Request failed with status ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  public get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  public patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  public put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  public delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
export default apiClient;

