import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionAuthType, McpTransportType } from '@prisma/client';
import mcpTransportManager from '../../src/modules/mcp/transports/mcp-transport.manager';
import mcpAuthManager from '../../src/modules/mcp/mcp-auth.manager';
import mcpExecutionService from '../../src/modules/mcp/mcp-execution.service';
import mcpConnectorAdapter from '../../src/modules/adapters/mcp/mcp.adapter';
import mcpClientManager from '../../src/modules/mcp/mcp-client.manager';
import { BadRequestError } from '../../src/lib/errors';

describe('MCP Runtime Engine (Phase 2)', () => {
  describe('McpTransportManager', () => {
    it('creates a StreamableHTTPClientTransport by default', () => {
      const transport = mcpTransportManager.createTransport({
        serverUrl: 'https://mcp.example.com/v1',
      });
      expect(transport).toBeDefined();
      expect(transport.constructor.name).toBe('StreamableHTTPClientTransport');
    });

    it('creates an SSEClientTransport when LEGACY_HTTP_SSE is specified', () => {
      const transport = mcpTransportManager.createTransport({
        serverUrl: 'https://mcp.example.com/sse',
        transportType: McpTransportType.LEGACY_HTTP_SSE,
      });
      expect(transport).toBeDefined();
      expect(transport.constructor.name).toBe('SSEClientTransport');
    });

    it('rejects STDIO_ISOLATED on standard backend host with descriptive error', () => {
      expect(() =>
        mcpTransportManager.createTransport({
          serverUrl: 'https://mcp.example.com/stdio',
          transportType: McpTransportType.STDIO_ISOLATED,
        })
      ).toThrow(BadRequestError);
    });

    it('rejects unsupported protocols like ftp:', () => {
      expect(() =>
        mcpTransportManager.createTransport({
          serverUrl: 'ftp://ftp.example.com/mcp',
        })
      ).toThrow('Only http: and https: are allowed');
    });

    it('rejects empty or malformed server URLs', () => {
      expect(() =>
        mcpTransportManager.createTransport({
          serverUrl: '',
        })
      ).toThrow(BadRequestError);

      expect(() =>
        mcpTransportManager.createTransport({
          serverUrl: 'not-a-valid-url',
        })
      ).toThrow(BadRequestError);
    });
  });

  describe('McpAuthManager', () => {
    it('formats Bearer token headers correctly', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(
        ConnectionAuthType.BEARER_TOKEN,
        { accessToken: 'test-bearer-token-123' }
      );
      expect(headers).toEqual({
        Authorization: 'Bearer test-bearer-token-123',
      });
    });

    it('formats API key headers with default X-API-Key', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(
        ConnectionAuthType.API_KEY,
        { apiKey: 'secret-key-456' }
      );
      expect(headers).toEqual({
        'X-API-Key': 'secret-key-456',
      });
    });

    it('formats API key headers with custom headerName', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(
        ConnectionAuthType.API_KEY,
        { apiKey: 'secret-key-789', headerName: 'X-Custom-Auth' }
      );
      expect(headers).toEqual({
        'X-Custom-Auth': 'secret-key-789',
      });
    });

    it('formats arbitrary custom headers correctly', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(
        ConnectionAuthType.CUSTOM_HEADERS,
        {
          customHeaders: {
            'X-Tenant-ID': 'tenant-acme',
            'X-Proxy-Token': 'proxy-token-abc',
          },
        }
      );
      expect(headers).toEqual({
        'X-Tenant-ID': 'tenant-acme',
        'X-Proxy-Token': 'proxy-token-abc',
      });
    });

    it('formats Basic Auth headers with base64 credentials', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(
        ConnectionAuthType.BASIC_AUTH,
        { username: 'admin', password: 'password123' }
      );
      const expectedBase64 = Buffer.from('admin:password123').toString('base64');
      expect(headers).toEqual({
        Authorization: `Basic ${expectedBase64}`,
      });
    });

    it('returns empty headers for NONE authType', () => {
      const headers = mcpAuthManager.buildHeadersFromDecrypted(ConnectionAuthType.NONE, {});
      expect(headers).toEqual({});
    });
  });

  describe('McpConnectorAdapter', () => {
    it('declares connectorType as MCP', () => {
      expect(mcpConnectorAdapter.connectorType).toBe('MCP');
    });

    it('implements testConnection, discoverTools, and executeTool', () => {
      expect(typeof mcpConnectorAdapter.testConnection).toBe('function');
      expect(typeof mcpConnectorAdapter.discoverTools).toBe('function');
      expect(typeof mcpConnectorAdapter.executeTool).toBe('function');
    });
  });

  describe('McpExecutionService', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('normalizes single text content responses from MCP tools', async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'ok', items: [1, 2, 3] }),
            },
          ],
        }),
      };

      vi.spyOn(mcpClientManager, 'getClient').mockResolvedValue(mockClient as any);

      const result = await mcpExecutionService.executeTool({
        connectionId: 'mock-conn-id',
        toolName: 'test_tool',
        parameters: { q: 'search' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'ok', items: [1, 2, 3] });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles tool execution errors flagged with isError', async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          isError: true,
          content: [{ type: 'text', text: 'Resource not found or unauthorized' }],
        }),
      };

      vi.spyOn(mcpClientManager, 'getClient').mockResolvedValue(mockClient as any);

      const result = await mcpExecutionService.executeTool({
        connectionId: 'mock-conn-id',
        toolName: 'failing_tool',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Resource not found or unauthorized');
    });

    it('handles unexpected exceptions thrown by MCP client', async () => {
      const mockClient = {
        callTool: vi.fn().mockRejectedValue(new Error('Connection dropped by remote server')),
      };

      vi.spyOn(mcpClientManager, 'getClient').mockResolvedValue(mockClient as any);

      const result = await mcpExecutionService.executeTool({
        connectionId: 'mock-conn-id',
        toolName: 'crash_tool',
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection dropped by remote server');
    });
  });
});
