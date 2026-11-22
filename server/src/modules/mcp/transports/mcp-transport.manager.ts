import { McpTransportType } from '@prisma/client';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpTransportOptions } from '../mcp.types';
import { BadRequestError } from '../../../lib/errors';
import logger from '../../../lib/logger';

export class McpTransportManager {
  /**
   * Instantiates an MCP transport based on transport type and connection parameters.
   */
  createTransport(options: McpTransportOptions): Transport {
    const transportType = options.transportType || McpTransportType.STREAMABLE_HTTP;
    const url = this.validateAndNormalizeUrl(options.serverUrl);

    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'AI-Matrix-MCP-Client/1.0',
      ...(options.headers || {}),
    };

    switch (transportType) {
      case McpTransportType.STREAMABLE_HTTP: {
        logger.debug(`[McpTransportManager] Initializing StreamableHTTPClientTransport for ${url.href}`);
        return new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers,
          },
          sessionId: options.sessionId,
          reconnectionOptions: {
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 15000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 3,
          },
        });
      }

      case McpTransportType.LEGACY_HTTP_SSE: {
        logger.debug(`[McpTransportManager] Initializing SSEClientTransport for ${url.href}`);
        return new SSEClientTransport(url, {
          requestInit: {
            headers,
          },
        });
      }

      case McpTransportType.STDIO_ISOLATED: {
        throw new BadRequestError(
          'Isolated STDIO transport is reserved for containerized microVM execution and cannot run directly on the host server.'
        );
      }

      default: {
        throw new BadRequestError(`Unsupported MCP transport type: ${String(transportType)}`);
      }
    }
  }

  /**
   * Validates and returns a normalized URL object.
   */
  private validateAndNormalizeUrl(rawUrl: string): URL {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestError('MCP server URL is required');
    }

    try {
      const url = new URL(rawUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BadRequestError(`Invalid MCP protocol: ${url.protocol}. Only http: and https: are allowed.`);
      }
      return url;
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Malformed MCP server URL '${rawUrl}': ${err.message}`);
    }
  }
}

export const mcpTransportManager = new McpTransportManager();
export default mcpTransportManager;
