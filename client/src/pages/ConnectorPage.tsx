import React, { useState, useMemo } from "react";
import { motion } from "motion/react";
import { Plug, Layers, Search, Plus, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import PageHeader from "../components/ui/PageHeader";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import ErrorMessage from "../components/ui/ErrorMessage";
import AnimatedTabs, { TabItem } from "../components/connectors/AnimatedTabs";
import ConnectorCard from "../components/connectors/ConnectorCard";
import ConnectionCard from "../components/connectors/ConnectionCard";
import CreateConnectionModal from "../components/connectors/CreateConnectionModal";
import ToolExplorerModal from "../components/connectors/ToolExplorerModal";
import OAuthCallbackBanner from "../components/connectors/OAuthCallbackBanner";
import {
  useConnectorCatalog,
  useConnections,
  useTestConnection,
  useDiscoverTools,
  useDeleteConnection,
} from "../hooks/useConnectors";
import type { ConnectorDefinition, ConnectorConnection } from "../types";

export const ConnectorPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"marketplace" | "connections">(
    "marketplace",
  );
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] =
    useState<ConnectorDefinition | null>(null);
  const [isToolExplorerOpen, setIsToolExplorerOpen] = useState(false);
  const [activeConnectionForTools, setActiveConnectionForTools] =
    useState<ConnectorConnection | null>(null);

  // Queries & Mutations
  const {
    data: catalog = [],
    isLoading: isLoadingCatalog,
    error: catalogError,
  } = useConnectorCatalog();

  const {
    data: connections = [],
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();

  const testMutation = useTestConnection();
  const discoverMutation = useDiscoverTools();
  const deleteMutation = useDeleteConnection();

  // Map of connector key to number of active connections configured
  const connectionCountsByKey = useMemo(() => {
    const map: Record<string, number> = {};
    connections.forEach((conn) => {
      const key = conn.connectorDefinition?.key;
      if (key) {
        map[key] = (map[key] || 0) + 1;
      }
    });
    return map;
  }, [connections]);

  // Filtered Marketplace connectors
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const matchesType = typeFilter === "ALL" || item.type === typeFilter;
      const matchesSearch =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.key.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [catalog, typeFilter, searchQuery]);

  // Filtered Active Connections
  const filteredConnections = useMemo(() => {
    return connections.filter((conn) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        conn.name.toLowerCase().includes(q) ||
        conn.connectorDefinition?.name.toLowerCase().includes(q) ||
        (conn.baseUrl && conn.baseUrl.toLowerCase().includes(q))
      );
    });
  }, [connections, searchQuery]);

  const handleOpenConnect = (connector: ConnectorDefinition) => {
    setSelectedConnector(connector);
    setIsCreateOpen(true);
  };

  const handleOpenCustomCreate = () => {
    setSelectedConnector(null);
    setIsCreateOpen(true);
  };

  const handleInspectTools = (conn: ConnectorConnection) => {
    setActiveConnectionForTools(conn);
    setIsToolExplorerOpen(true);
  };

  const mainTabs: TabItem[] = [
    {
      id: "marketplace",
      label: "Marketplace",
      //   count: catalog.length,
      icon: <Layers className="h-3.5 w-3.5" />,
    },
    {
      id: "connections",
      label: "My Connections",
      //   count: connections.length,
      icon: <Plug className="h-3.5 w-3.5" />,
    },
  ];

  const categoryFilterTabs: TabItem[] = [
    { id: "ALL", label: "All Types" },
    { id: "MCP", label: "MCP Servers" },
    { id: "NATIVE", label: "Native Apps" },
    { id: "CUSTOM_REST", label: "Custom REST" },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Top OAuth 2.0 Success Banner (if redirected from OAuth flow) */}
        <OAuthCallbackBanner />

        {/* Page Hero Header */}
        <PageHeader
          icon={Plug}
          eyebrow="Integrations & Agent Tools"
          title="Connectors & Integrations"
          description="Supercharge your autonomous AI agents with tools, external APIs, databases, and Model Context Protocol (MCP) remote capabilities."
          borderBottom
          actions={
            <Button
              onClick={handleOpenCustomCreate}
              className="h-9 text-xs font-semibold gap-1.5 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Connection</span>
            </Button>
          }
        />

        {/* Navigation & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          {/* Main Segmented Animated Tabs */}
          <AnimatedTabs
            tabs={mainTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as any)}
            layoutId="main-connector-tabs"
          />

          {/* Search Input Box */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === "marketplace"
                  ? "Search connectors"
                  : "Search your active connections..."
              }
              className="w-full rounded-xl bg-background/80 pl-9 pr-8 py-1.5 h-9 text-xs text-foreground placeholder:text-muted-foreground shadow-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tab 1: Connector Marketplace */}
        {activeTab === "marketplace" && (
          <div className="space-y-4">
            {/* Category Filter Tabs */}
            <div className="flex items-center justify-between">
              <AnimatedTabs
                tabs={categoryFilterTabs}
                activeTab={typeFilter}
                onChange={setTypeFilter}
                layoutId="marketplace-type-filters"
              />
              <span className="text-[11px] text-muted-foreground font-mono">
                Showing {filteredCatalog.length} of {catalog.length}{" "}
                integrations
              </span>
            </div>

            {/* Error handling */}
            {catalogError && (
              <ErrorMessage
                message={
                  (catalogError as Error).message || "Failed to load catalog."
                }
              />
            )}

            {/* Loading state */}
            {isLoadingCatalog ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <LoadingSpinner />
                <span className="text-xs">
                  Loading connector marketplace...
                </span>
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
                <Search className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <h3 className="text-sm font-semibold text-foreground">
                  No integrations found
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  No connectors matched "{searchQuery}". Try searching for
                  something else or configure a custom MCP server.
                </p>
                <Button
                  variant="outline"
                  onClick={handleOpenCustomCreate}
                  className="mt-4 text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Configure Custom Connection
                </Button>
              </div>
            ) : (
              /* Staggered Motion Grid for Connectors */
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: { opacity: 0 },
                  show: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.04,
                    },
                  },
                }}
              >
                {filteredCatalog.map((connector) => (
                  <motion.div
                    key={connector.id || connector.key}
                    variants={{
                      hidden: { opacity: 0, y: 12 },
                      show: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.25 },
                      },
                    }}
                  >
                    <ConnectorCard
                      connector={connector}
                      connectedCount={connectionCountsByKey[connector.key] || 0}
                      onConnect={handleOpenConnect}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        )}

        {/* Tab 2: My Connections */}
        {activeTab === "connections" && (
          <div className="space-y-4">
            {/* Error handling */}
            {connectionsError && (
              <ErrorMessage
                message={
                  (connectionsError as Error).message ||
                  "Failed to load connections."
                }
              />
            )}

            {/* Loading state */}
            {isLoadingConnections ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <LoadingSpinner />
                <span className="text-xs">Loading active connections...</span>
              </div>
            ) : filteredConnections.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/10 py-20 text-center px-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 mb-3 shadow-sm">
                  <Plug className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  No active connections yet
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">
                  Connect your workspace to Slack, Google Suite, GitHub, Jira,
                  or your custom Model Context Protocol (MCP) servers to allow
                  your agents to take real-world actions.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <Button
                    onClick={() => setActiveTab("marketplace")}
                    className="text-xs gap-1.5 shadow-sm font-semibold"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Browse Marketplace
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleOpenCustomCreate}
                    className="text-xs gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Custom MCP Server
                  </Button>
                </div>
              </div>
            ) : (
              /* Staggered Motion Grid for Active Connections */
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: { opacity: 0 },
                  show: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.04,
                    },
                  },
                }}
              >
                {filteredConnections.map((connection) => (
                  <motion.div
                    key={connection.id}
                    variants={{
                      hidden: { opacity: 0, y: 12 },
                      show: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.25 },
                      },
                    }}
                  >
                    <ConnectionCard
                      connection={connection}
                      onTest={(id) => testMutation.mutateAsync(id)}
                      onDiscover={(id) => discoverMutation.mutateAsync(id)}
                      onInspectTools={handleInspectTools}
                      onDelete={(id) => deleteMutation.mutateAsync(id)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* Create Connection Modal */}
      <CreateConnectionModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        connector={selectedConnector}
        onSuccess={() => {
          setActiveTab("connections");
          refetchConnections();
        }}
      />

      {/* Tool Explorer & Sandbox Playground Modal */}
      <ToolExplorerModal
        open={isToolExplorerOpen}
        onOpenChange={setIsToolExplorerOpen}
        connection={activeConnectionForTools}
      />
    </div>
  );
};

export default ConnectorPage;
