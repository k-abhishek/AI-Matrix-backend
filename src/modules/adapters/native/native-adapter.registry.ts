import { BaseConnectorAdapter } from '../base.adapter';
import jiraNativeAdapter from './jira.native-adapter';
import notionNativeAdapter from './notion.native-adapter';
import clickupNativeAdapter from './clickup.native-adapter';
import slackNativeAdapter from './slack.native-adapter';
import gmailNativeAdapter from './gmail.native-adapter';
import githubNativeAdapter from './github.native-adapter';

export class NativeAdapterRegistry {
  private adapters = new Map<string, BaseConnectorAdapter>();

  constructor() {
    this.register(jiraNativeAdapter.connectorKey, jiraNativeAdapter);
    this.register(notionNativeAdapter.connectorKey, notionNativeAdapter);
    this.register(clickupNativeAdapter.connectorKey, clickupNativeAdapter);
    this.register(slackNativeAdapter.connectorKey, slackNativeAdapter);
    this.register(gmailNativeAdapter.connectorKey, gmailNativeAdapter);
    this.register('google-workspace', gmailNativeAdapter);
    this.register(githubNativeAdapter.connectorKey, githubNativeAdapter);
  }

  register(key: string, adapter: BaseConnectorAdapter) {
    this.adapters.set(key.toLowerCase(), adapter);
  }

  getAdapter(key: string): BaseConnectorAdapter | undefined {
    return this.adapters.get(key.toLowerCase());
  }

  hasAdapter(key: string): boolean {
    return this.adapters.has(key.toLowerCase());
  }
}

export const nativeAdapterRegistry = new NativeAdapterRegistry();
export default nativeAdapterRegistry;
