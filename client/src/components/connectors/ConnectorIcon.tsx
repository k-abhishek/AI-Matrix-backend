import React, { useState } from "react";
import {
  Cpu,
  Globe,
  Mail,
  Calendar,
  HardDrive,
  FileText,
  MessageSquare,
  GitBranch,
  Bookmark,
  CheckSquare,
  Layers,
} from "lucide-react";
import { cn } from "../../utils/cn";
import {
  BRANDFETCH_CLIENT_ID,
  getBrandfetchLogoUrl,
} from "../../services/brandfetch";

export const CONNECTOR_DOMAINS: Record<string, string> = {
  gmail: "google.com",
  "google-calendar": "google.com",
  "google-drive": "google.com",
  "google-docs": "google.com",
  slack: "slack.com",
  github: "github.com",
  notion: "notion.so",
  jira: "atlassian.com",
  brandfetch: "brandfetch.com",
};

export const SIMPLE_ICON_SLUGS: Record<string, string> = {
  gmail: "gmail",
  "google-calendar": "googlecalendar",
  "google-drive": "googledrive",
  "google-docs": "googledocs",
  slack: "slack",
  github: "github",
  notion: "notion",
  jira: "jira",
};

export interface ConnectorIconProps {
  connectorKey?: string;
  name?: string;
  domain?: string;
  iconUrl?: string | null;
  className?: string;
}

function getFallbackLucideIcon(key?: string, className = "h-5 w-5") {
  switch (key) {
    case "gmail":
      return <Mail className={cn(className, "text-red-500")} />;
    case "google-calendar":
      return <Calendar className={cn(className, "text-blue-500")} />;
    case "google-drive":
      return <HardDrive className={cn(className, "text-emerald-500")} />;
    case "google-docs":
      return <FileText className={cn(className, "text-blue-600")} />;
    case "slack":
      return <MessageSquare className={cn(className, "text-amber-500")} />;
    case "github":
      return <GitBranch className={cn(className, "text-foreground")} />;
    case "notion":
      return <Bookmark className={cn(className, "text-foreground")} />;
    case "jira":
      return <CheckSquare className={cn(className, "text-blue-500")} />;
    case "mcp-server":
      return <Cpu className={cn(className, "text-purple-500")} />;
    case "custom-rest":
      return <Globe className={cn(className, "text-teal-500")} />;
    default:
      return <Layers className={cn(className, "text-primary")} />;
  }
}

/**
 * Renders company logos and brand icons using Brandfetch Logo API:
 * https://cdn.brandfetch.io/domain/{domain}?c={CLIENT_ID}
 * with fallback to SimpleIcons and Lucide icons.
 */
export const ConnectorIcon: React.FC<ConnectorIconProps> = ({
  connectorKey = "",
  name = "",
  domain,
  iconUrl,
  className = "h-8 w-8 rounded-md",
}) => {
  const [useFallback, setUseFallback] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  // 1. Resolve Brandfetch target domain
  const targetDomain =
    domain ||
    CONNECTOR_DOMAINS[connectorKey] ||
    (name && name.includes(".") ? name : null) ||
    (connectorKey &&
    connectorKey !== "mcp-server" &&
    connectorKey !== "custom-rest"
      ? `${connectorKey.replace(/-/g, "")}.com`
      : null);

  const brandfetchUrl =
    targetDomain && BRANDFETCH_CLIENT_ID
      ? getBrandfetchLogoUrl(targetDomain)
      : null;

  // 2. SimpleIcons fallback slug
  const simpleSlug =
    SIMPLE_ICON_SLUGS[connectorKey] ||
    (connectorKey !== "mcp-server" && connectorKey !== "custom-rest" && name
      ? name.toLowerCase().replace(/[^a-z0-9]/g, "")
      : null);

  const simpleIconsUrl =
    iconUrl && !iconUrl.includes("assets.matrix.ai")
      ? iconUrl
      : simpleSlug
        ? `https://cdn.simpleicons.org/${simpleSlug}`
        : null;

  // Primary: Brandfetch Logo API
  if (!useFallback && brandfetchUrl) {
    return (
      <img
        src={brandfetchUrl}
        alt={name || connectorKey}
        className={cn(
          className,
          "object-contain transition-transform group-hover/icon:scale-105",
        )}
        loading="lazy"
        onError={() => setUseFallback(true)}
      />
    );
  }

  // Secondary fallback: SimpleIcons or custom iconUrl
  if (!fallbackFailed && simpleIconsUrl) {
    const needsInvertInDark =
      simpleSlug === "github" || simpleSlug === "notion";
    return (
      <img
        src={simpleIconsUrl}
        alt={name || connectorKey}
        className={cn(
          className,
          "object-contain transition-transform group-hover/icon:scale-105",
          needsInvertInDark && "dark:brightness-0 dark:invert",
        )}
        loading="lazy"
        onError={() => setFallbackFailed(true)}
      />
    );
  }

  // Final fallback: Lucide icon
  return getFallbackLucideIcon(connectorKey, className);
};

export default ConnectorIcon;
