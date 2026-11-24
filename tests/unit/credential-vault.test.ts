import { describe, it, expect } from 'vitest';
import { CredentialVaultService, VaultError } from '../../src/lib/vault/credential-vault.service';

describe('CredentialVaultService (AES-256-GCM)', () => {
  const vault = new CredentialVaultService();

  it('successfully encrypts and decrypts a credential payload', () => {
    const originalCredentials = {
      apiKey: 'sk-test-live-1234567890abcdef',
      accessToken: 'xoxb-9876543210-abcdef',
      scopes: ['channels:read', 'chat:write'],
    };

    const encrypted = vault.encrypt(originalCredentials);

    expect(encrypted.encryptedData).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.keyId).toBe('v1');
    expect(encrypted.encryptedData).not.toContain('sk-test-live');

    const decrypted = vault.decrypt(encrypted);

    expect(decrypted.apiKey).toBe(originalCredentials.apiKey);
    expect(decrypted.accessToken).toBe(originalCredentials.accessToken);
    expect(decrypted.scopes).toEqual(originalCredentials.scopes);
  });

  it('rejects tampered ciphertexts and throws VaultError', () => {
    const encrypted = vault.encrypt({ secret: 'super_confidential_token' });

    // Tamper with ciphertext by altering characters
    const tamperedPayload = {
      ...encrypted,
      encryptedData: 'X' + encrypted.encryptedData.slice(1),
    };

    expect(() => vault.decrypt(tamperedPayload)).toThrowError(VaultError);
  });

  it('rejects invalid authTags and throws VaultError', () => {
    const encrypted = vault.encrypt({ secret: 'super_confidential_token' });

    // Tamper with auth tag
    const tamperedPayload = {
      ...encrypted,
      authTag: Buffer.from('invalidauthtag16b').toString('base64'),
    };

    expect(() => vault.decrypt(tamperedPayload)).toThrowError(VaultError);
  });

  it('correctly masks secrets in arbitrary nested objects', () => {
    const unmasked = {
      name: 'Production Slack',
      apiKey: 'xoxb-1234567890-abcdef',
      clientSecret: 'secret_value_123456',
      nested: {
        accessToken: 'bearer_token_xyz',
        safeProperty: 'hello_world',
      },
      list: [
        { token: 'token_in_list_123456' },
      ],
    };

    const masked = vault.maskSecrets(unmasked);

    expect(masked.name).toBe('Production Slack');
    expect(masked.apiKey).not.toBe(unmasked.apiKey);
    expect(masked.apiKey).toContain('...');
    expect(masked.clientSecret).toContain('...');
    expect(masked.nested.accessToken).toContain('...');
    expect(masked.nested.safeProperty).toBe('hello_world');
    expect(masked.list[0].token).toContain('...');
  });
});
