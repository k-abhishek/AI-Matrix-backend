export interface EncryptedPayload {
  encryptedData: string;
  iv: string;
  authTag: string;
  keyId: string;
}

export interface CredentialData {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  clientSecret?: string;
  clientId?: string;
  username?: string;
  password?: string;
  customHeaders?: Record<string, string>;
  expiresAt?: Date | string;
  refreshTokenExpiresAt?: Date | string;
  scopes?: string[];
  raw?: Record<string, any>;
  [key: string]: any;
}
