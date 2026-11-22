import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, RefreshCw, Sparkles, Inbox } from "lucide-react";
import PromptInput, { PromptMode } from "../components/PromptInput";
import SearchResultCard from "../components/search/SearchResultCard";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import Skeleton from "../components/ui/Skeleton";
import { searchApi } from "../api";
import { useChatStore } from "../store";
import type { SearchResultItem } from "../types";

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCurrentChat } = useChatStore();

  const queryParam = searchParams.get("q") || "";
  const [inputVal, setInputVal] = useState(queryParam);
  const [currentMode, setCurrentMode] = useState<PromptMode>("search");

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync input value whenever url queryParam changes
  useEffect(() => {
    setInputVal(queryParam);
  }, [queryParam]);

  // Execute search when queryParam changes
  const performSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await searchApi.search({ query: trimmed, limit: 20 });
      setResults(data.results || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to execute search";
      setError(msg);
      console.error("Search error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (queryParam) {
      performSearch(queryParam);
    } else {
      setResults([]);
    }
  }, [queryParam, performSearch]);

  // Handle submit from PromptInput
  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (currentMode === "chat") {
      clearCurrentChat();
      navigate("/chat", { state: { initialPrompt: trimmed } });
    } else {
      setSearchParams({ q: trimmed });
    }
  };

  // Sort results by relevance score
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => b.score - a.score);
  }, [results]);

  return (
    <div className="flex flex-1 flex-col w-full h-full min-h-0 overflow-y-auto">
      {/* Top Floating / Sticky Header with animated input */}
      <div className="sticky top-0 z-20 w-full bg-background/95 backdrop-blur border-b border-border/40 py-4 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center gap-3">
          <motion.div
            layoutId="shared-prompt-input"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-full"
          >
            <PromptInput
              value={inputVal}
              mode={currentMode}
              onModeChange={(m) => setCurrentMode(m)}
              onChange={(val) => setInputVal(val)}
              onSubmit={handleSubmit}
              placeholder="Search crawled knowledge base..."
              className="border border-input/60 bg-background shadow-xs hover:border-input transition-colors"
            />
          </motion.div>
        </div>
      </div>

      {/* Main Results Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Error State */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Alert variant="destructive" className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => performSearch(queryParam)}
                className="gap-1.5 h-8 text-xs font-medium shrink-0 ml-4"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </Alert>
          </motion.div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-44 mb-2" />
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 p-5 rounded-2xl border border-border/40 bg-card/60"
              >
                <div className="flex justify-between items-center">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                  <Skeleton className="h-3.5 w-4/6" />
                </div>
                <Skeleton className="h-3 w-1/4 mt-2" />
              </div>
            ))}
          </div>
        )}

        {/* Results List with Motion Animation */}
        {!isLoading && !error && queryParam && sortedResults.length > 0 && (
          <motion.div
            key={queryParam}
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: {
                  staggerChildren: 0.06,
                },
              },
            }}
            className="flex flex-col gap-4"
          >
            <AnimatePresence mode="popLayout">
              {sortedResults.map((result, idx) => (
                <SearchResultCard
                  key={result.id || `${result.metadata.url}-${result.metadata.chunkIndex}-${idx}`}
                  result={result}
                  index={idx}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Empty State when searched but no results */}
        {!isLoading && !error && queryParam && sortedResults.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center text-center py-16 px-4 rounded-3xl border border-dashed border-border/60 bg-muted/10"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80 text-muted-foreground mb-4">
              <Inbox className="h-6 w-6" />
            </div>
            <h3 className="text-base font-medium text-foreground">No matches found</h3>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              We couldn&apos;t find any indexed knowledge chunks matching &quot;{queryParam}&quot;.
              Try adjusting your query.
            </p>
          </motion.div>
        )}

        {/* Initial Prompt State when no query is present */}
        {!isLoading && !error && !queryParam && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center text-center py-24 text-muted-foreground"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-medium text-foreground">Semantic Search</h2>
            <p className="mt-1 text-sm max-w-md">
              Search through crawled websites and documentation indexed in your Qdrant vector database.
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
};

export default SearchPage;
