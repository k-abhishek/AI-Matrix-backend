import crypto from "crypto";
import { createAgent, anthropicPromptCachingMiddleware } from "langchain";
import { vectorKnowledgeBaseTool } from "../../tools";
import chatRepository, {
  ChatRepository,
  ChatThreadSummary,
} from "./chat.repository";
import {
  IChatMessage,
  IToolCall,
  IChatCitation,
  IChatThread,
} from "../../models/ChatThread";
import logger from "../../lib/logger";
import modelFactoryService from "../../services/modelFactory.service";
import contextWindowService from "../../services/contextWindow.service";
import agentToolResolverService, {
  ActiveConnectionSummary,
  AgentStatusPhase,
  ApprovalRequiredEvent,
  ToolDisplayMeta,
  inferStatusPhase,
} from "../agents/agent-tool-resolver.service";

export const DEFAULT_AGENT_SYSTEM_PROMPT = `You are a helpful and intelligent AI research assistant Matrix.
You have access to the search_knowledge_base tool to search the indexed documentation and crawled website database. Always check this first when answering questions about indexed websites or documentation.

Always provide polite, comprehensive, and well-structured answers.
When citing information from search_knowledge_base, include inline numeric citation markers immediately after the supported claim using each result's index (e.g. [1], [2]). Only cite indices returned by the tool and never invent URLs.`;

export interface SendMessageInput {
  prompt: string;
  chatId?: string;
  agentId?: string;
  workspaceId?: string;
  userId?: string;
  connectionIds?: string[];
}

export interface SendMessageResponse {
  chatId: string;
  message: string;
  toolCalls: IToolCall[];
  citations: IChatCitation[];
}

export interface StreamCallbacks {
  onInit?: (data: { chatId: string }) => void;
  onStatus?: (data: {
    status: AgentStatusPhase;
    taskName?: string;
    tool?: string;
  }) => void;
  onToken?: (chunk: string) => void;
  onToolStart?: (data: { tool: string; taskName?: string; input: any }) => void;
  onToolEnd?: (data: {
    tool: string;
    taskName?: string;
    citations?: IChatCitation[];
  }) => void;
  onApprovalRequired?: (data: ApprovalRequiredEvent) => void;
  onDone?: (data: {
    chatId: string;
    message: string;
    toolCalls: IToolCall[];
    citations: IChatCitation[];
  }) => void;
  onError?: (error: Error) => void;
}

export class ChatService {
  constructor(private repo: ChatRepository = chatRepository) {}

  /**
   * Executes a conversational agent turn:
   * 1. Re-hydrates or creates conversation thread in MongoDB.
   * 2. Instantiates model via modelFactoryService (Gemini, Groq, OpenAI, Anthropic).
   * 3. Prepares context window with prompt caching & epoch summarization.
   * 4. Invokes the agent with the cache-optimized message sequence.
   * 5. Captures cache telemetry and persists messages.
   */

  async sendMessage(input: SendMessageInput): Promise<SendMessageResponse> {
    const prompt = input.prompt.trim();
    const chatId =
      input.chatId && input.chatId.trim() !== ""
        ? input.chatId.trim()
        : crypto.randomUUID();

    const titleSnippet = prompt.replace(/\s+/g, " ").slice(0, 50);

    // 1. Ensure conversation thread exists in MongoDB
    const thread = await this.repo.findOrCreate(chatId, titleSnippet);

    // 2. Initialize Model via Multi-Provider Factory
    const { model, provider, modelName } = modelFactoryService.createModel({
      temperature: 0.7,
      streaming: false,
    });

    // 3. Prepare Context Window with Prompt Caching & Epoch Summarization
    const {
      messages: contextMessages,
      estimatedTotalTokens,
      activeMessageCount,
    } = await contextWindowService.prepareMessages({
      thread,
      newPrompt: prompt,
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      model,
      provider,
      includeSystemPrompt: false, // createAgent prepends the systemPrompt
      repo: this.repo,
    });

    logger.info(
      `[ChatService] Sending message for chatId=${chatId} provider=${provider} model=${modelName} ` +
        `activeMsgs=${activeMessageCount} estimatedTokens=${estimatedTotalTokens}`,
    );

    const middlewares =
      provider === "anthropic"
        ? [anthropicPromptCachingMiddleware({ enableCaching: true })]
        : [];

    const agentId = input.agentId || "default-assistant";
    const workspaceId = input.workspaceId || "default_user";

    let dynamicTools: any[] = [];
    let toolMetaMap = new Map<string, ToolDisplayMeta>();
    let activeConnections: ActiveConnectionSummary[] = [];
    try {
      const resolved = await agentToolResolverService.resolveToolsWithMeta({
        agentId,
        workspaceId,
        userId: input.userId,
        connectionIds: input.connectionIds,
      });
      dynamicTools = resolved.tools;
      toolMetaMap = resolved.toolMetaMap;
      activeConnections = resolved.activeConnections;
    } catch (err: any) {
      logger.warn(`[ChatService] Could not resolve dynamic tools: ${err.message}`);
    }

    const allTools = [...dynamicTools, vectorKnowledgeBaseTool];
    const systemPrompt = this.buildSystemPrompt(activeConnections);

    const agent = createAgent({
      model,
      tools: allTools,
      systemPrompt,
      middleware: middlewares,
    });

    // 4. Invoke agent
    const result = await agent.invoke({
      messages: contextMessages,
    });

    // Extract cache telemetry if available
    const lastMsg = result.messages?.at(-1) as any;
    const rawUsage =
      lastMsg?.usage_metadata || (result as any)?.usage_metadata;
    if (rawUsage) {
      modelFactoryService.logCacheTelemetry(
        rawUsage,
        provider,
        modelName,
        chatId,
      );
    }

    // 5. Extract tool calls and citations from message chain
    const extractedToolCalls: IToolCall[] = [];
    const extractedCitations: IChatCitation[] = [];

    if (Array.isArray(result.messages)) {
      for (const msg of result.messages) {
        const rawMsg = msg as any;

        // Collect tool calls requested by assistant
        if (rawMsg.tool_calls && Array.isArray(rawMsg.tool_calls)) {
          for (const tc of rawMsg.tool_calls) {
            const toolName = tc.name || "tool";
            const meta = this.getToolMeta(toolName, toolMetaMap);
            extractedToolCalls.push({
              name: toolName,
              taskName: meta.taskName,
              args: tc.args,
              toolCallId: tc.id,
            });
          }
        }

        // Collect tool outputs
        if (
          (typeof rawMsg._getType === "function" &&
            rawMsg._getType() === "tool") ||
          rawMsg.role === "tool"
        ) {
          const toolCallId = rawMsg.tool_call_id;
          const matching = extractedToolCalls.find(
            (tc) => tc.toolCallId === toolCallId,
          );
          if (matching) {
            matching.output = rawMsg.content;
          }

          // Extract citations if this tool output was from search_knowledge_base
          try {
            const parsed =
              typeof rawMsg.content === "string"
                ? JSON.parse(rawMsg.content)
                : rawMsg.content;
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (item && item.url) {
                  extractedCitations.push({
                    index:
                      typeof item.index === "number"
                        ? item.index
                        : extractedCitations.length + 1,
                    pageId: item.pageId,
                    crawlerId: item.crawlerId,
                    url: item.url,
                    title: item.title,
                    score:
                      typeof item.score === "number" ? item.score : undefined,
                    snippet:
                      typeof item.content === "string"
                        ? item.content.slice(0, 300)
                        : undefined,
                  });
                }
              }
            }
          } catch {
            // Not a JSON citation list
          }
        }
      }
    }

    // Deduplicate citations by URL
    const seenUrls = new Set<string>();
    const uniqueCitations = extractedCitations.filter((c) => {
      if (seenUrls.has(c.url)) return false;
      seenUrls.add(c.url);
      return true;
    });

    // Extract the final assistant reply
    const assistantContent =
      typeof lastMsg?.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? "");

    // 6. Persist user and assistant messages in MongoDB
    const now = new Date();
    const newMessages: IChatMessage[] = [
      {
        role: "user",
        content: prompt,
        createdAt: now,
      },
      {
        role: "assistant",
        content: assistantContent,
        toolCalls:
          extractedToolCalls.length > 0 ? extractedToolCalls : undefined,
        citations: uniqueCitations.length > 0 ? uniqueCitations : undefined,
        createdAt: new Date(),
      },
    ];

    await this.repo.appendMessages(chatId, newMessages, titleSnippet);

    return {
      chatId,
      message: assistantContent,
      toolCalls: extractedToolCalls,
      citations: uniqueCitations,
    };
  }

  /**
   * Builds the system prompt, including active user connections when available.
   */
  private buildSystemPrompt(activeConnections: ActiveConnectionSummary[]): string {
    if (!activeConnections.length) {
      return DEFAULT_AGENT_SYSTEM_PROMPT;
    }

    const connectionLines = activeConnections
      .map((c) => `- ${c.name} (${c.connectorName}, ${c.toolCount} tools)`)
      .join("\n");

    return `${DEFAULT_AGENT_SYSTEM_PROMPT}

You also have access to the user's connected integrations:
${connectionLines}

Use these tools whenever the user's request involves those services. If a tool returns APPROVAL_REQUIRED, inform the user that confirmation is needed in the approval prompt before the action can run.`;
  }

  /**
   * Resolves human-readable taskName and statusPhase for any tool.
   */
  private getToolMeta(
    toolName: string,
    toolMetaMap: Map<string, ToolDisplayMeta>,
  ): ToolDisplayMeta {
    if (toolName === "search_knowledge_base") {
      return {
        uniqueToolName: "search_knowledge_base",
        taskName: "Knowledge Base: Search",
        statusPhase: "Searching",
      };
    }

    return (
      toolMetaMap.get(toolName) || {
        uniqueToolName: toolName,
        taskName: toolName,
        statusPhase: inferStatusPhase(toolName, false),
      }
    );
  }

  /**
   * Helper to parse and deduplicate citations from search tool output
   */

  private extractCitationsFromOutput(
    rawOutput: any,
    seenUrls: Set<string>,
  ): IChatCitation[] {
    const citations: IChatCitation[] = [];
    try {
      const content =
        typeof rawOutput === "object" && rawOutput !== null && "content" in rawOutput
          ? (rawOutput as any).content
          : rawOutput;
      const parsed = typeof content === "string" ? JSON.parse(content) : content;

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.url && !seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            citations.push({
              index:
                typeof item.index === "number"
                  ? item.index
                  : seenUrls.size,
              pageId: item.pageId,
              crawlerId: item.crawlerId,
              url: item.url,
              title: item.title,
              score: typeof item.score === "number" ? item.score : undefined,
              snippet:
                typeof item.content === "string"
                  ? item.content.slice(0, 300)
                  : undefined,
            });
          }
        }
      }
    } catch {
      // Non-JSON citation output
    }
    return citations;
  }

  /**
   * Executes a streaming conversational agent turn:
   * 1. Re-hydrates conversation thread in MongoDB.
   * 2. Instantiates streaming model via modelFactoryService.
   * 3. Prepares context window with prompt caching & epoch summarization.
   * 4. Streams execution events via `agent.streamEvents({ version: 'v2' }, { signal })`.
   * 5. Captures cache hit telemetry, tokens, tool invocations, and citations.
   * 6. Persists user and assistant messages in MongoDB on completion.
   */
  
  async sendMessageStream(
    input: SendMessageInput,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const prompt = input.prompt.trim();
    const chatId =
      input.chatId && input.chatId.trim() !== ""
        ? input.chatId.trim()
        : crypto.randomUUID();

    const titleSnippet = prompt.replace(/\s+/g, " ").slice(0, 50);

    // Notify client of the resolved chatId immediately
    callbacks.onInit?.({ chatId });
    callbacks.onStatus?.({
      status: "Working",
      taskName: "Understanding your request",
    });

    // 1. Ensure conversation thread exists in MongoDB
    const thread = await this.repo.findOrCreate(chatId, titleSnippet);

    // 2. Initialize Streaming Model via Multi-Provider Factory
    const { model, provider, modelName } = modelFactoryService.createModel({
      temperature: 0.7,
      streaming: true,
    });

    // 3. Prepare Context Window with Prompt Caching & Epoch Summarization
    const {
      messages: contextMessages,
      estimatedTotalTokens,
      activeMessageCount,
    } = await contextWindowService.prepareMessages({
      thread,
      newPrompt: prompt,
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      model,
      provider,
      includeSystemPrompt: false,
      repo: this.repo,
    });

    logger.info(
      `[ChatService] Streaming message for chatId=${chatId} provider=${provider} model=${modelName} ` +
        `activeMsgs=${activeMessageCount} estimatedTokens=${estimatedTotalTokens}`,
    );

    const middlewares =
      provider === "anthropic"
        ? [anthropicPromptCachingMiddleware({ enableCaching: true })]
        : [];

    const agentId = input.agentId || "default-assistant";
    const workspaceId = input.workspaceId || "default_user";

    let dynamicTools: any[] = [];
    let toolMetaMap = new Map<string, ToolDisplayMeta>();
    let activeConnections: ActiveConnectionSummary[] = [];
    try {
      const resolved = await agentToolResolverService.resolveToolsWithMeta({
        agentId,
        workspaceId,
        userId: input.userId,
        connectionIds: input.connectionIds,
        onApprovalRequired: (payload) => {
          callbacks.onApprovalRequired?.(payload);
        },
      });
      dynamicTools = resolved.tools;
      toolMetaMap = resolved.toolMetaMap;
      activeConnections = resolved.activeConnections;
    } catch (err: any) {
      logger.warn(`[ChatService] Could not resolve dynamic tools: ${err.message}`);
    }

    const allTools = [...dynamicTools, vectorKnowledgeBaseTool];
    const systemPrompt = this.buildSystemPrompt(activeConnections);

    const agent = createAgent({
      model,
      tools: allTools,
      systemPrompt,
      middleware: middlewares,
    });

    const extractedToolCalls: IToolCall[] = [];
    const extractedCitations: IChatCitation[] = [];
    const seenUrls = new Set<string>();
    let fullAssistantContent = "";
    let hasEmittedComposing = false;
    let usedNonStreamingFallback = false;

    callbacks.onStatus?.({
      status: "Solving",
      taskName: "Planning response",
    });

    try {
      const maxStreamAttempts = 2;
      for (let attempt = 0; attempt < maxStreamAttempts; attempt++) {
        try {
          const eventStream = agent.streamEvents(
            { messages: contextMessages },
            { version: "v2", signal },
          );

          for await (const event of eventStream) {
        if (signal?.aborted) {
          logger.info(`Stream aborted by client for chatId=${chatId}`);
          return;
        }

        // Handle streaming LLM text tokens
        if (event.event === "on_chat_model_stream") {
          const chunk = event.data?.chunk;
          if (chunk) {
            let textChunk = "";
            if (typeof chunk.content === "string") {
              textChunk = chunk.content;
            } else if (Array.isArray(chunk.content)) {
              for (const part of chunk.content) {
                if (typeof part === "string") {
                  textChunk += part;
                } else if (
                  part &&
                  typeof part === "object" &&
                  "text" in part &&
                  typeof (part as any).text === "string"
                ) {
                  textChunk += (part as any).text;
                }
              }
            }

            if (textChunk) {
              if (!hasEmittedComposing) {
                hasEmittedComposing = true;
                callbacks.onStatus?.({
                  status: "Composing",
                  taskName: "Composing response",
                });
              }
              fullAssistantContent += textChunk;
              callbacks.onToken?.(textChunk);
            }
          }
        }

        // Handle prompt cache and model completion metadata
        if (event.event === "on_chat_model_end") {
          const rawUsage = event.data?.output?.usage_metadata;
          if (rawUsage) {
            modelFactoryService.logCacheTelemetry(
              rawUsage,
              provider,
              modelName,
              chatId,
            );
          }
        }

        // Handle tool start
        if (event.event === "on_tool_start") {
          const toolName = event.name || "tool";
          const meta = this.getToolMeta(toolName, toolMetaMap);
          const toolCall: IToolCall = {
            name: toolName,
            taskName: meta.taskName,
            args: event.data?.input,
          };
          extractedToolCalls.push(toolCall);
          callbacks.onStatus?.({
            status: meta.statusPhase,
            taskName: meta.taskName,
            tool: toolName,
          });
          callbacks.onToolStart?.({
            tool: toolCall.name,
            taskName: meta.taskName,
            input: toolCall.args,
          });
        }

        // Handle tool end
        if (event.event === "on_tool_end") {
          const toolName = event.name || "tool";
          const meta = this.getToolMeta(toolName, toolMetaMap);
          const toolOutput = event.data?.output;
          const matchingCall =
            [...extractedToolCalls].reverse().find((tc) => tc.name === toolName && !tc.output) ||
            extractedToolCalls.at(-1);

          if (matchingCall) {
            matchingCall.output = toolOutput;
          }

          const citations = this.extractCitationsFromOutput(toolOutput, seenUrls);
          if (citations.length > 0) {
            extractedCitations.push(...citations);
          }

          callbacks.onToolEnd?.({
            tool: toolName,
            taskName: meta.taskName,
            citations: citations.length > 0 ? citations : undefined,
          });
          hasEmittedComposing = false;
          callbacks.onStatus?.({
            status: "Solving",
            taskName: "Analyzing results",
          });
        }
      }
          break;
        } catch (streamErr: unknown) {
          const streamMsg =
            streamErr instanceof Error ? streamErr.message : String(streamErr);
          const isTransientStreamParseError =
            streamMsg.includes("Failed to parse stream") ||
            streamMsg.includes("Error parsing JSON response");
          const canRetry =
            attempt === 0 &&
            isTransientStreamParseError &&
            fullAssistantContent === "" &&
            extractedToolCalls.length === 0 &&
            !signal?.aborted;

          if (!canRetry) {
            const canFallbackToNonStreaming =
              isTransientStreamParseError &&
              fullAssistantContent === "" &&
              extractedToolCalls.length === 0 &&
              !signal?.aborted;

            if (!canFallbackToNonStreaming) {
              throw streamErr;
            }

            logger.warn(
              `[ChatService] Stream parse error persisted for chatId=${chatId} model=${modelName}; ` +
                `falling back to non-streaming invoke. contextMsgs=${JSON.stringify(
                  contextMessages.map((m) => ({
                    role: m._getType(),
                    len: typeof m.content === "string" ? m.content.length : -1,
                  })),
                )}`,
            );

            const fallbackModelInfo = modelFactoryService.createModel({
              temperature: 0.7,
              streaming: false,
            });
            const fallbackAgent = createAgent({
              model: fallbackModelInfo.model,
              tools: allTools,
              systemPrompt,
              middleware: middlewares,
            });

            const fallbackResult = await fallbackAgent.invoke({
              messages: contextMessages,
            });

            if (Array.isArray(fallbackResult.messages)) {
              for (const msg of fallbackResult.messages) {
                const rawMsg = msg as any;
                if (rawMsg.tool_calls && Array.isArray(rawMsg.tool_calls)) {
                  for (const tc of rawMsg.tool_calls) {
                    const toolName = tc.name || "tool";
                    const meta = this.getToolMeta(toolName, toolMetaMap);
                    extractedToolCalls.push({
                      name: toolName,
                      taskName: meta.taskName,
                      args: tc.args,
                      toolCallId: tc.id,
                    });
                    callbacks.onToolStart?.({
                      tool: toolName,
                      taskName: meta.taskName,
                      input: tc.args,
                    });
                  }
                }

                if (
                  (typeof rawMsg._getType === "function" &&
                    rawMsg._getType() === "tool") ||
                  rawMsg.role === "tool"
                ) {
                  const matching = extractedToolCalls.find(
                    (tc) => tc.toolCallId === rawMsg.tool_call_id,
                  );
                  if (matching) {
                    matching.output = rawMsg.content;
                  }
                  const citations = this.extractCitationsFromOutput(
                    rawMsg.content,
                    seenUrls,
                  );
                  if (citations.length > 0) {
                    extractedCitations.push(...citations);
                  }
                  callbacks.onToolEnd?.({
                    tool: matching?.name || "tool",
                    taskName: matching?.taskName,
                    citations: citations.length > 0 ? citations : undefined,
                  });
                }
              }
            }

            const lastFallbackMsg = fallbackResult.messages?.at(-1) as any;
            fullAssistantContent =
              typeof lastFallbackMsg?.content === "string"
                ? lastFallbackMsg.content
                : JSON.stringify(lastFallbackMsg?.content ?? "");

            callbacks.onStatus?.({
              status: "Composing",
              taskName: "Composing response",
            });
            if (fullAssistantContent) {
              callbacks.onToken?.(fullAssistantContent);
            }
            usedNonStreamingFallback = true;
            break;
          }

          logger.warn(
            `[ChatService] Transient stream parse error for chatId=${chatId}, retrying once: ${streamMsg}`,
          );
          hasEmittedComposing = false;
        }
      }
      void usedNonStreamingFallback;

      // If stream finished normally without error and was not aborted, persist
      if (!signal?.aborted) {
        const now = new Date();
        const newMessages: IChatMessage[] = [
          {
            role: "user",
            content: prompt,
            createdAt: now,
          },
          {
            role: "assistant",
            content: fullAssistantContent,
            toolCalls: extractedToolCalls.length > 0 ? extractedToolCalls : undefined,
            citations: extractedCitations.length > 0 ? extractedCitations : undefined,
            createdAt: new Date(),
          },
        ];

        await this.repo.appendMessages(chatId, newMessages, titleSnippet);

        callbacks.onDone?.({
          chatId,
          message: fullAssistantContent,
          toolCalls: extractedToolCalls,
          citations: extractedCitations,
        });
      }
    } catch (err: unknown) {
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        logger.info(`Chat stream aborted for chatId=${chatId}`);
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error in ChatService.sendMessageStream:`, error);
      callbacks.onError?.(error);
    }
  }

  /**
   * Retrieves a chat thread with all its messages.
   */
  async getThread(chatId: string): Promise<IChatThread | null> {
    return this.repo.findByChatId(chatId);
  }

  /**
   * Lists chat threads.
   */
  async listThreads(limit = 50): Promise<ChatThreadSummary[]> {
    return this.repo.listThreads(limit);
  }

  /**
   * Deletes a chat thread.
   */
  async deleteThread(chatId: string): Promise<boolean> {
    return this.repo.deleteThread(chatId);
  }
}

export const chatService = new ChatService();
export default chatService;
