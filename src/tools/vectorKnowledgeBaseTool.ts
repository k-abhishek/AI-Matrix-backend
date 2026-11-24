import { tool } from "@langchain/core/tools";
import { z } from "zod";
import searchService from "../modules/search/search.service";

export const vectorKnowledgeBaseTool = tool(
  async ({ query, limit = 5 }) => {
    try {
      const results = await searchService.search({
        query,
        limit,
        scoreThreshold: 0.5,
      });
      if (results.results.length === 0) {
        return "No relevant documentation or knowledge base records found.";
      }
      return JSON.stringify(
        results.results.map((r) => ({
          pageId: r.metadata.pageId,
          crawlerId: r.metadata.crawlerId,
          title: r.metadata.title,
          url: r.metadata.url,
          content: r.content,
          score: r.score,
        })),
      );
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: "search_knowledge_base",
    description:
      "Search the indexed internal documentation and crawled website database.",
    schema: z.object({
      query: z
        .string()
        .describe("Search query to find relevant indexed documentation"),
      limit: z.number().int().min(1).max(10).default(5).optional(),
    }),
  },
);
