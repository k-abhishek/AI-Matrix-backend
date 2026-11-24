import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IChatMessage, IChatThread, IToolCall } from "../models/ChatThread";
import chatRepository, { ChatRepository } from "../modules/chat/chat.repository";
import { DEFAULT_CONFIG } from "../config/constants";
import { ModelProvider } from "./modelFactory.service";
import logger from "../lib/logger";

export interface PrepareMessagesOptions {
  thread: IChatThread;
  newPrompt: string;
  systemPrompt?: string;
  model: BaseChatModel;
  provider: ModelProvider;
  includeSystemPrompt?: boolean;
  repo?: ChatRepository;
}

export interface PreparedContext {
  messages: BaseMessage[];
  activeMessageCount: number;
  summarizedMessageCount: number;
  estimatedTotalTokens: number;
  hadEpochRolledOver: boolean;
}

export class ContextWindowService {
  /**
   * Fast, conservative token estimator (~3.8 chars per token for typical English/code).
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.trim().length / 3.8);
  }

  /**
   * Estimates token usage for a single chat message.
   */
  estimateMessageTokens(msg: IChatMessage): number {
    let tokens = 4; // role & framing overhead
    tokens += this.estimateTokens(msg.content);

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        tokens += 6; // tool name overhead
        if (tc.args) {
          tokens += this.estimateTokens(JSON.stringify(tc.args));
        }
        if (tc.output) {
          tokens += this.estimateTokens(
            typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
          );
        }
      }
    }

    return tokens;
  }

  /**
   * Compacts bulky tool outputs (e.g., massive Qdrant search dumps) for historical turns.
   * This retains key factual markers (retrieved URLs and titles) while shrinking token bulk by 80-90%.
   */
  compactToolCall(
    toolCall: IToolCall,
    maxChars: number = DEFAULT_CONFIG.TOOL_OUTPUT_MAX_CHARS,
  ): IToolCall {
    if (!toolCall.output) {
      return toolCall;
    }

    let compactedOutput = "";

    try {
      const parsed =
        typeof toolCall.output === "string"
          ? JSON.parse(toolCall.output)
          : toolCall.output;

      // Handle Qdrant knowledge base array results
      if (Array.isArray(parsed)) {
        const citations = parsed
          .filter((item: any) => item && (item.url || item.title))
          .map(
            (item: any) =>
              `"${item.title || "Document"}" (${item.url || ""})`,
          );

        if (citations.length > 0) {
          compactedOutput = `[Knowledge base retrieved ${citations.length} doc(s): ${citations.slice(0, 3).join(", ")}${citations.length > 3 ? "..." : ""}]`;
        }
      }
    } catch {
      // Non-JSON output
    }

    if (!compactedOutput) {
      const raw =
        typeof toolCall.output === "string"
          ? toolCall.output
          : JSON.stringify(toolCall.output);

      if (raw.length > maxChars) {
        compactedOutput =
          raw.slice(0, maxChars) +
          `... [compacted ${raw.length - maxChars} chars]`;
      } else {
        compactedOutput = raw;
      }
    }

    return {
      ...toolCall,
      output: compactedOutput,
    };
  }

  /**
   * Summarizes an epoch chunk of older messages using the LLM.
   */
  async summarizeEpochChunk(
    existingSummary: string | undefined,
    messagesToSummarize: IChatMessage[],
    model: BaseChatModel,
  ): Promise<string> {
    const formattedDialogue = messagesToSummarize
      .map((msg) => {
        let text = `${msg.role.toUpperCase()}: ${msg.content}`;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const tcNames = msg.toolCalls.map((tc) => tc.name).join(", ");
          text += ` [Tools used: ${tcNames}]`;
        }
        return text;
      })
      .join("\n\n");

    const prompt = `You are a concise conversation summarizer. Merge the new dialogue slice into the existing summary.
Retain key user objectives, decisions, constraints, topics discussed, and referenced source URLs.
Do NOT include greetings or chit-chat. Keep the summary dense and factual in 2 to 4 bullet points or a single concise paragraph.

${existingSummary ? `Current Historical Summary:\n${existingSummary}\n\n` : ""}
New Dialogue Slice to Integrate:
${formattedDialogue}

Updated Summary:`;

    try {
      const response = await model.invoke([new HumanMessage(prompt)]);
      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);
      return content.trim();
    } catch (err) {
      logger.error("Failed to generate epoch summary:", err);
      // Fallback: simple text truncation if LLM call fails
      return (
        (existingSummary ? existingSummary + "\n" : "") +
        `Previous topics: ${messagesToSummarize.map((m) => m.content.slice(0, 40)).join("; ")}`
      );
    }
  }

  /**
   * Prepares context messages in strict cacheable order:
   * 1. Static System Prompt (with Anthropic cache_control if applicable)
   * 2. Epoch Summary (with Anthropic cache_control if applicable) - stays constant across multiple turns!
   * 3. Compacted Active Dialogue Messages (tool calls compacted for historical turns)
   * 4. New User Prompt
   */
  async prepareMessages(options: PrepareMessagesOptions): Promise<PreparedContext> {
    const {
      thread,
      newPrompt,
      systemPrompt,
      model,
      provider,
      repo = chatRepository,
    } = options;

    const allMessages = thread.messages || [];
    let summarizedCount = thread.summarizedMessageCount || 0;
    let summary = thread.summary;
    let hadEpochRolledOver = false;

    // Slice active messages that have not been rolled into the summary
    let activeMessages = allMessages.slice(summarizedCount);

    // Calculate active window tokens
    let activeTokens = activeMessages.reduce(
      (acc, m) => acc + this.estimateMessageTokens(m),
      0,
    );

    // Check if we need to roll over an epoch:
    // When active tokens exceed budget AND we have at least EPOCH_SUMMARY_THRESHOLD_TURNS active messages
    const shouldRollOver =
      activeTokens > DEFAULT_CONFIG.ACTIVE_WINDOW_MAX_TOKENS &&
      activeMessages.length >= DEFAULT_CONFIG.EPOCH_SUMMARY_THRESHOLD_TURNS;

    if (shouldRollOver) {
      // Keep at least the last 2 turns in the active window
      const countToRoll = Math.min(
        activeMessages.length - 2,
        DEFAULT_CONFIG.EPOCH_SUMMARY_THRESHOLD_TURNS,
      );

      if (countToRoll > 0) {
        const sliceToSummarize = activeMessages.slice(0, countToRoll);
        logger.info(
          `[ContextWindow] Triggering epoch summarization for chatId=${thread.chatId}. ` +
            `Rolling ${countToRoll} messages into summary. Active tokens was ${activeTokens}.`,
        );

        summary = await this.summarizeEpochChunk(summary, sliceToSummarize, model);
        summarizedCount += countToRoll;
        hadEpochRolledOver = true;

        // Persist the new epoch summary in MongoDB
        await repo.updateSummary(thread.chatId, summary, summarizedCount);
        thread.summary = summary;
        thread.summarizedMessageCount = summarizedCount;

        // Recompute active messages after rollover
        activeMessages = allMessages.slice(summarizedCount);
      }
    }

    // Assemble messages in cache-optimized sequence
    const assembledMessages: BaseMessage[] = [];

    // 1. Static System Prompt (if requested to be embedded in messages array directly)
    if (options.includeSystemPrompt && systemPrompt && systemPrompt.trim() !== "") {
      if (provider === "anthropic") {
        assembledMessages.push(
          new SystemMessage({
            content: [
              {
                type: "text",
                text: systemPrompt.trim(),
                cache_control: { type: "ephemeral" },
              } as any,
            ],
          }),
        );
      } else {
        assembledMessages.push(new SystemMessage(systemPrompt.trim()));
      }
    }

    // 2. Epoch Summary (Pinned Prefix Block)
    if (summary && summary.trim() !== "") {
      const summaryText = `[Context Summary of Earlier Dialogue (Preserved for continuity)]:\n${summary}`;
      if (provider === "anthropic") {
        assembledMessages.push(
          new SystemMessage({
            content: [
              {
                type: "text",
                text: summaryText,
                cache_control: { type: "ephemeral" },
              } as any,
            ],
          }),
        );
      } else {
        assembledMessages.push(new SystemMessage(summaryText));
      }
    }

    // 3. Compacted Active Dialogue Messages
    const lastActiveIdx = activeMessages.length - 1;
    for (let i = 0; i < activeMessages.length; i++) {
      const msg = activeMessages[i];
      const isHistoricalTurn = i < lastActiveIdx;
      const toolOutputBudget = isHistoricalTurn
        ? DEFAULT_CONFIG.TOOL_OUTPUT_MAX_CHARS
        : DEFAULT_CONFIG.TOOL_OUTPUT_MAX_CHARS * 2;

      let msgContent = (msg.content || "").trim();

      // For assistant messages with tool calls, always compact tool outputs so
      // unbounded raw payloads from previous turns don't bloat or break streaming
      if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const toolCalls = msg.toolCalls.map((tc) =>
            this.compactToolCall(tc, toolOutputBudget),
          );

          // Annotate content with compacted tool calls if needed
          const toolCallAnnotations = toolCalls
            .map((tc) => `[Tool: ${tc.name} -> ${typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output ?? "")}]`)
            .join("\n");

          if (!msgContent.includes("[Tool:")) {
            msgContent = msgContent ? `${msgContent}\n\n${toolCallAnnotations}` : toolCallAnnotations;
          }
        }
        if (msgContent !== "") {
          assembledMessages.push(new AIMessage(msgContent));
        }
      } else if (msg.role === "user") {
        if (msgContent !== "") {
          assembledMessages.push(new HumanMessage(msgContent));
        }
      } else if (msg.role === "system") {
        if (msgContent !== "") {
          assembledMessages.push(new SystemMessage(msgContent));
        }
      }
    }

    // 4. Current User Prompt
    assembledMessages.push(new HumanMessage(newPrompt));

    // 5. Normalize adjacent same-role messages (e.g., if a prior turn failed mid-way)
    // so providers like Gemini receive strictly alternating user/model turns.
    const normalizedMessages: BaseMessage[] = [];
    for (const msg of assembledMessages) {
      const prev = normalizedMessages[normalizedMessages.length - 1];
      const msgType = msg._getType();
      const prevType = prev?._getType();

      if (
        prev &&
        (msgType === "human" || msgType === "ai") &&
        msgType === prevType &&
        typeof prev.content === "string" &&
        typeof msg.content === "string"
      ) {
        const mergedContent = `${prev.content}\n\n${msg.content}`.trim();
        normalizedMessages[normalizedMessages.length - 1] =
          msgType === "human"
            ? new HumanMessage(mergedContent)
            : new AIMessage(mergedContent);
      } else {
        normalizedMessages.push(msg);
      }
    }

    // Calculate total estimated prompt tokens
    const estimatedTotalTokens =
      this.estimateTokens(systemPrompt || "") +
      (summary ? this.estimateTokens(summary) : 0) +
      activeMessages.reduce((acc, m) => acc + this.estimateMessageTokens(m), 0) +
      this.estimateTokens(newPrompt);

    return {
      messages: normalizedMessages,
      activeMessageCount: activeMessages.length,
      summarizedMessageCount: summarizedCount,
      estimatedTotalTokens,
      hadEpochRolledOver,
    };
  }
}

export const contextWindowService = new ContextWindowService();
export default contextWindowService;
