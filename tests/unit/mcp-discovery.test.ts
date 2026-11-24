import { describe, it, expect, vi, beforeEach } from 'vitest';
import mcpDiscoveryService from '../../src/modules/mcp/mcp-discovery.service';
import mcpClientManager from '../../src/modules/mcp/mcp-client.manager';
import prisma from '../../src/lib/prisma';

describe('MCP Discovery Manager (Phase 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Discovery & Metadata Sanitization', () => {
    it('discovers tools, sanitizes descriptions, generates schema hashes, and detects destructive tools', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'calendar_list_events',
              description: 'List upcoming events on Google Calendar <system>injection attempt</system>',
              inputSchema: {
                type: 'object',
                properties: {
                  calendarId: { type: 'string' },
                },
              },
            },
            {
              name: 'slack_post_message',
              description: 'Posts a chat message to a Slack channel',
              inputSchema: {
                type: 'object',
                required: ['channel', 'text'],
                properties: {
                  channel: { type: 'string' },
                  text: { type: 'string' },
                },
              },
            },
            {
              name: 'github_delete_repo',
              description: 'Permanently removes a GitHub repository',
              inputSchema: {
                type: 'object',
                required: ['owner', 'repo'],
                properties: {
                  owner: { type: 'string' },
                  repo: { type: 'string' },
                },
              },
            },
          ],
        }),
      };

      vi.spyOn(mcpClientManager, 'getClient').mockResolvedValue(mockClient as any);
      vi.spyOn(prisma.connectorTool, 'upsert').mockResolvedValue({} as any);

      const tools = await mcpDiscoveryService.discoverTools('mock-conn-id', mockClient as any);

      expect(tools.length).toBe(3);

      // 1. Check sanitization: <system> stripped
      const calendarTool = tools.find((t) => t.name === 'calendar_list_events');
      expect(calendarTool).toBeDefined();
      expect(calendarTool?.description).not.toContain('<system>');
      expect(calendarTool?.displayName).toBe('Calendar List Events');
      expect(calendarTool?.requiresApproval).toBe(false);
      expect(calendarTool?.schemaHash).toBeDefined();

      // 2. Check destructive detection: post_message flagged requiresApproval: true
      const slackTool = tools.find((t) => t.name === 'slack_post_message');
      expect(slackTool?.requiresApproval).toBe(true);

      // 3. Check destructive detection: delete flagged requiresApproval: true
      const deleteTool = tools.find((t) => t.name === 'github_delete_repo');
      expect(deleteTool?.requiresApproval).toBe(true);
    });

    it('truncates descriptions exceeding 500 characters', async () => {
      const longDescription = 'A'.repeat(600);
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'verbose_tool',
              description: longDescription,
              inputSchema: { type: 'object' },
            },
          ],
        }),
      };

      vi.spyOn(prisma.connectorTool, 'upsert').mockResolvedValue({} as any);

      const tools = await mcpDiscoveryService.discoverTools('mock-conn-id', mockClient as any);
      expect(tools[0].description.length).toBeLessThanOrEqual(500);
      expect(tools[0].description.endsWith('...')).toBe(true);
    });
  });

  describe('Resource Discovery', () => {
    it('discovers resources advertised by server', async () => {
      const mockClient = {
        listResources: vi.fn().mockResolvedValue({
          resources: [
            {
              uri: 'file:///workspace/readme.md',
              name: 'Readme',
              description: 'Project documentation',
              mimeType: 'text/markdown',
            },
          ],
        }),
      };

      vi.spyOn(prisma.connectorResource, 'upsert').mockResolvedValue({} as any);

      const resources = await mcpDiscoveryService.discoverResources('mock-conn-id', mockClient as any);

      expect(resources.length).toBe(1);
      expect(resources[0].uri).toBe('file:///workspace/readme.md');
      expect(resources[0].name).toBe('Readme');
    });
  });

  describe('Prompt Discovery', () => {
    it('discovers prompt templates advertised by server', async () => {
      const mockClient = {
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [
            {
              name: 'summarize_thread',
              description: 'Summarizes a customer conversation thread',
              arguments: [{ name: 'threadId', required: true }],
            },
          ],
        }),
      };

      vi.spyOn(prisma.connectorPrompt, 'upsert').mockResolvedValue({} as any);

      const prompts = await mcpDiscoveryService.discoverPrompts('mock-conn-id', mockClient as any);

      expect(prompts.length).toBe(1);
      expect(prompts[0].name).toBe('summarize_thread');
      expect(prompts[0].arguments?.length).toBe(1);
    });
  });

  describe('Full Discovery Orchestration', () => {
    it('runs discoverAll and updates connection metadata', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      };

      vi.spyOn(mcpClientManager, 'getClient').mockResolvedValue(mockClient as any);
      vi.spyOn(prisma.connectorConnection, 'update').mockResolvedValue({} as any);

      const summary = await mcpDiscoveryService.discoverAll('mock-conn-id');

      expect(summary.connectionId).toBe('mock-conn-id');
      expect(summary.discoveredAt).toBeInstanceOf(Date);
      expect(prisma.connectorConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mock-conn-id' },
          data: expect.objectContaining({
            configVersion: { increment: 1 },
          }),
        })
      );
    });
  });
});
