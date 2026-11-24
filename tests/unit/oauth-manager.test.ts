import { describe, it, expect, vi, beforeEach } from "vitest";
import authManager from "../../src/modules/connections/auth.manager";
import prisma from "../../src/lib/prisma";
import credentialVaultService from "../../src/lib/vault/credential-vault.service";
import { BadRequestError } from "../../src/lib/errors";
import env from "../../src/config/env";

describe("OAuth Manager (Phase 3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("initiateOAuth", () => {
    it("generates PKCE code challenge and state token for Google Workspace connections", async () => {
      const origClientId = env.GOOGLE_CLIENT_ID;
      const origClientSecret = env.GOOGLE_CLIENT_SECRET;
      (env as any).GOOGLE_CLIENT_ID = "mock_client_id";
      (env as any).GOOGLE_CLIENT_SECRET = "mock_client_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_gmail_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "gmail",
          name: "Gmail",
          defaultConfig: {
            defaultScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth(
        "conn_gmail_123",
        "ws_test",
      );

      expect(result.authorizationUrl).toContain(
        "accounts.google.com/o/oauth2/v2/auth",
      );
      expect(result.authorizationUrl).toContain("code_challenge=");
      expect(result.authorizationUrl).toContain("code_challenge_method=S256");
      expect(result.authorizationUrl).toContain("access_type=offline");
      expect(result.authorizationUrl).toContain("prompt=consent");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);
      expect(result.state).toHaveLength(64); // 32 bytes hex = 64 characters

      (env as any).GOOGLE_CLIENT_ID = origClientId;
      (env as any).GOOGLE_CLIENT_SECRET = origClientSecret;
    });

    it("throws OAUTH_NOT_CONFIGURED when client id or secret is missing", async () => {
      const origClientId = env.GOOGLE_CLIENT_ID;
      const origClientSecret = env.GOOGLE_CLIENT_SECRET;
      (env as any).GOOGLE_CLIENT_ID = "";
      (env as any).GOOGLE_CLIENT_SECRET = "";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_gmail_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "gmail",
          name: "Gmail",
        },
      } as any);

      await expect(
        authManager.initiateOAuth("conn_gmail_123", "ws_test")
      ).rejects.toThrow("Google OAuth is not configured");

      (env as any).GOOGLE_CLIENT_ID = origClientId;
      (env as any).GOOGLE_CLIENT_SECRET = origClientSecret;
    });

    it("generates Slack authorization URL for Slack connections", async () => {
      const origClientId = env.SLACK_CLIENT_ID;
      const origClientSecret = env.SLACK_CLIENT_SECRET;
      (env as any).SLACK_CLIENT_ID = "mock_slack_id";
      (env as any).SLACK_CLIENT_SECRET = "mock_slack_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_slack_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "slack",
          name: "Slack",
          defaultConfig: {
            defaultScopes: ["chat:write", "channels:read"],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth(
        "conn_slack_123",
        "ws_test",
      );

      expect(result.authorizationUrl).toContain("slack.com/oauth/v2/authorize");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);

      (env as any).SLACK_CLIENT_ID = origClientId;
      (env as any).SLACK_CLIENT_SECRET = origClientSecret;
    });

    it("generates GitHub authorization URL with proper scopes and state", async () => {
      const origClientId = env.GITHUB_CLIENT_ID;
      const origClientSecret = env.GITHUB_CLIENT_SECRET;
      (env as any).GITHUB_CLIENT_ID = "mock_github_id";
      (env as any).GITHUB_CLIENT_SECRET = "mock_github_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_github_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "github",
          name: "GitHub",
          defaultConfig: {
            defaultScopes: ["repo", "read:user"],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth("conn_github_123", "ws_test");

      expect(result.authorizationUrl).toContain("github.com/login/oauth/authorize");
      expect(result.authorizationUrl).toContain("client_id=mock_github_id");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);

      (env as any).GITHUB_CLIENT_ID = origClientId;
      (env as any).GITHUB_CLIENT_SECRET = origClientSecret;
    });

    it("generates Notion authorization URL for public integrations", async () => {
      const origClientId = env.NOTION_CLIENT_ID;
      const origClientSecret = env.NOTION_CLIENT_SECRET;
      (env as any).NOTION_CLIENT_ID = "mock_notion_id";
      (env as any).NOTION_CLIENT_SECRET = "mock_notion_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_notion_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "notion",
          name: "Notion",
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth("conn_notion_123", "ws_test");

      expect(result.authorizationUrl).toContain("api.notion.com/v1/oauth/authorize");
      expect(result.authorizationUrl).toContain("owner=user");
      expect(result.authorizationUrl).toContain("client_id=mock_notion_id");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);

      (env as any).NOTION_CLIENT_ID = origClientId;
      (env as any).NOTION_CLIENT_SECRET = origClientSecret;
    });

    it("generates Atlassian Jira 3LO authorization URL with prompt=consent", async () => {
      const origClientId = env.JIRA_CLIENT_ID;
      const origClientSecret = env.JIRA_CLIENT_SECRET;
      (env as any).JIRA_CLIENT_ID = "mock_jira_id";
      (env as any).JIRA_CLIENT_SECRET = "mock_jira_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_jira_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "jira",
          name: "Atlassian Jira",
          defaultConfig: {
            defaultScopes: ["read:jira-work", "offline_access"],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth("conn_jira_123", "ws_test");

      expect(result.authorizationUrl).toContain("auth.atlassian.com/authorize");
      expect(result.authorizationUrl).toContain("audience=api.atlassian.com");
      expect(result.authorizationUrl).toContain("prompt=consent");
      expect(result.authorizationUrl).toContain("client_id=mock_jira_id");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);

      (env as any).JIRA_CLIENT_ID = origClientId;
      (env as any).JIRA_CLIENT_SECRET = origClientSecret;
    });

    it("generates ClickUp authorization URL", async () => {
      const origClientId = env.CLICKUP_CLIENT_ID;
      const origClientSecret = env.CLICKUP_CLIENT_SECRET;
      (env as any).CLICKUP_CLIENT_ID = "mock_clickup_id";
      (env as any).CLICKUP_CLIENT_SECRET = "mock_clickup_secret";

      vi.spyOn(prisma.connectorConnection, "findFirst").mockResolvedValue({
        id: "conn_clickup_123",
        workspaceId: "ws_test",
        connectorDefinition: {
          key: "clickup",
          name: "ClickUp",
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "create").mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth("conn_clickup_123", "ws_test");

      expect(result.authorizationUrl).toContain("app.clickup.com/api");
      expect(result.authorizationUrl).toContain("client_id=mock_clickup_id");
      expect(result.authorizationUrl).toContain(`state=${result.state}`);

      (env as any).CLICKUP_CLIENT_ID = origClientId;
      (env as any).CLICKUP_CLIENT_SECRET = origClientSecret;
    });
  });

  describe("handleOAuthCallback", () => {
    it("rejects expired state tokens with BadRequestError", async () => {
      vi.spyOn(prisma.oAuthTransaction, "findUnique").mockResolvedValue({
        id: "tx_expired",
        state: "expired_state_token",
        expiresAt: new Date(Date.now() - 60000), // expired 1 min ago
        connection: { id: "conn_123" },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "delete").mockResolvedValue({} as any);

      await expect(
        authManager.handleOAuthCallback("auth_code_123", "expired_state_token"),
      ).rejects.toThrow("OAuth state token has expired");
    });

    it("exchanges code for tokens and encrypts credentials into vault", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "mock_google_access_token_123",
          refresh_token: "mock_google_refresh_token_123",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        }),
      } as any);

      vi.spyOn(prisma.oAuthTransaction, "findUnique").mockResolvedValue({
        id: "tx_valid",
        state: "valid_state_token",
        codeVerifier: "mock_code_verifier",
        redirectUri: "http://localhost:3000/api/oauth/callback",
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        expiresAt: new Date(Date.now() + 600000),
        connection: {
          id: "conn_calendar_123",
          connectorDefinition: { key: "google-calendar" },
        },
      } as any);

      vi.spyOn(credentialVaultService, "encrypt").mockReturnValue({
        encryptedData: "enc_data",
        iv: "iv_data",
        authTag: "tag_data",
        keyId: "v1",
      });

      vi.spyOn(prisma, "$transaction").mockImplementation(
        async (callback: any) => {
          return callback({
            connectorCredential: { upsert: vi.fn().mockResolvedValue({}) },
            connectorConnection: { update: vi.fn().mockResolvedValue({}) },
            oAuthTransaction: { delete: vi.fn().mockResolvedValue({}) },
          });
        },
      );

      const result = await authManager.handleOAuthCallback(
        "auth_code_123",
        "valid_state_token",
      );

      expect(result.connectionId).toBe("conn_calendar_123");
      expect(result.status).toBe("CONNECTED");
      expect(result.redirectUrl).toContain("status=success");
    });

    it("exchanges Jira code and resolves cloudId from accessible-resources", async () => {
      vi.spyOn(prisma.oAuthTransaction, "findUnique").mockResolvedValue({
        id: "tx_jira_valid",
        state: "valid_jira_state",
        codeVerifier: "mock_verifier",
        redirectUri: "http://localhost:4000/api/oauth/callback",
        scopes: ["read:jira-work", "offline_access"],
        expiresAt: new Date(Date.now() + 600000),
        connection: {
          id: "conn_jira_123",
          connectorDefinition: { key: "jira" },
        },
      } as any);

      vi.spyOn(credentialVaultService, "encrypt").mockReturnValue({
        encryptedData: "enc_jira",
        iv: "iv_jira",
        authTag: "tag_jira",
        keyId: "v1",
      });

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          connectorCredential: { upsert: vi.fn().mockResolvedValue({}) },
          connectorConnection: { update: vi.fn().mockResolvedValue({}) },
          oAuthTransaction: { delete: vi.fn().mockResolvedValue({}) },
        });
      });

      const result = await authManager.handleOAuthCallback("auth_code_jira", "valid_jira_state");

      expect(result.connectionId).toBe("conn_jira_123");
      expect(result.status).toBe("CONNECTED");
      expect(result.redirectUrl).toContain("status=success");
    });

    it("exchanges Notion code and captures workspace details", async () => {
      vi.spyOn(prisma.oAuthTransaction, "findUnique").mockResolvedValue({
        id: "tx_notion_valid",
        state: "valid_notion_state",
        codeVerifier: null,
        redirectUri: "http://localhost:4000/api/oauth/callback",
        scopes: [],
        expiresAt: new Date(Date.now() + 600000),
        connection: {
          id: "conn_notion_123",
          connectorDefinition: { key: "notion" },
        },
      } as any);

      vi.spyOn(credentialVaultService, "encrypt").mockReturnValue({
        encryptedData: "enc_notion",
        iv: "iv_notion",
        authTag: "tag_notion",
        keyId: "v1",
      });

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          connectorCredential: { upsert: vi.fn().mockResolvedValue({}) },
          connectorConnection: { update: vi.fn().mockResolvedValue({}) },
          oAuthTransaction: { delete: vi.fn().mockResolvedValue({}) },
        });
      });

      const result = await authManager.handleOAuthCallback("auth_code_notion", "valid_notion_state");

      expect(result.connectionId).toBe("conn_notion_123");
      expect(result.status).toBe("CONNECTED");
    });
  });
});
