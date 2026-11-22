import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import {
  useCreateConnection,
  useInitiateAuth,
  useDiscoverTools,
} from '../../hooks/useConnectors';
import {
  Loader2,
  Lock,
  Globe,
  Cpu,
  Key,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import {
  searchBrands,
  getBrandfetchLogoUrl,
  type BrandSearchResult,
} from '../../services/brandfetch';
import type {
  ConnectorDefinition,
  ConnectorConnection,
  ConnectionAuthType,
  McpTransportType,
  ConnectorType,
} from '../../types';

interface CreateConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: ConnectorDefinition | null;
  onSuccess?: (connection: ConnectorConnection) => void;
}

export const CreateConnectionModal: React.FC<CreateConnectionModalProps> = ({
  open,
  onOpenChange,
  connector,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [customType, setCustomType] = useState<ConnectorType>('MCP');
  const [baseUrl, setBaseUrl] = useState('');
  const [transport, setTransport] = useState<McpTransportType>('STREAMABLE_HTTP');
  const [authType, setAuthType] = useState<ConnectionAuthType>('NONE');
  const [apiKey, setApiKey] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const createMutation = useCreateConnection();
  const authMutation = useInitiateAuth();
  const discoverMutation = useDiscoverTools();

  // Autocomplete company name to domain using Brand Search API
  useEffect(() => {
    if (!connector && name.trim().length >= 2) {
      const timer = setTimeout(async () => {
        const results = await searchBrands(name.trim());
        setBrandSuggestions(results.slice(0, 5));
        setShowSuggestions(results.length > 0);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setBrandSuggestions([]);
      setShowSuggestions(false);
    }
  }, [name, connector]);

  const handleSelectBrand = (brand: BrandSearchResult) => {
    setName(brand.name);
    if (!baseUrl || baseUrl.trim() === '') {
      setBaseUrl(`https://${brand.domain}`);
    }
    setShowSuggestions(false);
  };

  // Reset form when modal opens or connector changes
  useEffect(() => {
    if (open) {
      if (connector) {
        setName(connector.name);
        setBaseUrl((connector.defaultConfig as any)?.serverUrl || '');
        setTransport((connector.defaultConfig as any)?.transport || 'STREAMABLE_HTTP');
        const defaultAuth = connector.supportedAuth[0] || 'NONE';
        setAuthType(defaultAuth);
      } else {
        setName('Custom MCP Connection');
        setCustomType('MCP');
        setBaseUrl('');
        setTransport('STREAMABLE_HTTP');
        setAuthType('NONE');
      }
      setApiKey('');
      setBearerToken('');
      setUsername('');
      setPassword('');
      setFormError(null);
    }
  }, [open, connector]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Please enter a connection name.');
      return;
    }

    const isMcpOrRest = connector ? (connector.type !== 'NATIVE' || connector.key === 'jira') : true;
    if (isMcpOrRest && !baseUrl.trim()) {
      setFormError(connector?.key === 'jira' ? 'Atlassian Cloud URL (e.g. https://your-domain.atlassian.net) is required.' : 'Server Base URL is required for MCP and REST integrations.');
      return;
    }

    // Build credentials object based on auth type
    const credentials: Record<string, any> = {};
    if (authType === 'API_KEY') {
      if (!apiKey.trim()) {
        setFormError('API Key is required.');
        return;
      }
      credentials.apiKey = apiKey.trim();
    } else if (authType === 'BEARER_TOKEN') {
      if (!bearerToken.trim()) {
        setFormError('Bearer Token is required.');
        return;
      }
      credentials.accessToken = bearerToken.trim();
    } else if (authType === 'BASIC_AUTH') {
      if (!username.trim() || !password) {
        setFormError('Both username and password are required for Basic Auth.');
        return;
      }
      credentials.username = username.trim();
      credentials.password = password;
    }

    try {
      const createdConnection = await createMutation.mutateAsync({
        name: trimmedName,
        connectorDefinitionId: connector?.id,
        connectorKey: connector?.key,
        authType,
        baseUrl: baseUrl.trim() || undefined,
        mcpTransport: (connector?.type === 'MCP' || (!connector && customType === 'MCP')) ? transport : undefined,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      });

      // Handle OAuth authorization flow redirect if OAuth2 is chosen
      if (authType === 'OAUTH2_AUTHORIZATION_CODE') {
        const authRes = await authMutation.mutateAsync({
          id: createdConnection.id,
        });

        if (authRes.authorizationUrl) {
          // Redirect browser to OAuth provider authentication consent screen
          window.location.href = authRes.authorizationUrl;
          return;
        }
      }

      // If direct credentials or no auth, run initial tool discovery
      if (createdConnection.id) {
        discoverMutation.mutate(createdConnection.id);
      }

      onSuccess?.(createdConnection);
      onOpenChange(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create connection.');
    }
  };

  const isPending = createMutation.isPending || authMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card/95 backdrop-blur-md border-border/80 shadow-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {connector ? `Connect ${connector.name}` : 'Create Custom Integration'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {connector
                ? connector.description
                : 'Configure a remote Model Context Protocol (MCP) or Custom REST endpoint.'}
            </DialogDescription>
          </DialogHeader>

          {/* Form Error Banner */}
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="mt-4 space-y-4 text-xs">
            {/* If no preselected connector, choose MCP vs REST */}
            {!connector && (
              <div>
                <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
                  Integration Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomType('MCP')}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 font-medium transition-colors ${
                      customType === 'MCP'
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Cpu className="h-4 w-4" />
                    MCP Server
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomType('CUSTOM_REST')}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 font-medium transition-colors ${
                      customType === 'CUSTOM_REST'
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Globe className="h-4 w-4" />
                    Custom REST API
                  </button>
                </div>
              </div>
            )}

            {/* Connection Name */}
            <div className="relative">
              <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                Connection Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stripe, Linear, Slack, or GitHub"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />

              {/* Brandfetch Company Autocomplete Dropdown */}
              {showSuggestions && brandSuggestions.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-border/80 bg-popover/95 p-1 shadow-lg backdrop-blur-md">
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase font-mono flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Brandfetch Autocomplete
                  </div>
                  <div className="space-y-0.5 mt-0.5">
                    {brandSuggestions.map((brand) => {
                      const logoUrl = getBrandfetchLogoUrl(brand.domain);
                      return (
                        <button
                          key={brand.domain}
                          type="button"
                          onClick={() => handleSelectBrand(brand)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/80 transition-colors text-left"
                        >
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt={brand.name}
                              className="h-4 w-4 rounded-xs object-contain shrink-0"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-foreground truncate">{brand.name}</span>
                            <span className="text-[10px] text-muted-foreground font-mono truncate">{brand.domain}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Base URL (for MCP, REST, or Jira) */}
            {(connector ? (connector.type !== 'NATIVE' || connector.key === 'jira') : true) && (
              <div>
                <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                  {connector?.key === 'jira' ? 'Atlassian Cloud Instance URL' : 'Server Endpoint / Base URL'} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={connector?.key === 'jira' ? 'https://your-domain.atlassian.net' : 'https://mcp.yourdomain.com/v1'}
                  className="font-mono text-xs h-8"
                  required
                />
              </div>
            )}

            {/* Authentication Method Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                Authentication Method
              </label>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as ConnectionAuthType)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {connector ? (
                  connector.supportedAuth.map((auth) => (
                    <option key={auth} value={auth}>
                      {auth === 'BASIC_AUTH' && connector.key === 'jira'
                        ? 'Atlassian API Token (Basic Auth - Recommended)'
                        : auth === 'BEARER_TOKEN' && connector.key === 'notion'
                        ? 'Internal Integration Secret (Recommended)'
                        : auth === 'BEARER_TOKEN' && connector.key === 'slack'
                        ? 'Slack Bot User Token (Recommended)'
                        : auth === 'API_KEY' && connector.key === 'clickup'
                        ? 'ClickUp Personal API Token (Recommended)'
                        : auth.replace(/_/g, ' ')}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="NONE">NONE (No Authentication)</option>
                    <option value="API_KEY">API Key</option>
                    <option value="BEARER_TOKEN">Bearer Token</option>
                    <option value="BASIC_AUTH">Basic Authentication</option>
                    <option value="CUSTOM_HEADERS">Custom Headers</option>
                  </>
                )}
              </select>
            </div>

            {/* Conditional Credential Inputs */}
            {authType === 'OAUTH2_AUTHORIZATION_CODE' && (
              <Alert variant="info" className="py-2.5">
                <ExternalLink className="h-4 w-4" />
                <div>
                  <AlertTitle className="text-xs font-semibold">
                    OAuth 2.0 Authorization Flow
                  </AlertTitle>
                  <AlertDescription className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Clicking "Authorize with OAuth" redirects you to the vendor consent page. Note: If OAuth credentials are not configured in your server environment, or if you encounter Google/vendor restriction errors, choose <strong>Direct Token / API Key / Basic Auth</strong> as a native fallback.
                  </AlertDescription>
                </div>
              </Alert>
            )}

            {authType === 'API_KEY' && (
              <div>
                <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                  {connector?.key === 'clickup' ? 'ClickUp Personal API Token' : 'API Key'} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground z-10" />
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={connector?.key === 'clickup' ? 'pk_12345678_...' : 'Enter confidential API key...'}
                    className="pl-8 font-mono text-xs h-8"
                    required
                  />
                </div>
              </div>
            )}

            {authType === 'BEARER_TOKEN' && (
              <div>
                <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                  {connector?.key === 'notion'
                    ? 'Notion Internal Integration Secret'
                    : connector?.key === 'slack'
                    ? 'Slack Bot User OAuth Token'
                    : connector?.key === 'gmail'
                    ? 'Google OAuth Access Token / App Password'
                    : 'Bearer Token'} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground z-10" />
                  <Input
                    type="password"
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    placeholder={
                      connector?.key === 'notion'
                        ? 'secret_... or ntn_...'
                        : connector?.key === 'slack'
                        ? 'xoxb-...'
                        : 'eyJhbGciOi...'
                    }
                    className="pl-8 font-mono text-xs h-8"
                    required
                  />
                </div>
              </div>
            )}

            {authType === 'BASIC_AUTH' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                    {connector?.key === 'jira' ? 'Atlassian Email' : 'Username'}
                  </label>
                  <Input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={connector?.key === 'jira' ? 'you@company.com' : 'user@example.com'}
                    className="text-xs h-8"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
                    {connector?.key === 'jira' ? 'Atlassian API Token' : 'Password / Token'}
                  </label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={connector?.key === 'jira' ? 'ATATT3xFfGF...' : '••••••••'}
                    className="text-xs h-8"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6 flex items-center justify-end gap-2 border-t border-border/40 pt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-8 px-4 text-xs font-semibold gap-1.5 shadow-sm"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {authType === 'OAUTH2_AUTHORIZATION_CODE' ? 'Authorize with OAuth' : 'Save Connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateConnectionModal;
