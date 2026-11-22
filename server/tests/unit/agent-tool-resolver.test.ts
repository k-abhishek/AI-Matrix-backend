import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsonSchemaToZod from '../../src/utils/schema-converter';
import { AgentToolResolverService } from '../../src/modules/agents/agent-tool-resolver.service';
import prisma from '../../src/lib/prisma';
import mcpExecutionService from '../../src/modules/mcp/mcp-execution.service';
import gmailSendFallbackAdapter from '../../src/modules/adapters/native/fallback/gmail-send-fallback';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    agentConnectorBinding: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/mcp/mcp-execution.service', () => ({
  default: {
    executeTool: vi.fn(),
  },
}));

vi.mock('../../src/modules/adapters/native/fallback/gmail-send-fallback', () => ({
  default: {
    sendEmail: vi.fn(),
  },
}));

describe('AgentToolResolverService & Schema Converter (Phase 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('jsonSchemaToZod', () => {
    it('converts basic primitive types and required fields', () => {
      const jsonSchema = {
        type: 'object',
        required: ['username', 'age'],
        properties: {
          username: { type: 'string', description: 'User login name' },
          age: { type: 'integer', description: 'User age' },
          isActive: { type: 'boolean' },
          score: { type: 'number' },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      expect(zodSchema).toBeDefined();

      // Test valid parse
      const valid = zodSchema.safeParse({
        username: 'alice',
        age: 30,
        isActive: true,
        score: 95.5,
      });
      expect(valid.success).toBe(true);

      // Test invalid parse (missing required 'age')
      const invalid = zodSchema.safeParse({
        username: 'alice',
      });
      expect(invalid.success).toBe(false);
    });

    it('converts enum and array types', () => {
      const jsonSchema = {
        type: 'object',
        required: ['status', 'tags'],
        properties: {
          status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'CLOSED'] },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      const valid = zodSchema.safeParse({
        status: 'OPEN',
        tags: ['work', 'urgent'],
      });
      expect(valid.success).toBe(true);

      const invalidEnum = zodSchema.safeParse({
        status: 'UNKNOWN',
        tags: ['work'],
      });
      expect(invalidEnum.success).toBe(false);
    });

    it('handles empty or non-object schemas gracefully', () => {
      const zodSchema = jsonSchemaToZod(null as any);
      expect(zodSchema).toBeDefined();
      const parse = zodSchema.safeParse({});
      expect(parse.success).toBe(true);
    });
  });

  describe('AgentToolResolverService.resolveToolsForAgent', () => {
    const resolver = new AgentToolResolverService();

    it('synthesizes LangChain tools with prefixing and executes through MCP execution service', async () => {
      const mockBindings = [
        {
          id: 'binding-1',
          agentId: 'agent-123',
          workspaceId: 'ws-1',
          isEnabled: true,
          allowedToolNames: [],
          connection: {
            id: 'conn-slack-1',
            name: 'Workspace Slack',
            status: 'CONNECTED',
            connectorDefinition: {
              key: 'slack',
            },
            tools: [
              {
                id: 'tool-1',
                name: 'post_message',
                displayName: 'Post Message',
                description: 'Post a message to a Slack channel',
                isEnabled: true,
                inputSchema: {
                  type: 'object',
                  required: ['channel', 'text'],
                  properties: {
                    channel: { type: 'string' },
                    text: { type: 'string' },
                  },
                },
              },
            ],
          },
        },
      ];

      vi.mocked(prisma.agentConnectorBinding.findMany).mockResolvedValue(mockBindings as any);
      vi.mocked(mcpExecutionService.executeTool).mockResolvedValue({
        success: true,
        data: { ts: '12345.678', ok: true },
        executionTimeMs: 45,
      });

      const tools = await resolver.resolveToolsForAgent('agent-123', 'ws-1');

      expect(tools.length).toBe(1);
      const slackTool = tools[0];
      expect(slackTool.name).toBe('slack_post_message');
      expect(slackTool.description).toBe('Post a message to a Slack channel');

      // Test invoking the synthesized tool
      const toolResult = await slackTool.invoke({
        channel: 'general',
        text: 'Hello world',
      });

      expect(toolResult).toContain('12345.678');
      expect(mcpExecutionService.executeTool).toHaveBeenCalledWith({
        connectionId: 'conn-slack-1',
        toolName: 'post_message',
        parameters: { channel: 'general', text: 'Hello world' },
      });
    });

    it('filters tools based on allowedToolNames in binding', async () => {
      const mockBindings = [
        {
          id: 'binding-2',
          agentId: 'agent-123',
          workspaceId: 'ws-1',
          isEnabled: true,
          allowedToolNames: ['search_messages'], // Only allow search, omit post
          connection: {
            id: 'conn-slack-2',
            name: 'Restricted Slack',
            status: 'CONNECTED',
            connectorDefinition: { key: 'slack' },
            tools: [
              {
                id: 'tool-1',
                name: 'post_message',
                isEnabled: true,
                inputSchema: { type: 'object' },
              },
              {
                id: 'tool-2',
                name: 'search_messages',
                isEnabled: true,
                inputSchema: { type: 'object' },
              },
            ],
          },
        },
      ];

      vi.mocked(prisma.agentConnectorBinding.findMany).mockResolvedValue(mockBindings as any);

      const tools = await resolver.resolveToolsForAgent('agent-123', 'ws-1');

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('slack_search_messages');
    });

    it('automatically provides native Gmail send fallback tool for Gmail connections', async () => {
      const mockBindings = [
        {
          id: 'binding-gmail',
          agentId: 'agent-123',
          workspaceId: 'ws-1',
          isEnabled: true,
          allowedToolNames: [],
          connection: {
            id: 'conn-gmail-1',
            name: 'Corporate Gmail',
            status: 'CONNECTED',
            connectorDefinition: { key: 'gmail' },
            tools: [
              {
                id: 'tool-read',
                name: 'list_messages',
                description: 'List user emails',
                isEnabled: true,
                inputSchema: { type: 'object' },
              },
            ],
          },
        },
      ];

      vi.mocked(prisma.agentConnectorBinding.findMany).mockResolvedValue(mockBindings as any);
      vi.mocked(gmailSendFallbackAdapter.sendEmail).mockResolvedValue({
        success: true,
        data: { messageId: 'msg_987', threadId: 'th_987' },
      });

      const tools = await resolver.resolveToolsForAgent('agent-123', 'ws-1');

      // Should have list_messages AND gmail_send_email fallback tool!
      expect(tools.length).toBe(2);
      const sendTool = tools.find((t) => t.name === 'gmail_send_email');
      expect(sendTool).toBeDefined();

      const result = await sendTool!.invoke({
        to: 'user@example.com',
        subject: 'Status Update',
        body: 'All systems green.',
      });

      expect(result).toContain('msg_987');
      expect(gmailSendFallbackAdapter.sendEmail).toHaveBeenCalledWith(
        'conn-gmail-1',
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Status Update',
          body: 'All systems green.',
        })
      );
    });
  });
});
