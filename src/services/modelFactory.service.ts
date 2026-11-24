import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import env from "../config/env";
import logger from "../lib/logger";

export type ModelProvider = "google" | "groq" | "openai" | "anthropic";

export interface CreateModelOptions {
  provider?: ModelProvider;
  model?: string;
  temperature?: number;
  streaming?: boolean;
  maxRetries?: number;
}

export interface CacheTelemetry {
  provider: ModelProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheHit: boolean;
  cacheSavingsPercent?: number;
}

export class ModelFactoryService {
  /**
   * Resolves the active model provider based on configuration, model name, and available keys.
   */
  resolveProvider(explicitProvider?: ModelProvider, modelName?: string): ModelProvider {
    if (explicitProvider) {
      return explicitProvider;
    }

    if (env.AGENT_PROVIDER && env.AGENT_PROVIDER !== "auto") {
      return env.AGENT_PROVIDER as ModelProvider;
    }

    const targetModel = (modelName || env.AGENT_MODEL || "").toLowerCase();

    if (
      targetModel.startsWith("gpt-") ||
      targetModel.startsWith("o1") ||
      targetModel.startsWith("o3")
    ) {
      return "openai";
    }

    if (targetModel.startsWith("claude-")) {
      return "anthropic";
    }

    if (
      targetModel.startsWith("llama") ||
      targetModel.startsWith("mixtral") ||
      targetModel.includes("groq")
    ) {
      return "groq";
    }

    if (targetModel.startsWith("gemini")) {
      return "google";
    }

    // Fallback based on present API keys
    if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return "google";
    }
    if (env.OPENAI_API_KEY || process.env.OPENAI_API_KEY) {
      return "openai";
    }
    if (env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) {
      return "anthropic";
    }
    if (env.GROQ_API_KEY || process.env.GROQ_API_KEY) {
      return "groq";
    }

    return "google";
  }

  /**
   * Instantiates a LangChain chat model configured with the appropriate provider, API key,
   * and settings optimized for prompt caching.
   */
  createModel(options: CreateModelOptions = {}): {
    model: BaseChatModel;
    provider: ModelProvider;
    modelName: string;
  } {
    const provider = this.resolveProvider(options.provider, options.model);
    const temperature = options.temperature ?? 0.7;
    const streaming = options.streaming ?? false;
    const maxRetries = options.maxRetries ?? 3;

    switch (provider) {
      case "google": {
        const apiKey =
          env.GOOGLE_API_KEY ||
          env.GEMINI_API_KEY ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          "";
        const modelName = options.model || env.AGENT_MODEL || "gemini-2.5-flash-lite";

        const model = new ChatGoogleGenerativeAI({
          apiKey,
          model: modelName,
          temperature,
          maxRetries,
          streaming,
        });

        return { model, provider, modelName };
      }

      case "groq": {
        const apiKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY || "";
        const modelName =
          options.model ||
          (env.AGENT_MODEL.startsWith("gemini")
            ? "llama-3.3-70b-versatile"
            : env.AGENT_MODEL);

        const model = new ChatGroq({
          apiKey,
          model: modelName,
          temperature,
          maxRetries,
          streaming,
        });

        return { model, provider, modelName };
      }

      case "openai": {
        const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
        const modelName =
          options.model ||
          (env.AGENT_MODEL.startsWith("gemini") ? "gpt-4o-mini" : env.AGENT_MODEL);

        const model = new ChatOpenAI({
          apiKey,
          model: modelName,
          temperature,
          maxRetries,
          streaming,
        });

        return { model, provider, modelName };
      }

      case "anthropic": {
        const apiKey =
          env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
        const modelName =
          options.model ||
          (env.AGENT_MODEL.startsWith("gemini")
            ? "claude-3-5-sonnet-latest"
            : env.AGENT_MODEL);

        const model = new ChatAnthropic({
          apiKey,
          model: modelName,
          temperature,
          maxRetries,
          streaming,
        });

        return { model, provider, modelName };
      }

      default:
        throw new Error(`Unsupported model provider: ${provider}`);
    }
  }

  /**
   * Normalizes and logs prompt cache telemetry across Gemini, Anthropic, OpenAI, and Groq.
   */
  logCacheTelemetry(
    rawUsage: any,
    provider: ModelProvider,
    modelName: string,
    chatId?: string,
  ): CacheTelemetry | null {
    if (!rawUsage) return null;

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    // Google Gemini usage_metadata format
    if (provider === "google") {
      inputTokens = rawUsage.promptTokens || rawUsage.promptTokenCount || 0;
      outputTokens =
        rawUsage.completionTokens || rawUsage.candidatesTokenCount || 0;
      cachedTokens =
        rawUsage.promptTokensDetails?.cachedTokens ||
        rawUsage.cachedContentTokenCount ||
        0;
    }
    // OpenAI and Groq usage format
    else if (provider === "openai" || provider === "groq") {
      inputTokens = rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
      outputTokens = rawUsage.completion_tokens || rawUsage.output_tokens || 0;
      cachedTokens =
        rawUsage.prompt_tokens_details?.cached_tokens ||
        rawUsage.input_token_details?.cached_tokens ||
        0;
    }
    // Anthropic usage format
    else if (provider === "anthropic") {
      inputTokens = rawUsage.input_tokens || 0;
      outputTokens = rawUsage.output_tokens || 0;
      cachedTokens =
        rawUsage.cache_read_input_tokens ||
        rawUsage.input_token_details?.cache_read_input_tokens ||
        0;
    }

    const cacheHit = cachedTokens > 0;
    const cacheSavingsPercent =
      inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0;

    const telemetry: CacheTelemetry = {
      provider,
      model: modelName,
      inputTokens,
      outputTokens,
      cachedTokens,
      cacheHit,
      cacheSavingsPercent,
    };

    if (cacheHit) {
      logger.info(
        `[Prompt Cache HIT] chatId=${chatId ?? "unknown"} provider=${provider} model=${modelName} ` +
          `cachedTokens=${cachedTokens}/${inputTokens} (${cacheSavingsPercent}% cache hit rate)`,
      );
    } else if (inputTokens > 0) {
      logger.info(
        `[Prompt Cache MISS/INIT] chatId=${chatId ?? "unknown"} provider=${provider} model=${modelName} ` +
          `inputTokens=${inputTokens} cachedTokens=0`,
      );
    }

    return telemetry;
  }
}

export const modelFactoryService = new ModelFactoryService();
export default modelFactoryService;
