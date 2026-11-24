import { describe, it, expect, vi, beforeEach } from "vitest";
import { contextWindowService } from "../../src/services/contextWindow.service";
import { modelFactoryService } from "../../src/services/modelFactory.service";
import { IChatMessage, IChatThread, IToolCall } from "../../src/models/ChatThread";
import { SystemMessage, AIMessage, HumanMessage } from "@langchain/core/messages";

describe("ContextWindowService", () => {
  it("estimates tokens conservatively for text and messages", () => {
    const text = "Hello world! This is a test message.";
    const tokens = contextWindowService.estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil(text.trim().length / 3.8));

    const msg: IChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    const msgTokens = contextWindowService.estimateMessageTokens(msg);
    expect(msgTokens).toBeGreaterThan(tokens); // includes framing overhead
  });

  it("compacts large tool output and knowledge base arrays for historical turns", () => {
    const searchResults = [
      {
        pageId: "1",
        title: "Fastify Documentation",
        url: "https://fastify.io/docs",
        score: 0.92,
        content: "A".repeat(2000), // huge content
      },
      {
        pageId: "2",
        title: "Node.js Guide",
        url: "https://nodejs.org/api",
        score: 0.88,
        content: "B".repeat(2000),
      },
    ];

    const toolCall: IToolCall = {
      name: "search_knowledge_base",
      args: { query: "fastify" },
      output: JSON.stringify(searchResults),
    };

    const compacted = contextWindowService.compactToolCall(toolCall, 150);
    expect(typeof compacted.output).toBe("string");
    expect(compacted.output).toContain("Fastify Documentation");
    expect(compacted.output).toContain("https://fastify.io/docs");
    expect((compacted.output as string).length).toBeLessThan(300);
  });

  it("assembles messages in strict cache-friendly sequence", async () => {
    const mockRepo: any = {
      updateSummary: vi.fn().mockResolvedValue(null),
    };

    const mockModel: any = {
      invoke: vi.fn().mockResolvedValue({ content: "Summary of earlier messages" }),
    };

    const thread: any = {
      chatId: "test-chat-1",
      summary: "User previously asked about TypeScript configuration.",
      summarizedMessageCount: 2,
      messages: [
        // Message 0 and 1 were already summarized
        { role: "user", content: "Old question 1", createdAt: new Date() },
        { role: "assistant", content: "Old answer 1", createdAt: new Date() },
        // Active messages
        { role: "user", content: "How do I use Docker?", createdAt: new Date() },
        {
          role: "assistant",
          content: "Use docker-compose.",
          toolCalls: [
            {
              name: "search_knowledge_base",
              output: JSON.stringify([{ title: "Docker Guide", url: "https://docker.com" }]),
            },
          ],
          createdAt: new Date(),
        },
      ],
    };

    const result = await contextWindowService.prepareMessages({
      thread,
      newPrompt: "What about Kubernetes?",
      systemPrompt: "You are Matrix assistant.",
      model: mockModel,
      provider: "google",
      includeSystemPrompt: true,
      repo: mockRepo,
    });

    // Verify ordering: 1. System Prompt, 2. Summary, 3. Active dialogue, 4. Current user prompt
    expect(result.messages.length).toBe(5);
    expect(result.messages[0]).toBeInstanceOf(SystemMessage);
    expect((result.messages[0] as SystemMessage).content).toContain("You are Matrix assistant.");

    expect(result.messages[1]).toBeInstanceOf(SystemMessage);
    expect((result.messages[1] as SystemMessage).content).toContain("User previously asked about TypeScript");

    expect(result.messages[2]).toBeInstanceOf(HumanMessage);
    expect((result.messages[2] as HumanMessage).content).toBe("How do I use Docker?");

    expect(result.messages[3]).toBeInstanceOf(AIMessage);
    expect(result.messages[4]).toBeInstanceOf(HumanMessage);
    expect((result.messages[4] as HumanMessage).content).toBe("What about Kubernetes?");
  });

  it("injects Anthropic ephemeral cache_control breakpoints when provider is anthropic", async () => {
    const mockModel: any = { invoke: vi.fn() };
    const mockRepo: any = { updateSummary: vi.fn() };

    const thread: any = {
      chatId: "test-chat-anthropic",
      summary: "Existing summary",
      summarizedMessageCount: 0,
      messages: [],
    };

    const result = await contextWindowService.prepareMessages({
      thread,
      newPrompt: "Hello Claude",
      systemPrompt: "System instruction for Claude",
      model: mockModel,
      provider: "anthropic",
      includeSystemPrompt: true,
      repo: mockRepo,
    });

    const sysMsg = result.messages[0] as SystemMessage;
    expect(Array.isArray(sysMsg.content)).toBe(true);
    const contentBlocks = sysMsg.content as any[];
    expect(contentBlocks[0].cache_control).toEqual({ type: "ephemeral" });

    const summaryMsg = result.messages[1] as SystemMessage;
    expect(Array.isArray(summaryMsg.content)).toBe(true);
    const summaryBlocks = summaryMsg.content as any[];
    expect(summaryBlocks[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("ModelFactoryService", () => {
  it("resolves model provider based on model names correctly", () => {
    expect(modelFactoryService.resolveProvider(undefined, "gpt-4o-mini")).toBe("openai");
    expect(modelFactoryService.resolveProvider(undefined, "o1-mini")).toBe("openai");
    expect(modelFactoryService.resolveProvider(undefined, "claude-3-5-sonnet-latest")).toBe("anthropic");
    expect(modelFactoryService.resolveProvider(undefined, "llama-3.3-70b-versatile")).toBe("groq");
    expect(modelFactoryService.resolveProvider(undefined, "gemini-2.5-flash-lite")).toBe("google");
  });

  it("correctly logs prompt cache hit telemetry", () => {
    const rawUsage = {
      promptTokens: 2500,
      completionTokens: 300,
      cachedContentTokenCount: 2000,
    };

    const telemetry = modelFactoryService.logCacheTelemetry(rawUsage, "google", "gemini-2.5-flash-lite", "test-chat");
    expect(telemetry).not.toBeNull();
    expect(telemetry?.cacheHit).toBe(true);
    expect(telemetry?.cachedTokens).toBe(2000);
    expect(telemetry?.inputTokens).toBe(2500);
    expect(telemetry?.cacheSavingsPercent).toBe(80);
  });
});
