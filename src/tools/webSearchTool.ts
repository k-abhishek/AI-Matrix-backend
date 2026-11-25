import { tool } from "@langchain/core/tools";
import { z } from "zod";
import env from "../config/env";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const REQUEST_TIMEOUT_MS = 15_000;

interface ExaSearchResult {
  title?: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  score?: number;
  text?: string;
  highlights?: string[];
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

export const webSearchTool = tool(
  async ({
    query,
    numResults = 5,
    type = "auto",
    includeDomains,
    excludeDomains,
    startPublishedDate,
    endPublishedDate,
  }) => {
    const apiKey = env.EXA_API_KEY?.trim();
    if (!apiKey) {
      return JSON.stringify({
        error: "EXA_API_KEY is not configured in the environment.",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        query,
        numResults,
        type,
        contents: {
          text: { maxCharacters: 2000 },
          highlights: { numSentences: 3 },
        },
      };

      if (includeDomains && includeDomains.length > 0) {
        body.includeDomains = includeDomains;
      }
      if (excludeDomains && excludeDomains.length > 0) {
        body.excludeDomains = excludeDomains;
      }
      if (startPublishedDate) {
        body.startPublishedDate = startPublishedDate;
      }
      if (endPublishedDate) {
        body.endPublishedDate = endPublishedDate;
      }

      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return JSON.stringify({
          error: `Exa search failed (${response.status}): ${errorText || response.statusText}`,
        });
      }

      const data = (await response.json()) as ExaSearchResponse;
      const results = data.results ?? [];

      if (results.length === 0) {
        return "No web search results found for this query.";
      }

      return JSON.stringify(
        results.map((r, i) => ({
          index: i + 1,
          title: r.title ?? r.url,
          url: r.url,
          publishedDate: r.publishedDate ?? undefined,
          author: r.author ?? undefined,
          content:
            r.text ||
            (Array.isArray(r.highlights) ? r.highlights.join(" ... ") : "") ||
            "",
          score: typeof r.score === "number" ? r.score : undefined,
        })),
      );
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return JSON.stringify({
          error: `Exa search timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        });
      }
      return JSON.stringify({ error: err?.message || "Exa web search failed." });
    } finally {
      clearTimeout(timeout);
    }
  },
  {
    name: "web_search",
    description:
      "Search the live web using Exa to find up-to-date information, articles, documentation, and external sources.",
    schema: z.object({
      query: z.string().min(1).describe("The web search query"),
      numResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .optional()
        .describe("Number of search results to return (1-10, default 5)"),
      type: z
        .enum(["auto", "neural", "keyword", "fast"])
        .default("auto")
        .optional()
        .describe("Exa search mode (default: auto)"),
      includeDomains: z
        .array(z.string())
        .optional()
        .describe("Optional list of domains to restrict results to"),
      excludeDomains: z
        .array(z.string())
        .optional()
        .describe("Optional list of domains to exclude from results"),
      startPublishedDate: z
        .string()
        .optional()
        .describe("Optional ISO 8601 start date filter (e.g. 2025-01-01)"),
      endPublishedDate: z
        .string()
        .optional()
        .describe("Optional ISO 8601 end date filter (e.g. 2025-12-31)"),
    }),
  },
);
