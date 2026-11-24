import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';

export class SlackOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'slack';

  isConfigured(): boolean {
    return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'Slack OAuth is not configured. Please set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env, or connect using a Slack Bot Token (Bearer Token).'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const scopeParam = encodeURIComponent(params.scopes.join(','));
    const redirectParam = encodeURIComponent(params.redirectUri);

    return (
      `https://slack.com/oauth/v2/authorize?` +
      `client_id=${env.SLACK_CLIENT_ID}` +
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
    if (process.env.NODE_ENV === 'test' && (!env.SLACK_CLIENT_SECRET || env.SLACK_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_slack_access_${params.code}`,
        tokenType: 'Bearer',
      };
    }

    const bodyParams = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code: params.code,
      redirect_uri: params.redirectUri,
    });

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });

    const json = (await res.json()) as any;
    if (!json.ok) {
      throw new BadRequestError(`Slack OAuth exchange failed: ${json.error}`);
    }

    return {
      accessToken: json.authed_user?.access_token || json.access_token,
      refreshToken: json.refresh_token,
      tokenType: 'Bearer',
      scopes: json.scope ? json.scope.split(',') : [],
    };
  }
}

export const slackOAuthProvider = new SlackOAuthProvider();
