export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scopes?: string[];
  extraData?: Record<string, any>;
}

export interface IOAuthProviderHandler {
  readonly providerKey: string;
  readonly providerKeys?: string[];
  isConfigured(): boolean;
  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string;
  exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult>;
  refreshToken?(refreshToken: string): Promise<OAuthTokenResult>;
}
