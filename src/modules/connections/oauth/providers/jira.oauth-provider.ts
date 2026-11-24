import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';
import logger from '../../../../lib/logger';

export class JiraOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'jira';

  isConfigured(): boolean {
    return Boolean(env.JIRA_CLIENT_ID && env.JIRA_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'Jira OAuth is not configured. Please set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET in .env, or connect using an Atlassian API Token (Basic Auth).'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const defaultScopes = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'];
    const activeScopes = params.scopes.length > 0 ? params.scopes : defaultScopes;
    const scopeParam = encodeURIComponent(activeScopes.join(' '));
    const redirectParam = encodeURIComponent(params.redirectUri);

    return (
      `https://auth.atlassian.com/authorize?` +
      `audience=api.atlassian.com` +
      `&client_id=${env.JIRA_CLIENT_ID}` +
      `&scope=${scopeParam}` +
      `&redirect_uri=${redirectParam}` +
      `&state=${params.state}` +
      `&response_type=code` +
      `&prompt=consent`
    );
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult> {
    if (process.env.NODE_ENV === 'test' && (!env.JIRA_CLIENT_SECRET || env.JIRA_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_jira_access_${params.code}`,
        refreshToken: `mock_jira_refresh_${params.code}`,
        expiresIn: 3600,
        tokenType: 'Bearer',
        scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
        extraData: {
          cloudId: 'mock-cloud-id-12345',
          siteUrl: 'https://mock.atlassian.net',
          siteName: 'Mock Jira Site',
        },
      };
    }

    const bodyParams = {
      grant_type: 'authorization_code',
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      code: params.code,
      redirect_uri: params.redirectUri,
    };

    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyParams),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`Jira OAuth exchange failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    const accessToken = json.access_token;

    // Fetch accessible-resources to determine cloudId for API requests
    let extraData: Record<string, any> = {};
    try {
      const resourceRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (resourceRes.ok) {
        const resources = (await resourceRes.json()) as any[];
        if (Array.isArray(resources) && resources.length > 0) {
          extraData = {
            cloudId: resources[0].id,
            siteUrl: resources[0].url,
            siteName: resources[0].name,
          };
        }
      }
    } catch (err: any) {
      logger.warn(`[JiraOAuthProvider] Failed to fetch accessible-resources: ${err.message}`);
    }

    return {
      accessToken,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      tokenType: json.token_type || 'Bearer',
      scopes: json.scope ? json.scope.split(' ') : [],
      extraData,
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const bodyParams = {
      grant_type: 'refresh_token',
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      refresh_token: refreshToken,
    };

    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyParams),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`Jira OAuth token refresh failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresIn: json.expires_in || 3600,
      tokenType: json.token_type || 'Bearer',
      scopes: json.scope ? json.scope.split(' ') : [],
    };
  }
}

export const jiraOAuthProvider = new JiraOAuthProvider();
