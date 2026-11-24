import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';

export class GoogleOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'google-workspace';
  readonly providerKeys = ['google-workspace', 'google_workspace', 'gmail', 'google-calendar', 'google-drive', 'google-docs'];

  isConfigured(): boolean {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, or connect using a direct Access Token (Bearer Token).'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const scopeParam = encodeURIComponent(params.scopes.join(' '));
    const redirectParam = encodeURIComponent(params.redirectUri);

    let url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${env.GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${redirectParam}` +
      `&response_type=code` +
      `&scope=${scopeParam}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${params.state}`;

    if (params.codeChallenge) {
      url += `&code_challenge=${params.codeChallenge}&code_challenge_method=S256`;
    }

    return url;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult> {
    if (process.env.NODE_ENV === 'test' && (!env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_google_access_${params.code}`,
        refreshToken: `mock_google_refresh_${params.code}`,
        expiresIn: 3600,
        tokenType: 'Bearer',
      };
    }

    const bodyParams = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
      ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`Google OAuth token exchange failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenType: json.token_type || 'Bearer',
      expiresIn: json.expires_in,
      scopes: json.scope ? json.scope.split(' ') : [],
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const bodyParams = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`Google OAuth token refresh failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      tokenType: json.token_type || 'Bearer',
      expiresIn: json.expires_in || 3600,
      scopes: json.scope ? json.scope.split(' ') : [],
    };
  }
}

export const googleOAuthProvider = new GoogleOAuthProvider();
