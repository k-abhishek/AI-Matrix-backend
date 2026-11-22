import React from "react";
import { ExternalLink, Plus, Check } from "lucide-react";
import SpotlightCard from "./SpotlightCard";
import ConnectorIcon from "./ConnectorIcon";
import { Button } from "../ui/button";
import type { ConnectorDefinition } from "../../types";
import { cn } from "../../utils/cn";

interface ConnectorCardProps {
  connector: ConnectorDefinition;
  connectedCount?: number;
  onConnect: (connector: ConnectorDefinition) => void;
}

/**
 * Friendly label for supported auth types.
 */
function formatAuthType(auth: string): string {
  switch (auth) {
    case "OAUTH2_AUTHORIZATION_CODE":
      return "OAuth 2.0";
    case "API_KEY":
      return "API Key";
    case "BEARER_TOKEN":
      return "Bearer Token";
    case "BASIC_AUTH":
      return "Basic Auth";
    case "CUSTOM_HEADERS":
      return "Headers";
    case "NONE":
      return "No Auth";
    default:
      return auth.replace(/_/g, " ");
  }
}

export const ConnectorCard: React.FC<ConnectorCardProps> = ({
  connector,
  connectedCount = 0,
  onConnect,
}) => {
  const isConnected = connectedCount > 0;

  // const typeBadgeStyles =
  //   {
  //     MCP: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  //     NATIVE:
  //       "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  //     CUSTOM_REST:
  //       "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  //   }[connector.type] || "bg-muted text-muted-foreground border-border";

  return (
    <SpotlightCard className="flex flex-col justify-between h-full bg-card/70 backdrop-blur-sm transition-all hover:translate-y-[-2px]">
      <div>
        {/* Top Header: Icon + Name + Type Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ConnectorIcon
              connectorKey={connector.key}
              name={connector.name}
              iconUrl={connector.iconUrl}
            />
            <div>
              <h3 className="font-semibold text-sm text-foreground leading-tight flex items-center gap-2">
                {connector.name}
              </h3>
              {connector.docUrl ? (
                <a
                  href={connector.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group/link"
                >
                  <span>Docs</span>
                  <ExternalLink className="h-3 w-3 transition-transform group-hover/link:translate-x-0.5" />
                </a>
              ) : (
                <span className="text-[11px] text-muted-foreground/60">
                  Built-in
                </span>
              )}
              {/* <span
                className={cn(
                  "mt-1 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none tracking-wide uppercase",
                  typeBadgeStyles,
                )}
              >
                {connector.type.replace("_", " ")}
              </span> */}
            </div>
          </div>
          <Button
            size='sm'
            variant={isConnected ? "outline" : "default"}
            onClick={() => onConnect(connector)}
            className={cn(
              "h-8 px-3 text-xs font-medium gap-1.5 transition-all",
              isConnected
                ? "border-border/80 hover:bg-muted text-foreground"
                : "shadow-sm hover:shadow-md",
            )}
          >
            {isConnected ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                Add Another
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Connect
              </>
            )}
          </Button>

          {/* Connected indicator status if already configured */}
          {isConnected && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Connected ({connectedCount})
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-3.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {connector.description}
        </p>

        {/* Supported Authentication Methods */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/80 uppercase font-mono tracking-wider mr-1">
            Auth:
          </span>
          {connector.supportedAuth.slice(0, 3).map((auth) => (
            <span
              key={auth}
              className="rounded-md bg-muted/60 border border-border/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80"
            >
              {formatAuthType(auth)}
            </span>
          ))}
          {connector.supportedAuth.length > 3 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              +{connector.supportedAuth.length - 3}
            </span>
          )}
        </div>
      </div>
    </SpotlightCard>
  );
};

export default ConnectorCard;
