import { IOAuthProviderHandler } from './oauth-provider.interface';
import { googleOAuthProvider } from './providers/google.oauth-provider';
import { slackOAuthProvider } from './providers/slack.oauth-provider';
import { githubOAuthProvider } from './providers/github.oauth-provider';
import { notionOAuthProvider } from './providers/notion.oauth-provider';
import { clickupOAuthProvider } from './providers/clickup.oauth-provider';
import { jiraOAuthProvider } from './providers/jira.oauth-provider';

export class OAuthProviderRegistry {
  private handlers = new Map<string, IOAuthProviderHandler>();

  constructor() {
    this.register(googleOAuthProvider);
    this.register(slackOAuthProvider);
    this.register(githubOAuthProvider);
    this.register(notionOAuthProvider);
    this.register(clickupOAuthProvider);
    this.register(jiraOAuthProvider);
  }

  register(handler: IOAuthProviderHandler): void {
    this.handlers.set(handler.providerKey.toLowerCase(), handler);
    if (handler.providerKeys) {
      for (const key of handler.providerKeys) {
        this.handlers.set(key.toLowerCase(), handler);
      }
    }
  }

  getHandler(provider: string): IOAuthProviderHandler | undefined {
    return this.handlers.get(provider.toLowerCase());
  }

  hasHandler(provider: string): boolean {
    return this.handlers.has(provider.toLowerCase());
  }

  isConfigured(provider: string): boolean {
    const handler = this.getHandler(provider);
    return Boolean(handler && handler.isConfigured());
  }
}

export const oauthProviderRegistry = new OAuthProviderRegistry();
export default oauthProviderRegistry;
