import env from '../../../../config/env';
import { BadRequestError } from '../../../../lib/errors';
import { IOAuthProviderHandler, OAuthTokenResult } from '../oauth-provider.interface';

export class NotionOAuthProvider implements IOAuthProviderHandler {
  readonly providerKey = 'notion';

  isConfigured(): boolean {
    return Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!this.isConfigured()) {
      const err = new BadRequestError(
        'Notion OAuth is not configured. Please set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in .env, or connect using an Internal Integration Secret (API Token).'
      );
      (err as any).code = 'OAUTH_NOT_CONFIGURED';
      throw err;
    }

    const redirectParam = encodeURIComponent(params.redirectUri);

    return (
      `https://api.notion.com/v1/oauth/authorize?` +
      `client_id=${env.NOTION_CLIENT_ID}` +
      `&response_type=code` +
      `&owner=user` +
      `&redirect_uri=${redirectParam}` +
      `&state=${params.state}`
    );
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<OAuthTokenResult> {
    if (process.env.NODE_ENV === 'test' && (!env.NOTION_CLIENT_SECRET || env.NOTION_CLIENT_SECRET.includes('mock'))) {
      return {
        accessToken: `mock_notion_access_${params.code}`,
        tokenType: 'Bearer',
        extraData: { workspace_name: 'Mock Notion Workspace' },
      };
    }

    const basicAuth = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString('base64');

    const res = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new BadRequestError(`Notion OAuth exchange failed: ${errorText}`);
    }

    const json = (await res.json()) as any;
    if (json.error) {
      throw new BadRequestError(`Notion OAuth exchange failed: ${json.error}`);
    }

    return {
      accessToken: json.access_token,
      tokenType: 'Bearer',
      extraData: {
        workspaceId: json.workspace_id,
        workspaceName: json.workspace_name,
        botId: json.bot_id,
      },
    };
  }
}

export const notionOAuthProvider = new NotionOAuthProvider();
