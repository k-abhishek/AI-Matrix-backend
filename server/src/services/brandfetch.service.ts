import logger from '../lib/logger';
import { env } from '../config/env';

export interface BrandfetchColor {
  hex: string;
  type: string;
  brightness?: number;
}

export interface BrandfetchFont {
  name: string;
  type: string;
  origin?: string;
}

export interface BrandfetchLogoFormat {
  src: string;
  background?: string;
  format: string;
  size?: number;
}

export interface BrandfetchLogo {
  theme?: string;
  type: string;
  formats: BrandfetchLogoFormat[];
}

export interface BrandfetchBrandData {
  id: string;
  name: string;
  domain: string;
  claimed?: boolean;
  description?: string;
  longDescription?: string;
  links?: Array<{ name: string; url: string }>;
  logos?: BrandfetchLogo[];
  colors?: BrandfetchColor[];
  fonts?: BrandfetchFont[];
  company?: {
    legalName?: string;
    foundedYear?: number;
    employees?: string;
    industries?: Array<{ id: string; name: string }>;
  };
}

export interface BrandfetchErrorResponse {
  message: string;
  error?: string;
  code?: string;
}

/**
 * Service for fetching comprehensive company brand data (colors, fonts, company info)
 * via the typed Brandfetch Brand API endpoint:
 * GET https://api.brandfetch.io/v2/brands/domain/{domain}
 *
 * Rules:
 * - Must be called from the server only with `Authorization: Bearer {API_KEY}`.
 * - Uses typed route `/v2/brands/domain/{domain}`, not auto-detection.
 * - Handles errors by the `x-bf-error` header code, not the HTTP status alone.
 * - Testable with `brandfetch.com` (free on Brand API).
 */
export class BrandfetchService {
  private readonly baseUrl = 'https://api.brandfetch.io/v2';

  /**
   * Retrieves full brand data for a given domain using the typed route.
   */
  async getBrandByDomain(
    domain: string
  ): Promise<{ success: boolean; data?: BrandfetchBrandData; error?: string; code?: string }> {
    const apiKey = env.BRANDFETCH_API_KEY || process.env.BRANDFETCH_API_KEY;

    if (!apiKey) {
      logger.warn(
        '[BrandfetchService] BRANDFETCH_API_KEY not configured in server environment. Skipping Brand API call.'
      );
      return {
        success: false,
        error: 'BRANDFETCH_API_KEY is not configured in the server environment.',
        code: 'api_key_missing',
      };
    }

    const cleanDomain = domain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');

    // Typed route: /v2/brands/domain/{domain}
    const url = `${this.baseUrl}/brands/domain/${encodeURIComponent(cleanDomain)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      // Handle errors using the 'x-bf-error' header code
      const bfErrorCode =
        response.headers.get('x-bf-error') ||
        response.headers.get('x-bf-error-code') ||
        undefined;

      if (!response.ok) {
        let bodyError: BrandfetchErrorResponse | null = null;
        try {
          bodyError = (await response.json()) as BrandfetchErrorResponse;
        } catch {
          // ignore json parse error on non-json error responses
        }

        const resolvedCode = bfErrorCode || bodyError?.error || bodyError?.code || `http_${response.status}`;
        const message = bodyError?.message || response.statusText || 'Brand API request failed';

        logger.warn(
          `[BrandfetchService] Brandfetch Brand API error for domain '${cleanDomain}': ` +
            `status=${response.status}, x-bf-error=${resolvedCode}, message=${message}`
        );

        // Branching according to Brandfetch error codes:
        switch (resolvedCode) {
          case 'crawl_queued':
            return {
              success: false,
              code: 'crawl_queued',
              error: 'Brand is queued for indexing. Please retry in a few moments.',
            };
          case 'domain_unresolvable':
          case 'domain_invalid':
            return {
              success: false,
              code: resolvedCode,
              error: `Domain '${cleanDomain}' does not resolve or is invalid.`,
            };
          case 'brand_not_found':
            return {
              success: false,
              code: 'brand_not_found',
              error: `No brand data found for '${cleanDomain}'.`,
            };
          case 'quota_exceeded':
            return {
              success: false,
              code: 'quota_exceeded',
              error: 'Brandfetch monthly API quota exceeded.',
            };
          case 'paid_plan_required':
            return {
              success: false,
              code: 'paid_plan_required',
              error: 'This feature requires a paid Brandfetch plan.',
            };
          default:
            return {
              success: false,
              code: resolvedCode,
              error: message,
            };
        }
      }

      const data = (await response.json()) as BrandfetchBrandData;
      return {
        success: true,
        data,
      };
    } catch (err: any) {
      logger.error(
        `[BrandfetchService] Network or unexpected error fetching brand for '${cleanDomain}': ${err.message}`
      );
      return {
        success: false,
        code: 'network_error',
        error: err.message || 'Network error communicating with Brandfetch API',
      };
    }
  }
}

export const brandfetchService = new BrandfetchService();
export default brandfetchService;
