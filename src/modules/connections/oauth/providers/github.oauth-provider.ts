import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';

export class GitHubOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'github';

  isConfigured(): boolean {
    return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env, or connect using a Personal Access Token.'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const defaultScopes = ['repo', 'read:user', 'user:email'];
    const activeScopes = params.scopes.length > 0 ? params.scopes : defaultScopes;
    const scopeParam = encodeURIComponent(activeScopes.join(' '));
    const redirectParam = encodeURIComponent(params.redirectUri);

    return (
      `https://github.com/login/oauth/authorize?` +
      `client_id=${env.GITHUB_CLIENT_ID}` +
      `&redirect_uri=${redirectParam}` +
      `&scope=${scopeParam}` +
      `&state=${params.state}`
    );
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult> {
    if (process.env.NODE_ENV === 'test' && (!env.GITHUB_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_github_access_${params.code}`,
        tokenType: 'Bearer',
        scopes: ['repo', 'read:user', 'user:email'],
      };
    }

    const bodyParams = {
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: params.code,
      redirect_uri: params.redirectUri,
    };

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(bodyParams),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`GitHub OAuth exchange failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    if (json.error) {
      throw new BadRequestError(`GitHub OAuth exchange failed: ${json.error_description || json.error}`);
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenType: json.token_type || 'Bearer',
      expiresIn: json.expires_in,
      scopes: json.scope ? json.scope.split(',') : ['repo', 'read:user'],
    };
  }
}

export const githubOAuthProvider = new GitHubOAuthProvider();
