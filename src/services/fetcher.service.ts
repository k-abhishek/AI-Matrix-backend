import { validateSafeUrl, normalizeUrl } from '../utils/url';
import { SSRError } from '../lib/errors';
import logger from '../lib/logger';
import { FetchResult, FetchOptions } from '../types';

export class FetcherService {
  /**
   * Fetches an HTML page with safety, redirect, and size restrictions.
   */
  async fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const {
      timeoutMs = 15000,
      maxResponseBytes = 5 * 1024 * 1024,
      maxRedirects = 5,
      delayMs = 0,
      allowedHosts = [],
      signal,
    } = options;

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    let currentUrl = url;
    let redirectCount = 0;
    const startTime = Date.now();

    while (redirectCount <= maxRedirects) {
      if (signal?.aborted) {
        throw new Error('Fetch operation aborted by signal');
      }

      validateSafeUrl(currentUrl, allowedHosts);

      const controller = new AbortController();
      let combinedSignal: AbortSignal = controller.signal;

      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: combinedSignal,
          headers: {
            'User-Agent': 'WebsiteCrawler/1.0 (+https://github.com/fastify-crawler)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });

        clearTimeout(timeoutId);

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
          }

          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect response (${response.status}) missing 'Location' header`);
          }

          const resolvedRedirect = normalizeUrl(location, currentUrl);
          if (!resolvedRedirect) {
            throw new Error(`Invalid redirect location: ${location}`);
          }

          currentUrl = resolvedRedirect;
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        if (
          !contentType.toLowerCase().includes('text/html') &&
          !contentType.toLowerCase().includes('application/xhtml+xml')
        ) {
          throw new Error(`Rejected non-HTML response (content-type: ${contentType})`);
        }

        if (!response.ok) {
          throw new Error(`HTTP request failed with status ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is empty');
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            totalSize += value.byteLength;
            if (totalSize > maxResponseBytes) {
              await reader.cancel();
              throw new Error(`Response size (${totalSize} bytes) exceeded limit of ${maxResponseBytes} bytes`);
            }
            chunks.push(value);
          }
        }

        const fullBuffer = Buffer.concat(chunks);
        const html = fullBuffer.toString('utf-8');
        const fetchDurationMs = Date.now() - startTime;

        return {
          url,
          finalUrl: currentUrl,
          html,
          httpStatus: response.status,
          contentBytes: totalSize,
          fetchDurationMs,
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err instanceof SSRError) {
          throw err;
        }
        throw err;
      }
    }

    throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
  }

  /**
   * Fetches with automatic retry on transient HTTP/network errors.
   */
  async fetchWithRetry(url: string, options: FetchOptions = {}, maxRetries = 2): Promise<FetchResult> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await this.fetchPage(url, options);
      } catch (err: any) {
        attempt++;
        const isAbort = options.signal?.aborted;
        const isSSRF = err instanceof SSRError;
        if (attempt > maxRetries || isAbort || isSSRF) {
          throw err;
        }
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.debug(`Retrying fetch for ${url} in ${backoffMs}ms (attempt ${attempt}/${maxRetries}): ${err.message}`);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }
    throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
  }
}

export const fetcherService = new FetcherService();
export default fetcherService;
export { FetchResult, FetchOptions };
