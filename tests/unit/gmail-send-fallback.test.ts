import { describe, it, expect, vi, beforeEach } from 'vitest';
import gmailSendFallbackAdapter from '../../src/modules/adapters/native/fallback/gmail-send-fallback';
import prisma from '../../src/lib/prisma';
import credentialVaultService from '../../src/lib/vault/credential-vault.service';
import { BadRequestError, UnauthorizedError } from '../../src/lib/errors';

describe('Gmail Send Native Fallback Adapter (Phase 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects calls missing to, subject, or body with BadRequestError', async () => {
    await expect(
      gmailSendFallbackAdapter.sendEmail('conn_gmail_123', {
        to: '',
        subject: 'Hello',
        body: 'World',
      })
    ).rejects.toThrow(BadRequestError);

    await expect(
      gmailSendFallbackAdapter.sendEmail('conn_gmail_123', {
        to: 'user@example.com',
        subject: '',
        body: 'World',
      })
    ).rejects.toThrow(BadRequestError);
  });

  it('throws UnauthorizedError if connection has no stored credentials in vault', async () => {
    vi.spyOn(prisma.connectorCredential, 'findUnique').mockResolvedValue(null);

    await expect(
      gmailSendFallbackAdapter.sendEmail('conn_gmail_123', {
        to: 'recipient@example.com',
        subject: 'Important Update',
        body: 'Please review the attached project notes.',
      })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('successfully sends email using decrypted OAuth access token in test mode', async () => {
    vi.spyOn(prisma.connectorCredential, 'findUnique').mockResolvedValue({
      id: 'cred_123',
      connectionId: 'conn_gmail_123',
      encryptedData: 'enc_data',
      iv: 'iv_data',
      authTag: 'tag_data',
      keyId: 'v1',
    } as any);

    vi.spyOn(credentialVaultService, 'decrypt').mockReturnValue({
      accessToken: 'mock_google_access_token_123',
    });

    const result = await gmailSendFallbackAdapter.sendEmail('conn_gmail_123', {
      to: 'client@acme.com',
      subject: 'Q1 Project Kickoff',
      body: 'Hi Team, looking forward to our sync tomorrow.',
      cc: 'manager@acme.com',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.id).toBe('mock_msg_123');
    expect(result.data.recipient).toBe('client@acme.com');
  });
});
