import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';
import credentialVaultService from '../../src/lib/vault/credential-vault.service';
import jiraNativeAdapter from '../../src/modules/adapters/native/jira.native-adapter';
import notionNativeAdapter from '../../src/modules/adapters/native/notion.native-adapter';
import clickupNativeAdapter from '../../src/modules/adapters/native/clickup.native-adapter';
import slackNativeAdapter from '../../src/modules/adapters/native/slack.native-adapter';
import gmailNativeAdapter from '../../src/modules/adapters/native/gmail.native-adapter';
import nativeAdapterRegistry from '../../src/modules/adapters/native/native-adapter.registry';

describe('Native Adapters & Fallback Runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('NativeAdapterRegistry', () => {
    it('registers all platform native adapters', () => {
      expect(nativeAdapterRegistry.hasAdapter('jira')).toBe(true);
      expect(nativeAdapterRegistry.hasAdapter('notion')).toBe(true);
      expect(nativeAdapterRegistry.hasAdapter('clickup')).toBe(true);
      expect(nativeAdapterRegistry.hasAdapter('slack')).toBe(true);
      expect(nativeAdapterRegistry.hasAdapter('gmail')).toBe(true);
    });

    it('retrieves the matching adapter case-insensitively', () => {
      expect(nativeAdapterRegistry.getAdapter('JIRA')).toBe(jiraNativeAdapter);
      expect(nativeAdapterRegistry.getAdapter('Notion')).toBe(notionNativeAdapter);
      expect(nativeAdapterRegistry.getAdapter('ClickUp')).toBe(clickupNativeAdapter);
    });
  });

  describe('JiraNativeAdapter', () => {
    it('discovers core Jira tools', async () => {
      const tools = await jiraNativeAdapter.discoverTools({
        id: 'conn-jira-1',
        name: 'My Jira',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'jira',
        authType: 'BASIC_AUTH',
      });

      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.name)).toEqual(['search_issues', 'get_issue', 'create_issue']);
    });

    it('handles test connection in mock mode', async () => {
      const result = await jiraNativeAdapter.testConnection({
        id: 'conn-jira-1',
        name: 'My Jira',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'jira',
        authType: 'BASIC_AUTH',
        credentials: { username: 'mock-user@example.com', password: 'mock-token' },
      });

      expect(result.isHealthy).toBe(true);
      expect(result.status).toBe('CONNECTED');
    });

    it('executes search_issues in mock test mode', async () => {
      const result = await jiraNativeAdapter.executeTool('search_issues', { jql: 'project = TEST' }, {
        connectionId: 'conn-jira-1',
        workspaceId: 'ws-1',
        credentials: { username: 'mock-user@example.com', password: 'mock-token' },
      });

      expect(result.success).toBe(true);
      expect(result.data.mocked).toBe(true);
    });
  });

  describe('NotionNativeAdapter', () => {
    it('discovers core Notion tools', async () => {
      const tools = await notionNativeAdapter.discoverTools({
        id: 'conn-notion-1',
        name: 'My Notion',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'notion',
        authType: 'BEARER_TOKEN',
      });

      expect(tools.length).toBe(4);
      expect(tools.map((t) => t.name)).toContain('search');
      expect(tools.map((t) => t.name)).toContain('query_database');
    });

    it('handles test connection in mock mode', async () => {
      const result = await notionNativeAdapter.testConnection({
        id: 'conn-notion-1',
        name: 'My Notion',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'notion',
        authType: 'BEARER_TOKEN',
        credentials: { accessToken: 'mock_secret_notion_key' },
      });

      expect(result.isHealthy).toBe(true);
      expect(result.status).toBe('CONNECTED');
    });
  });

  describe('ClickUpNativeAdapter', () => {
    it('discovers core ClickUp tools', async () => {
      const tools = await clickupNativeAdapter.discoverTools({
        id: 'conn-clickup-1',
        name: 'My ClickUp',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'clickup',
        authType: 'API_KEY',
      });

      expect(tools.length).toBe(4);
      expect(tools.map((t) => t.name)).toContain('get_tasks');
      expect(tools.map((t) => t.name)).toContain('create_task');
    });

    it('handles test connection in mock mode', async () => {
      const result = await clickupNativeAdapter.testConnection({
        id: 'conn-clickup-1',
        name: 'My ClickUp',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'clickup',
        authType: 'API_KEY',
        credentials: { apiKey: 'mock_pk_12345' },
      });

      expect(result.isHealthy).toBe(true);
      expect(result.status).toBe('CONNECTED');
    });
  });

  describe('SlackNativeAdapter', () => {
    it('discovers core Slack tools', async () => {
      const tools = await slackNativeAdapter.discoverTools({
        id: 'conn-slack-1',
        name: 'My Slack',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'slack',
        authType: 'BEARER_TOKEN',
      });

      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.name)).toContain('post_message');
    });

    it('handles test connection in mock mode', async () => {
      const result = await slackNativeAdapter.testConnection({
        id: 'conn-slack-1',
        name: 'My Slack',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'slack',
        authType: 'BEARER_TOKEN',
        credentials: { accessToken: 'mock_xoxb_12345' },
      });

      expect(result.isHealthy).toBe(true);
      expect(result.status).toBe('CONNECTED');
    });
  });

  describe('GmailNativeAdapter', () => {
    it('discovers core Gmail tools', async () => {
      const tools = await gmailNativeAdapter.discoverTools({
        id: 'conn-gmail-1',
        name: 'My Gmail',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'gmail',
        authType: 'BEARER_TOKEN',
      });

      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.name)).toEqual(['list_messages', 'get_message', 'send_email']);
    });

    it('handles test connection in mock mode', async () => {
      const result = await gmailNativeAdapter.testConnection({
        id: 'conn-gmail-1',
        name: 'My Gmail',
        workspaceId: 'ws-1',
        userId: 'u-1',
        connectorKey: 'gmail',
        authType: 'BEARER_TOKEN',
        credentials: { accessToken: 'mock_gmail_token' },
      });

      expect(result.isHealthy).toBe(true);
      expect(result.status).toBe('CONNECTED');
    });

    it('executes send_email using native fallback', async () => {
      vi.spyOn(prisma.connectorCredential, 'findUnique').mockResolvedValue({
        encryptedData: 'mock_enc',
        iv: 'mock_iv',
        authTag: 'mock_tag',
        keyId: 'dev_v1',
      } as any);

      vi.spyOn(credentialVaultService, 'decrypt').mockReturnValue({
        accessToken: 'mock_token',
      });

      const result = await gmailNativeAdapter.executeTool(
        'send_email',
        { to: 'test@example.com', subject: 'Hi', body: 'Test body' },
        {
          connectionId: 'conn-gmail-1',
          workspaceId: 'ws-1',
        }
      );

      expect(result.success).toBe(true);
    });
  });
});
