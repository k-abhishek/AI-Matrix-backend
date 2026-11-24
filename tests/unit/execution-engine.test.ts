import { describe, it, expect, vi, beforeEach } from 'vitest';
import executionEngineService, { ExecutionEngineService } from '../../src/modules/execution/execution-engine.service';
import ConnectorExecutionLog from '../../src/models/ConnectorExecutionLog';
import prisma from '../../src/lib/prisma';
import mcpExecutionService from '../../src/modules/mcp/mcp-execution.service';
import { AppError } from '../../src/lib/errors';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    connectorConnection: {
      findFirst: vi.fn(),
    },
    connectorCredential: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/mcp/mcp-execution.service', () => ({
  default: {
    executeTool: vi.fn(),
  },
}));

vi.mock('../../src/models/ConnectorExecutionLog', () => ({
  default: {
    create: vi.fn(),
  },
}));

describe('ExecutionEngineService & Production Hardening (Phase 7)', () => {
  let engine: ExecutionEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ExecutionEngineService();
  });

  describe('Secret Masking & Data Sanitization', () => {
    it('masks sensitive keys and leaves non-sensitive data intact', () => {
      const sensitivePayload = {
        tool: 'send_webhook',
        url: 'https://example.com/webhook',
        apiKey: 'super-secret-key-12345',
        auth: {
          token: 'bearer-jwt-token-xyz',
          password: 'my-db-password',
        },
        metadata: {
          requestId: 'req-987',
          client_secret: 'oauth-client-secret',
        },
        items: [
          { id: 1, name: 'Normal Item' },
          { id: 2, secret: 'hidden-token' },
        ],
      };

      const masked = engine.maskSensitiveData(sensitivePayload);

      expect(masked.apiKey).toBe('[REDACTED]');
      expect(masked.auth.token).toBe('[REDACTED]');
      expect(masked.auth.password).toBe('[REDACTED]');
      expect(masked.metadata.client_secret).toBe('[REDACTED]');
      expect(masked.items[1].secret).toBe('[REDACTED]');

      // Non-sensitive fields preserved
      expect(masked.url).toBe('https://example.com/webhook');
      expect(masked.metadata.requestId).toBe('req-987');
      expect(masked.items[0].name).toBe('Normal Item');
    });
  });

  describe('Rate Limiting (Sliding Window)', () => {
    it('allows calls up to the configured limit and rejects excess with 429', () => {
      const key = 'test-conn-tool';
      const maxLimit = 5;

      for (let i = 0; i < maxLimit; i++) {
        expect(() => engine.checkRateLimit(key, maxLimit)).not.toThrow();
      }

      // Next call exceeds limit
      expect(() => engine.checkRateLimit(key, maxLimit)).toThrowError(AppError);
      try {
        engine.checkRateLimit(key, maxLimit);
      } catch (err: any) {
        expect(err.statusCode).toBe(429);
      }
    });
  });

  describe('Human-in-the-Loop (HITL) Approval Gate', () => {
    it('halts execution and returns approval token when tool requires approval', async () => {
      vi.mocked(prisma.connectorConnection.findFirst).mockResolvedValue({
        id: 'conn-1',
        workspaceId: 'ws-1',
        connectorDefinition: { type: 'MCP', key: 'slack' },
        tools: [
          {
            id: 'tool-del',
            name: 'delete_channel',
            requiresApproval: true,
            rateLimitPerMin: 60,
          },
        ],
      } as any);

      const result = await engine.executeTool({
        connectionId: 'conn-1',
        workspaceId: 'ws-1',
        toolName: 'delete_channel',
        parameters: { channelId: 'C12345' },
        approvalConfirmed: false,
      });

      expect(result.success).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalToken).toBeDefined();
      expect(mcpExecutionService.executeTool).not.toHaveBeenCalled();
    });

    it('proceeds with execution when approvalConfirmed is true', async () => {
      vi.mocked(prisma.connectorConnection.findFirst).mockResolvedValue({
        id: 'conn-1',
        workspaceId: 'ws-1',
        connectorDefinition: { type: 'MCP', key: 'slack' },
        tools: [
          {
            id: 'tool-del',
            name: 'delete_channel',
            requiresApproval: true,
            rateLimitPerMin: 60,
          },
        ],
      } as any);

      vi.mocked(mcpExecutionService.executeTool).mockResolvedValue({
        success: true,
        data: { ok: true },
        executionTimeMs: 50,
      });

      const result = await engine.executeTool({
        connectionId: 'conn-1',
        workspaceId: 'ws-1',
        toolName: 'delete_channel',
        parameters: { channelId: 'C12345' },
        approvalConfirmed: true,
      });

      expect(result.success).toBe(true);
      expect(result.requiresApproval).toBeUndefined();
      expect(mcpExecutionService.executeTool).toHaveBeenCalled();
      expect(ConnectorExecutionLog.create).toHaveBeenCalled();
    });
  });

  describe('Token Health & Expiration Warning', () => {
    it('identifies healthy tokens with ample validity', async () => {
      const farFuture = new Date(Date.now() + 3600 * 1000); // 1 hour ahead
      vi.mocked(prisma.connectorCredential.findUnique).mockResolvedValue({
        expiresAt: farFuture,
      } as any);

      const health = await engine.checkConnectionTokenHealth('conn-token-1');
      expect(health.isHealthy).toBe(true);
      expect(health.needsRefresh).toBe(false);
    });

    it('flags token needing proactive refresh when expiring in under 5 minutes', async () => {
      const nearFuture = new Date(Date.now() + 120 * 1000); // 2 minutes ahead
      vi.mocked(prisma.connectorCredential.findUnique).mockResolvedValue({
        expiresAt: nearFuture,
      } as any);

      const health = await engine.checkConnectionTokenHealth('conn-token-2');
      expect(health.isHealthy).toBe(true);
      expect(health.needsRefresh).toBe(true);
    });

    it('flags expired tokens as unhealthy', async () => {
      const past = new Date(Date.now() - 60 * 1000); // 1 minute ago
      vi.mocked(prisma.connectorCredential.findUnique).mockResolvedValue({
        expiresAt: past,
      } as any);

      const health = await engine.checkConnectionTokenHealth('conn-token-3');
      expect(health.isHealthy).toBe(false);
      expect(health.needsRefresh).toBe(true);
    });
  });
});
