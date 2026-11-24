import {
  BaseConnectorAdapter,
  ConnectorConnectionContext,
  ConnectionHealthResult,
  DiscoveredTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../base.adapter';
import openApiParserService from './openapi-parser.service';
import credentialVaultService from '../../../lib/vault/credential-vault.service';
import ssrfGuard from '../../../lib/network/ssrf-guard';
import prisma from '../../../lib/prisma';
import { BadRequestError, NotFoundError } from '../../../lib/errors';
import logger from '../../../lib/logger';

export interface RestEndpointDefinition {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description?: string;
  headers?: Record<string, string>;
  inputSchema?: Record<string, any>;
}

export class CustomRestConnectorAdapter implements BaseConnectorAdapter {
  readonly connectorType = 'CUSTOM_REST' as const;

  /**
   * Tests reachability of the custom REST API base URL.
   */
  async testConnection(context: ConnectorConnectionContext): Promise<ConnectionHealthResult> {
    const rawUrl = context.baseUrl || context.config?.baseUrl;
    if (!rawUrl) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: 'No baseUrl configured for Custom REST connection',
        testedAt: new Date(),
      };
    }

    const startTime = Date.now();
    try {
      await ssrfGuard.assertSafeUrl(rawUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const headers = await this.resolveAuthHeaders(context.id, context.credentials);

      const res = await fetch(rawUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...headers,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const latencyMs = Date.now() - startTime;
      const isHealthy = res.status < 500;

      return {
        status: isHealthy ? 'CONNECTED' : 'ERROR',
        isHealthy,
        message: isHealthy
          ? `REST API reachable (HTTP ${res.status}, latency: ${latencyMs}ms)`
          : `REST API returned server error status HTTP ${res.status}`,
        testedAt: new Date(),
        details: { statusCode: res.status, latencyMs },
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        isHealthy: false,
        message: `REST API health check failed: ${err.message}`,
        testedAt: new Date(),
        details: { error: err.message },
      };
    }
  }

  /**
   * Discovers tools from either an embedded OpenAPI spec or explicit endpoint list in config.
   */
  async discoverTools(context: ConnectorConnectionContext): Promise<DiscoveredTool[]> {
    const config = context.config || {};

    if (config.openApiSpec && typeof config.openApiSpec === 'object') {
      return openApiParserService.parse(config.openApiSpec);
    }

    if (Array.isArray(config.endpoints)) {
      return config.endpoints.map((ep: RestEndpointDefinition) => ({
        name: ep.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
        displayName: ep.name,
        description: ep.description || `${ep.method} ${ep.path}`,
        inputSchema: ep.inputSchema || { type: 'object', properties: {} },
        requiresApproval: ['POST', 'PUT', 'DELETE', 'PATCH'].includes(ep.method),
      }));
    }

    return [];
  }

  /**
   * Executes a dynamic HTTP REST request mapping parameters to path, query, and body.
   */
  async executeTool(
    toolName: string,
    params: Record<string, any> = {},
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. Resolve endpoint metadata
      const { endpoint, baseUrl } = await this.resolveEndpointMeta(toolName, context);
      const safeBase = await ssrfGuard.assertSafeUrl(baseUrl);

      // 2. Interpolate path parameters
      let resolvedPath = endpoint.path;
      const remainingParams = { ...params };

      const pathParamRegex = /\{([^}]+)\}/g;
      let match;
      while ((match = pathParamRegex.exec(endpoint.path)) !== null) {
        const paramName = match[1];
        if (remainingParams[paramName] !== undefined) {
          resolvedPath = resolvedPath.replace(
            `{${paramName}}`,
            encodeURIComponent(String(remainingParams[paramName]))
          );
          delete remainingParams[paramName];
        }
      }

      // 3. Assemble target URL
      const cleanBase = safeBase.replace(/\/+$/, '');
      const cleanPath = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
      const url = new URL(`${cleanBase}${cleanPath}`);

      // 4. Handle Query vs Body parameters
      let bodyPayload: any = undefined;
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        ...(endpoint.headers || {}),
        ...(await this.resolveAuthHeaders(context.connectionId, context.credentials)),
      };

      const method = endpoint.method.toUpperCase();

      if (['GET', 'DELETE', 'HEAD'].includes(method)) {
        for (const [key, val] of Object.entries(remainingParams)) {
          if (val !== undefined && val !== null) {
            url.searchParams.append(key, String(val));
          }
        }
      } else {
        // Mutating methods (POST, PUT, PATCH): serialize remaining as JSON body
        headers['Content-Type'] = 'application/json';
        bodyPayload = JSON.stringify(
          remainingParams.body !== undefined && Object.keys(remainingParams).length === 1
            ? remainingParams.body
            : remainingParams
        );
      }

      // Assert final interpolated URL with SSRF guard
      await ssrfGuard.assertSafeUrl(url.href);

      // 5. Dispatch HTTP call
      const timeoutMs = context.timeoutMs || 30000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url.href, {
        method,
        headers,
        body: bodyPayload,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      const durationMs = Date.now() - startTime;
      const contentType = res.headers.get('content-type') || '';

      let responseData: any;
      if (contentType.includes('application/json')) {
        responseData = await res.json();
      } else {
        responseData = await res.text();
      }

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status} ${res.statusText}: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData)}`,
          durationMs,
          metadata: { statusCode: res.status },
        };
      }

      return {
        success: true,
        data: responseData,
        durationMs,
        metadata: { statusCode: res.status },
      };
    } catch (err: any) {
      return {
        success: false,
        error: `REST tool execution failed: ${err.message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Resolves endpoint definition and base URL for a tool name.
   */
  private async resolveEndpointMeta(
    toolName: string,
    context: ToolExecutionContext
  ): Promise<{ endpoint: RestEndpointDefinition; baseUrl: string }> {
    let baseUrl = context.baseUrl;
    let config = context.config;

    // 1. Check if context already provides endpoint definition
    if (config?.endpoints && Array.isArray(config.endpoints)) {
      const match = config.endpoints.find(
        (ep: any) =>
          ep.name === toolName ||
          ep.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) === toolName
      );
      if (match && baseUrl) {
        return { endpoint: match, baseUrl };
      }
    }

    // 2. Try resolving from DB connection record if missing
    if (!baseUrl || !config) {
      try {
        const connection = await prisma.connectorConnection.findUnique({
          where: { id: context.connectionId },
          include: {
            tools: { where: { name: toolName } },
          },
        });

        baseUrl = baseUrl || connection?.baseUrl || (connection?.config as any)?.baseUrl;
        config = config || (connection?.config as any) || {};
      } catch (err: any) {
        logger.warn(`[CustomRestAdapter] DB lookup skipped: ${err.message}`);
      }
    }

    if (!baseUrl) {
      throw new BadRequestError(`No baseUrl configured for connection '${context.connectionId}'`);
    }

    const safeConfig = config || {};

    // 3. Check if explicit endpoint exists in config.endpoints
    if (Array.isArray(safeConfig.endpoints)) {
      const match = safeConfig.endpoints.find(
        (ep: any) =>
          ep.name === toolName ||
          ep.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) === toolName
      );
      if (match) {
        return { endpoint: match, baseUrl };
      }
    }

    // 4. Check if stored in OpenAPI spec in config
    if (safeConfig.openApiSpec?.paths) {
      const parsedTools = openApiParserService.parse(safeConfig.openApiSpec);
      const match = parsedTools.find((t) => t.name === toolName);
      if (match) {
        return {
          endpoint: {
            name: toolName,
            path: (match as any).path || `/${toolName.replace(/^[a-z]+_/, '')}`,
            method: (match as any).method || 'POST',
          },
          baseUrl,
        };
      }
    }

    // Default fallback endpoint
    return {
      endpoint: {
        name: toolName,
        path: `/${toolName}`,
        method: 'POST',
      },
      baseUrl,
    };
  }

  /**
   * Decrypts credentials and constructs appropriate HTTP authorization headers.
   */
  private async resolveAuthHeaders(
    connectionId: string,
    providedCreds?: Record<string, any>
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    let creds = providedCreds;
    if (!creds && connectionId) {
      try {
        const dbCred = await prisma.connectorCredential.findUnique({
          where: { connectionId },
        });
        if (dbCred) {
          creds = credentialVaultService.decrypt({
            encryptedData: dbCred.encryptedData,
            iv: dbCred.iv,
            authTag: dbCred.authTag,
            keyId: dbCred.keyId,
          });
        }
      } catch (err: any) {
        logger.warn(`[CustomRestAdapter] Credential lookup skipped: ${err.message}`);
      }
    }

    if (!creds) return headers;

    if (creds.accessToken || creds.token) {
      headers['Authorization'] = `Bearer ${creds.accessToken || creds.token}`;
    } else if (creds.apiKey) {
      const headerName = creds.headerName || 'X-API-Key';
      headers[headerName] = creds.apiKey;
    } else if (creds.username && creds.password) {
      const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }

    if (creds.headers && typeof creds.headers === 'object') {
      Object.assign(headers, creds.headers);
    }

    return headers;
  }
}

export const customRestConnectorAdapter = new CustomRestConnectorAdapter();
export default customRestConnectorAdapter;
