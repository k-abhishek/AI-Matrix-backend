import React, { useState } from 'react';
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
import { Alert, AlertDescription } from '../ui/alert';
import { useCreateCrawler } from '../../hooks/useKnowledgeBase';
import { Loader2, Globe, SlidersHorizontal, Plus, AlertCircle } from 'lucide-react';
import type { CreateCrawlerDto, Crawler } from '../../types';

interface CreateCrawlerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (crawler: Crawler) => void;
}

export const CreateCrawlerModal: React.FC<CreateCrawlerModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [sitemapUrl, setSitemapUrl] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('');
  const [maxPages, setMaxPages] = useState<number>(1000);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(3);
  const [requestDelayMs, setRequestDelayMs] = useState<number>(500);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createCrawler = useCreateCrawler();

  const resetForm = () => {
    setName('');
    setSitemapUrl('');
    setBaseUrl('');
    setAllowedHosts('');
    setIncludePatterns('');
    setExcludePatterns('');
    setMaxPages(1000);
    setMaxConcurrency(3);
    setRequestDelayMs(500);
    setShowAdvanced(false);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedSitemap = sitemapUrl.trim();

    if (!trimmedName) {
      setFormError('Crawler name is required.');
      return;
    }

    if (!trimmedSitemap) {
      setFormError('Sitemap URL is required.');
      return;
    }

    try {
      new URL(trimmedSitemap);
    } catch {
      setFormError('Please enter a valid Sitemap URL (e.g. https://example.com/sitemap.xml).');
      return;
    }

    const payload: CreateCrawlerDto = {
      name: trimmedName,
      sitemapUrl: trimmedSitemap,
      baseUrl: baseUrl.trim() || undefined,
      allowedHosts: allowedHosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
      includePatterns: includePatterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
      excludePatterns: excludePatterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
      maxPages: Number(maxPages) || 1000,
      maxConcurrency: Number(maxConcurrency) || 3,
      requestDelayMs: Number(requestDelayMs) || 500,
    };

    try {
      const result = await createCrawler.mutateAsync(payload);
      resetForm();
      onOpenChange(false);
      onSuccess?.(result);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create crawler. Please check server logs.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Globe className="h-5 w-5" />
            <DialogTitle>Add Knowledge Crawler</DialogTitle>
          </div>
          <DialogDescription>
            Configure a website crawler to ingest documentation or knowledge pages into your vector database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {formError && (
            <Alert variant="destructive" className="py-2.5 text-xs">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs font-medium">
                {formError}
              </AlertDescription>
            </Alert>
          )}

          {/* Crawler Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Crawler Name <span className="text-destructive">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Developer Docs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* Sitemap URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Sitemap URL <span className="text-destructive">*</span>
            </label>
            <Input
              type="url"
              placeholder="https://docs.example.com/sitemap.xml"
              value={sitemapUrl}
              onChange={(e) => setSitemapUrl(e.target.value)}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              The XML sitemap index or standard sitemap to discover pages from.
            </p>
          </div>

          {/* Base URL (Optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Base URL <span className="text-muted-foreground font-normal">(Optional)</span>
            </label>
            <Input
              type="url"
              placeholder="https://docs.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to sitemap origin if left blank.
            </p>
          </div>

          {/* Toggle Advanced Settings */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus:outline-none"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Max Pages</label>
                  <input
                    type="number"
                    min="1"
                    max="50000"
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value))}
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Concurrency</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Delay (ms)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={requestDelayMs}
                    onChange={(e) => setRequestDelayMs(Number(e.target.value))}
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">Allowed Hosts (comma-separated)</label>
                <input
                  type="text"
                  placeholder="docs.example.com, api.example.com"
                  value={allowedHosts}
                  onChange={(e) => setAllowedHosts(e.target.value)}
                  className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Include Regex Patterns</label>
                  <input
                    type="text"
                    placeholder="^/docs/.*, ^/guides/.*"
                    value={includePatterns}
                    onChange={(e) => setIncludePatterns(e.target.value)}
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Exclude Regex Patterns</label>
                  <input
                    type="text"
                    placeholder="^/archive/.*, \.pdf$"
                    value={excludePatterns}
                    onChange={(e) => setExcludePatterns(e.target.value)}
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createCrawler.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="sm"
              disabled={createCrawler.isPending}
            >
              {createCrawler.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Create Crawler
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCrawlerModal;

