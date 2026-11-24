import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';
import githubNativeAdapter, { GitHubNativeAdapter } from '../../src/modules/adapters/native/github.native-adapter';
import connectorRegistry, { SYSTEM_CONNECTOR_SEEDS } from '../../src/modules/connectors/connector.registry';
import ssrfGuard, { SsrfGuard } from '../../src/lib/network/ssrf-guard';
import connectionService from '../../src/modules/connections/connection.service';
import { BaseUrlBlockedError, BaseUrlUnreachableError } from '../../src/lib/errors';
import buildApp from '../../src/app';
import env from '../../src/config/env';

describe('Comprehensive Connector Implementation Verification (Tasks 1-8)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. GitHub Native Adapter', () => {
    const adapter = new GitHubNativeAdapter();

    it('successfully tests connection and executes tools with mocked fetch', async () => {
      // Mock fetch for testConnection
      const mockUser = { login: 'octocat', name: 'The Octocat', id: 583231 };
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/user')) {
          expect(opts.headers['User-Agent']).toBe('AI-Matrix-Connector-Platform');
          expect(opts.headers['Authorization']).toBe('Bearer ghp_test_token_123');
          return new Response(JSON.stringify(mockUser), { status: 200 });
        }
        if (urlStr.includes('/user/repos')) {
          expect(urlStr).toContain('visibility=public');
          expect(urlStr).toContain('per_page=10');
          return new Response(JSON.stringify([{ id: 1, name: 'repo-1' }]), { status: 200 });
        }
        if (urlStr.includes('/repos/octocat/hello-world/issues')) {
          if (opts?.method === 'POST') {
            const body = JSON.parse(opts.body);
            expect(body.title).toBe('Bug report');
            return new Response(JSON.stringify({ id: 101, title: body.title, number: 1 }), { status: 201 });
          }
          // list issues: include a pull request item to ensure it gets filtered out
          return new Response(
            JSON.stringify([
              { id: 11, title: 'Real Issue', number: 1 },
              { id: 12, title: 'Pull Request Item', number: 2, pull_request: { url: 'https://...' } },
            ]),
            { status: 200 }
          );
        }
        if (urlStr.includes('/repos/octocat/hello-world')) {
          return new Response(JSON.stringify({ id: 99, name: 'hello-world', stargazers_count: 42 }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      // Test connection
      const health = await adapter.testConnection({
        id: 'conn_gh_1',
        name: 'GitHub',
        workspaceId: 'ws_1',
        userId: 'u_1',
        connectorKey: 'github',
        authType: 'BEARER_TOKEN',
        credentials: { token: 'ghp_test_token_123' },
      });
      expect(health.isHealthy).toBe(true);
      expect(health.status).toBe('CONNECTED');
      expect(health.message).toContain('octocat');

      // Test list_repositories with visibility and per_page
      const repoList = await adapter.executeTool(
        'list_repositories',
        { visibility: 'public', per_page: 10 },
        { connectionId: 'conn_gh_1', workspaceId: 'ws_1', credentials: { token: 'ghp_test_token_123' } }
      );
      expect(repoList.success).toBe(true);
      expect(repoList.data).toHaveLength(1);

      // Test get_repository
      const repoGet = await adapter.executeTool(
        'get_repository',
        { owner: 'octocat', repo: 'hello-world' },
        { connectionId: 'conn_gh_1', workspaceId: 'ws_1', credentials: { token: 'ghp_test_token_123' } }
      );
      expect(repoGet.success).toBe(true);
      expect(repoGet.data.name).toBe('hello-world');

      // Test list_issues (verifies PR items are excluded)
      const issueList = await adapter.executeTool(
        'list_issues',
        { owner: 'octocat', repo: 'hello-world', per_page: 15 },
        { connectionId: 'conn_gh_1', workspaceId: 'ws_1', credentials: { token: 'ghp_test_token_123' } }
      );
      expect(issueList.success).toBe(true);
      expect(issueList.data).toHaveLength(1);
      expect(issueList.data[0].title).toBe('Real Issue');

      // Test create_issue
      const createIssue = await adapter.executeTool(
        'create_issue',
        { owner: 'octocat', repo: 'hello-world', title: 'Bug report', body: 'Error details' },
        { connectionId: 'conn_gh_1', workspaceId: 'ws_1', credentials: { token: 'ghp_test_token_123' } }
      );
      expect(createIssue.success).toBe(true);
      expect(createIssue.data.title).toBe('Bug report');
    });

    it('handles 401 error responses cleanly with sanitized message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com' }), {
          status: 401,
          statusText: 'Unauthorized',
        })
      );

      const health = await adapter.testConnection({
        id: 'conn_gh_invalid',
        name: 'GitHub',
        workspaceId: 'ws_1',
        userId: 'u_1',
        connectorKey: 'github',
        authType: 'BEARER_TOKEN',
        credentials: { token: 'invalid_token' },
      });

      expect(health.isHealthy).toBe(false);
      expect(health.status).toBe('ERROR');
      expect(health.message).toBe('GitHub API error (401): Bad credentials');
    });

    it('rejects malicious or invalid owner and repository names', async () => {
      const maliciousInputs = [
        { owner: '../evil', repo: 'normal' },
        { owner: 'octocat', repo: 'repo/inject' },
        { owner: 'octocat', repo: 'repo; rm -rf' },
        { owner: 'octo<script>', repo: 'xss' },
      ];

      for (const input of maliciousInputs) {
        const result = await adapter.executeTool(
          'get_repository',
          input,
          { connectionId: 'conn_1', workspaceId: 'ws_1', credentials: { token: 'token' } }
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid owner or repository name');
      }
    });
  });

  describe('2. Registry Sync Overwrite', () => {
    it('overwrites type, supportedAuth, and defaultConfig so stale serverUrl values are removed', async () => {
      const upsertSpy = vi.spyOn(prisma.connectorDefinition, 'upsert').mockResolvedValue({} as any);

      await connectorRegistry.syncSystemDefinitions();

      expect(upsertSpy).toHaveBeenCalled();
      const gmailCall = upsertSpy.mock.calls.find((c: any) => c[0].where.key === 'gmail' || c[0].where.key === 'google-workspace');
      expect(gmailCall).toBeDefined();

      const updateData = (gmailCall as any)![0].update;
      expect(updateData.type).toBe('NATIVE');
      expect(updateData.defaultConfig?.serverUrl).toBeUndefined();
      expect(updateData.iconUrl).toBeNull();

      const slackCall = upsertSpy.mock.calls.find((c: any) => c[0].where.key === 'slack');
      expect(slackCall).toBeDefined();
      const slackUpdate = (slackCall as any)![0].update;
      expect(slackUpdate.type).toBe('NATIVE');
      expect(slackUpdate.defaultConfig?.serverUrl).toBeUndefined();
      // Ensure search:read is removed from default scopes
      expect(slackUpdate.defaultConfig?.defaultScopes).not.toContain('search:read');
    });
  });

  describe('3. SSRF Guard Cases', () => {
    it('blocks private subnets, cloud metadata, and link-local in all environments', async () => {
      const guard = new SsrfGuard();

      // Cloud metadata
      await expect(guard.assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(BaseUrlBlockedError);
      await expect(guard.assertSafeUrl('http://metadata.google.internal/computeMetadata/v1')).rejects.toThrow(BaseUrlBlockedError);

      // RFC 1918 private subnets
      await expect(guard.assertSafeUrl('http://10.0.0.1:8080')).rejects.toThrow(BaseUrlBlockedError);
      await expect(guard.assertSafeUrl('http://172.16.5.5:8000')).rejects.toThrow(BaseUrlBlockedError);
      await expect(guard.assertSafeUrl('http://192.168.1.100')).rejects.toThrow(BaseUrlBlockedError);

      // IPv6 unique-local (fd00::/8)
      await expect(guard.assertSafeUrl('http://[fd00::1]:8080')).rejects.toThrow(BaseUrlBlockedError);
    });

    it('allows loopback only when ALLOW_LOCAL_CONNECTORS is true or in development', async () => {
      const guard = new SsrfGuard();

      // In test without flag: loopback is blocked
      process.env.ALLOW_LOCAL_CONNECTORS = 'false';
      await expect(guard.assertSafeUrl('http://127.0.0.1:3000')).rejects.toThrow(BaseUrlBlockedError);
      await expect(guard.assertSafeUrl('http://localhost:3000')).rejects.toThrow(BaseUrlBlockedError);

      // With flag enabled: loopback is allowed
      process.env.ALLOW_LOCAL_CONNECTORS = 'true';
      const validIp = await guard.assertSafeUrl('http://127.0.0.1:3000');
      expect(validIp).toBe('http://127.0.0.1:3000');
      const validHost = await guard.assertSafeUrl('http://localhost:3000');
      expect(validHost).toBe('http://localhost:3000');

      process.env.ALLOW_LOCAL_CONNECTORS = 'false';
    });

    it('throws BaseUrlUnreachableError on DNS resolution failure', async () => {
      const guard = new SsrfGuard();
      const fakeHost = 'https://non-existent-subdomain-123456789.org/mcp';
      await expect(guard.assertSafeUrl(fakeHost)).rejects.toThrow(BaseUrlUnreachableError);
    });

    it('safeFetch re-validates URLs on every redirect', async () => {
      const guard = new SsrfGuard();

      // Mock DNS for initial public URL
      const dns = await import('dns');
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

      // Initial URL is safe, but redirects to an internal metadata address!
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('public.example.com')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data' },
          });
        }
        return new Response('ok', { status: 200 });
      });

      // safeFetch must catch the redirected URL and reject it with BaseUrlBlockedError
      await expect(guard.safeFetch('https://public.example.com/start')).rejects.toThrow(BaseUrlBlockedError);
    });
  });

  describe('4. /connect Atomic Execution & Rollback on Discovery Failure', () => {
    it('rolls back connection and credentials if discovery fails', async () => {
      const app = await buildApp();
      await app.ready();

      vi.spyOn(connectionService, 'createConnection').mockResolvedValue({
        id: 'conn_mock_created',
        workspaceId: 'test_user_rollback',
        userId: 'test_user_rollback',
        connectorDefinitionId: 'def_notion',
        name: 'Failing Notion Connection',
        status: 'CONNECTED',
        authType: 'BEARER_TOKEN',
        hasCredentials: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(connectionService, 'testConnection').mockResolvedValue({
        isHealthy: true,
        latencyMs: 15,
        message: 'Healthy',
      });

      vi.spyOn(connectionService, 'discoverConnection').mockRejectedValue(
        new Error('Upstream Notion API timeout')
      );

      const deleteSpy = vi.spyOn(connectionService, 'deleteConnection').mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/api/connections/connect',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_rollback',
        },
        payload: {
          connectorKey: 'notion',
          name: 'Failing Notion Connection',
          authType: 'BEARER_TOKEN',
          credentials: { token: 'secret_mock_notion_key' },
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('DISCOVERY_FAILED');

      // Verify that delete was invoked to clean up orphaned connection
      expect(deleteSpy).toHaveBeenCalledWith('conn_mock_created', 'test_user_rollback');

      await app.close();
    });
  });

  describe('5. OAuth Callback Browser Redirect Contract', () => {
    it('redirects to frontend failure URL without raw error text in querystring', async () => {
      const app = await buildApp();
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied&error_description=User%20rejected%20access',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers.location!;
      expect(location).toContain('tab=connections');
      expect(location).toContain('status=error');
      expect(location).toContain('code=PROVIDER_DENIED');
      // Must NOT contain the raw error message
      expect(location).not.toContain('User rejected access');

      await app.close();
    });
  });

  describe('6. Workspace Isolation & Credential Security', () => {
    it('prevents workspace B from accessing, testing, or deleting workspace A connection', async () => {
      // Mock DB: connection belongs to 'workspace_A'
      vi.spyOn(prisma.connectorConnection, 'findFirst').mockImplementation(async (args: any) => {
        if (args?.where?.workspaceId === 'workspace_A' && args?.where?.id === 'conn_ws_a') {
          return {
            id: 'conn_ws_a',
            workspaceId: 'workspace_A',
            userId: 'user_a',
            connectorDefinitionId: 'def_1',
            connectorDefinition: { key: 'notion', type: 'NATIVE' },
            name: 'Workspace A Notion',
            status: 'CONNECTED',
            authType: 'BEARER_TOKEN',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any;
        }
        return null; // Not found for workspace B
      });

      // Workspace B attempts to get connection of Workspace A
      await expect(
        connectionService.getConnectionById('conn_ws_a', 'workspace_B')
      ).rejects.toThrow("Connection 'conn_ws_a' not found in workspace");

      // Workspace B attempts to test connection of Workspace A
      await expect(
        connectionService.testConnection('conn_ws_a', 'workspace_B')
      ).rejects.toThrow("Connection 'conn_ws_a' not found in workspace");

      // Workspace B attempts to delete connection of Workspace A
      await expect(
        connectionService.deleteConnection('conn_ws_a', 'workspace_B')
      ).rejects.toThrow("Connection 'conn_ws_a' not found in workspace");
    });

    it('ensures getConnectionById never exposes raw credentials', async () => {
      vi.spyOn(prisma.connectorConnection, 'findFirst').mockResolvedValue({
        id: 'conn_secure',
        workspaceId: 'ws_test',
        userId: 'u_test',
        connectorDefinitionId: 'def_1',
        connectorDefinition: { key: 'github', type: 'NATIVE' },
        name: 'My GitHub',
        status: 'CONNECTED',
        authType: 'BEARER_TOKEN',
        credential: { id: 'cred_1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const conn = await connectionService.getConnectionById('conn_secure', 'ws_test');
      expect(conn.hasCredentials).toBe(true);
      expect((conn as any).credentials).toBeUndefined();
      expect((conn as any).token).toBeUndefined();
      expect((conn as any).apiKey).toBeUndefined();
      expect((conn as any).encryptedData).toBeUndefined();
    });
  });
});
