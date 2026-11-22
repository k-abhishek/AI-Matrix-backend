import { describe, it, expect, vi, beforeEach } from 'vitest';
import authManager from '../../src/modules/connections/auth.manager';
import prisma from '../../src/lib/prisma';
import credentialVaultService from '../../src/lib/vault/credential-vault.service';
import { BadRequestError } from '../../src/lib/errors';

describe('OAuth Manager (Phase 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiateOAuth', () => {
    it('generates PKCE code challenge and state token for Google Workspace connections', async () => {
      vi.spyOn(prisma.connectorConnection, 'findFirst').mockResolvedValue({
        id: 'conn_gmail_123',
        workspaceId: 'ws_test',
        connectorDefinition: {
          key: 'gmail',
          name: 'Gmail',
          defaultConfig: {
            defaultScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, 'create').mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth('conn_gmail_123', 'ws_test');

      expect(result.authorizationUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(result.authorizationUrl).toContain('code_challenge=');
      expect(result.authorizationUrl).toContain('code_challenge_method=S256');
      expect(result.authorizationUrl).toContain('access_type=offline');
      expect(result.authorizationUrl).toContain('prompt=consent');
      expect(result.authorizationUrl).toContain(`state=${result.state}`);
      expect(result.state).toHaveLength(64); // 32 bytes hex = 64 characters
    });

    it('generates Slack authorization URL for Slack connections', async () => {
      vi.spyOn(prisma.connectorConnection, 'findFirst').mockResolvedValue({
        id: 'conn_slack_123',
        workspaceId: 'ws_test',
        connectorDefinition: {
          key: 'slack',
          name: 'Slack',
          defaultConfig: {
            defaultScopes: ['chat:write', 'channels:read'],
          },
        },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, 'create').mockResolvedValue({} as any);

      const result = await authManager.initiateOAuth('conn_slack_123', 'ws_test');

      expect(result.authorizationUrl).toContain('slack.com/oauth/v2/authorize');
      expect(result.authorizationUrl).toContain(`state=${result.state}`);
    });
  });

  describe('handleOAuthCallback', () => {
    it('rejects expired state tokens with BadRequestError', async () => {
      vi.spyOn(prisma.oAuthTransaction, 'findUnique').mockResolvedValue({
        id: 'tx_expired',
        state: 'expired_state_token',
        expiresAt: new Date(Date.now() - 60000), // expired 1 min ago
        connection: { id: 'conn_123' },
      } as any);

      vi.spyOn(prisma.oAuthTransaction, 'delete').mockResolvedValue({} as any);

      await expect(
        authManager.handleOAuthCallback('auth_code_123', 'expired_state_token')
      ).rejects.toThrow('OAuth state token has expired');
    });

    it('exchanges code for tokens and encrypts credentials into vault', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock_google_access_token_123',
          refresh_token: 'mock_google_refresh_token_123',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.readonly',
        }),
      } as any);

      vi.spyOn(prisma.oAuthTransaction, 'findUnique').mockResolvedValue({
        id: 'tx_valid',
        state: 'valid_state_token',
        codeVerifier: 'mock_code_verifier',
        redirectUri: 'http://localhost:5000/api/oauth/callback',
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        expiresAt: new Date(Date.now() + 600000),
        connection: {
          id: 'conn_calendar_123',
          connectorDefinition: { key: 'google-calendar' },
        },
      } as any);

      vi.spyOn(credentialVaultService, 'encrypt').mockReturnValue({
        encryptedData: 'enc_data',
        iv: 'iv_data',
        authTag: 'tag_data',
        keyId: 'v1',
      });

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          connectorCredential: { upsert: vi.fn().mockResolvedValue({}) },
          connectorConnection: { update: vi.fn().mockResolvedValue({}) },
          oAuthTransaction: { delete: vi.fn().mockResolvedValue({}) },
        });
      });

      const result = await authManager.handleOAuthCallback('auth_code_123', 'valid_state_token');

      expect(result.connectionId).toBe('conn_calendar_123');
      expect(result.status).toBe('CONNECTED');
      expect(result.redirectUrl).toContain('status=success');
    });
  });
});
