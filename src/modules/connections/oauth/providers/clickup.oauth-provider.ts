import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';

export class ClickUpOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'clickup';

  isConfigured(): boolean {
    return Boolean(env.CLICKUP_CLIENT_ID && env.CLICKUP_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'ClickUp OAuth is not configured. Please set CLICKUP_CLIENT_ID and CLICKUP_CLIENT_SECRET in .env, or connect using a Personal API Token.'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const query = new URLSearchParams({
      client_id: env.CLICKUP_CLIENT_ID,
      redirect_uri: params.redirectUri,
      state: params.state,
    });

    return `https://app.clickup.com/api?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult> {
    if (process.env.NODE_ENV === 'test' && (!env.CLICKUP_CLIENT_SECRET || env.CLICKUP_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_clickup_access_${params.code}`,
        tokenType: 'Bearer',
      };
    }

    const bodyParams = {
      client_id: env.CLICKUP_CLIENT_ID,
      client_secret: env.CLICKUP_CLIENT_SECRET,
      code: params.code,
    };

    const res = await fetch('https://api.clickup.com/api/v2/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyParams),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`ClickUp OAuth exchange failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    if (json.err || json.error) {
      throw new BadRequestError(`ClickUp OAuth exchange failed: ${json.err || json.error}`);
    }

    return {
      accessToken: json.access_token,
      tokenType: json.token_type || 'Bearer',
    };
  }
}

export const clickupOAuthProvider = new ClickUpOAuthProvider();
