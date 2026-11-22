import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import ErrorMessage from "../components/ui/ErrorMessage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import PageHeader from "../components/ui/PageHeader";
import { CreateCrawlerModal } from "../components/crawler/CreateCrawlerModal";
import { useCrawlers, useCrawlerMetrics } from "../hooks/useKnowledgeBase";
import {
  BookOpen,
  Search,
  ArrowRight,
  FileText,
  Sparkles,
  Plus,
  Globe,
  Clock,
} from "lucide-react";
import { formatDate, formatBytes } from "../utils/helpers";
import type { Crawler } from "../types";

const CrawlerCardItem: React.FC<{
  crawler: Crawler;
  onClick: () => void;
}> = ({ crawler, onClick }) => {
  const { data: metrics } = useCrawlerMetrics(crawler.id);

  return (
    <Card className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50 relative overflow-hidden group">
      <div
        onClick={onClick}
        className="flex flex-col h-full justify-between space-y-4"
      >
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary truncate">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[200px]">
                {crawler.baseUrl || new URL(crawler.sitemapUrl).hostname}
              </span>
            </span>
            <StatusBadge
              status={
                crawler.isRunning
                  ? "RUNNING"
                  : crawler.enabled
                    ? "ACTIVE"
                    : "IDLE"
              }
              variant={
                crawler.isRunning
                  ? "info"
                  : crawler.enabled
                    ? "success"
                    : "info"
              }
            />
          </div>

          <h3 className="mt-2.5 font-semibold text-sm text-foreground group-hover:text-primary transition-colors leading-snug">
            {crawler.name}
          </h3>

          <p className="mt-1 text-xs text-muted-foreground truncate font-mono">
            {crawler.sitemapUrl}
          </p>

          {/* Metrics summary */}
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2.5 text-center text-xs">
            <div>
              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                Pages
              </span>
              <span className="font-bold text-foreground font-mono">
                {metrics?.totalPages ?? crawler._count?.crawledPages ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                Chunks
              </span>
              <span className="font-bold text-foreground font-mono">
                {metrics?.totalChunks ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                Storage
              </span>
              <span className="font-bold text-foreground font-mono">
                {formatBytes(
                  metrics?.storage?.currentUsageBytes ??
                    metrics?.totalBytes ??
                    0,
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-medium text-primary">
          <span className="flex items-center gap-1 text-muted-foreground text-[11px]">
            <Clock className="h-3 w-3" />
            {metrics?.lastCrawledAt
              ? `Crawled ${formatDate(metrics.lastCrawledAt)}`
              : "Not crawled yet"}
          </span>
          <span className="flex items-center gap-1 text-primary group-hover:translate-x-0.5 transition-transform">
            View Details
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Card>
  );
};

const knowledgeArticles = [
  {
    title: "Getting Started with the AI Platform",
    category: "Introduction",
    description:
      "Learn how to configure your workspace, connect APIs, and initiate your first model runs.",
  },
  {
    title: "Prompt Engineering & System Directives",
    category: "Guides",
    description:
      "Best practices for writing effective prompts, structuring multi-turn dialogues, and managing tokens.",
  },
  {
    title: "Retrieval Augmented Generation (RAG)",
    category: "Architecture",
    description:
      "How to index documents, generate embeddings, and build grounded semantic search workflows.",
  },
];

export const KnowledgeBasePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const {
    data: crawlers,
    isLoading: isCrawlersLoading,
    error: crawlersError,
  } = useCrawlers();

  const filteredCrawlers = (crawlers || []).filter((crawler) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      crawler.name.toLowerCase().includes(query) ||
      crawler.sitemapUrl.toLowerCase().includes(query) ||
      (crawler.baseUrl && crawler.baseUrl.toLowerCase().includes(query))
    );
  });

  const filteredArticles = knowledgeArticles.filter((article) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      article.title.toLowerCase().includes(query) ||
      article.description.toLowerCase().includes(query) ||
      article.category.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex-1 p-6 md:p-8 space-y-10 max-w-6xl mx-auto w-full">
      {/* Header Banner */}
      <PageHeader
        icon={BookOpen}
        eyebrow="Documentation & Knowledge Base"
        title="Knowledge Base"
        description="Manage knowledge base to index online documentation and knowledge resources directly into your vector database for AI search and RAG workflows."
      />

      {/* Search Input & Add Crawler Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search crawlers and documentation..."
            className="pl-10"
          />
        </div>

        {/* Button to the right of input */}
        <Button onClick={() => setIsCreateModalOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span>Add Crawler</span>
        </Button>
      </div>

      {/* Crawlers Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Registered Knowledge Base ({filteredCrawlers.length})
          </h2>
        </div>

        {isCrawlersLoading ? (
          <div className="flex justify-center p-12">
            <LoadingSpinner />
          </div>
        ) : crawlersError ? (
          <ErrorMessage
            message={
              (crawlersError as Error)?.message || "Failed to fetch crawlers"
            }
          />
        ) : filteredCrawlers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCrawlers.map((crawler) => (
              <CrawlerCardItem
                key={crawler.id}
                crawler={crawler}
                onClick={() => navigate(`/knowledge-base/${crawler.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                No Crawlers Configured
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {searchQuery
                  ? "No crawlers match your search query."
                  : "Get started by creating your first crawler to ingest website data into the vector database."}
              </p>
            </div>
            {!searchQuery && (
              <Button onClick={() => setIsCreateModalOpen(true)} size="sm">
                <Plus className="h-3.5 w-3.5" />
                <span>Add Your First Crawler</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Guides & Documentation Section */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          Guides & Reference
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredArticles.map((article) => (
            <Card key={article.title}>
              <div className="flex flex-col h-full justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary uppercase tracking-wider">
                    <Sparkles className="h-3 w-3" />
                    {article.category}
                  </span>
                  <h3 className="mt-2 font-semibold text-sm text-foreground leading-snug">
                    {article.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    {article.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-medium text-primary">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Read Guide
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Create Crawler Modal */}
      <CreateCrawlerModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={(crawler) => {
          navigate(`/knowledge-base/${crawler.id}`);
        }}
      />
    </div>
  );
};

export default KnowledgeBasePage;
