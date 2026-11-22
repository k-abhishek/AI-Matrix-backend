import crypto from 'crypto';
import env from '../../config/env';
import logger from '../logger';
import { AppError } from '../errors';
import { EncryptedPayload, CredentialData } from './vault.types';

export class VaultError extends AppError {
  constructor(message = 'Credential Vault cryptographic operation failed', details?: unknown) {
    super(message, 500, details);
  }
}

export class CredentialVaultService {
  private masterKey: Buffer;
  private readonly defaultKeyId = 'v1';

  constructor(customKey?: string) {
    this.masterKey = this.resolveKey(customKey);
  }

  /**
   * Resolves a 32-byte (256-bit) buffer from the environment or custom parameter.
   */
  private resolveKey(customKey?: string): Buffer {
    const rawKey = customKey || env.ENCRYPTION_MASTER_KEY;

    if (!rawKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new VaultError('ENCRYPTION_MASTER_KEY must be configured in production');
      }
      // Deterministic development fallback key (32 bytes)
      logger.warn('[CredentialVault] Using development fallback encryption key. Set ENCRYPTION_MASTER_KEY in production!');
      return crypto.createHash('sha256').update('matrix-dev-encryption-key-fallback-32b').digest();
    }

    // Try hex decoding (64 hex chars = 32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    // Try base64 decoding (44 base64 chars = 32 bytes)
    try {
      const b64Buf = Buffer.from(rawKey, 'base64');
      if (b64Buf.length === 32) {
        return b64Buf;
      }
    } catch {
      // Fall through to sha256 hash
    }

    // If string of arbitrary length, hash to 32 bytes
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * Encrypts plaintext or object payload using AES-256-GCM.
   */
  encrypt(data: CredentialData | string, keyId: string = this.defaultKeyId): EncryptedPayload {
    try {
      const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
      // 12 bytes recommended for AES-GCM IV
      const iv = crypto.randomBytes(12);

      const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authTag = cipher.getAuthTag().toString('base64');

      return {
        encryptedData: encrypted,
        iv: iv.toString('base64'),
        authTag,
        keyId,
      };
    } catch (err: any) {
      logger.error('Failed to encrypt credential payload:', err);
      throw new VaultError(`Failed to encrypt payload: ${err.message}`);
    }
  }

  /**
   * Decrypts an AES-256-GCM payload and parses as JSON object.
   */
  decrypt(payload: EncryptedPayload): CredentialData {
    const raw = this.decryptRaw(payload);
    try {
      return JSON.parse(raw);
    } catch {
      return { raw: { value: raw } };
    }
  }

  /**
   * Decrypts an AES-256-GCM payload into raw utf8 string.
   */
  decryptRaw(payload: EncryptedPayload): string {
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const authTag = Buffer.from(payload.authTag, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(payload.encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (err: any) {
      logger.error('Failed to decrypt credential payload (tampering or bad key):', err.message);
      throw new VaultError('Failed to decrypt credentials. Possible payload corruption or invalid key.');
    }
  }

  /**
   * Recursively masks sensitive fields in objects for safe logging and API responses.
   */
  maskSecrets<T>(input: T): T {
    if (!input || typeof input !== 'object') {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.maskSecrets(item)) as unknown as T;
    }

    const masked: Record<string, any> = {};
    const SENSITIVE_KEY_REGEX = /token|secret|key|password|authorization|credential|cookie/i;

    for (const [key, value] of Object.entries(input)) {
      if (SENSITIVE_KEY_REGEX.test(key) && typeof value === 'string') {
        masked[key] = value.length > 8 ? `${value.slice(0, 3)}...${value.slice(-3)}` : '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSecrets(value);
      } else {
        masked[key] = value;
      }
    }

    return masked as T;
  }
}

export const credentialVaultService = new CredentialVaultService();
export default credentialVaultService;
