import { FastifyPluginAsync } from "fastify";
import chatService from "../modules/chat/chat.service";
import executionEngineService from "../modules/execution/execution-engine.service";
import logger from "../lib/logger";
import { requireAuth } from "../middleware/auth";

interface ChatRequestBody {
  prompt: string;
  chatId?: string;
  agentId?: string;
  connectionIds?: string[];
}

interface ApproveToolBody {
  approvalToken: string;
  approved: boolean;
}

interface ChatIdParams {
  chatId: string;
}

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  /**
   * POST /api/chat
   * Sends a user prompt to the LangChain Gemini agent.
   * Leverages ChatService and ChatRepository for MongoDB conversation persistence.
   */
  fastify.post<{ Body: ChatRequestBody }>(
    "/",
    {
      schema: {
        description:
          "Send a prompt to the LangChain agent with conversation persistence in MongoDB and knowledge base retrieval",
        tags: ["Chat"],
        summary: "Send chat message",
        body: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: {
              type: "string",
              description: "The user message or research prompt",
            },
            chatId: {
              type: "string",
              description:
                "Optional threadId/chatId UUID to continue an existing conversation",
            },
            agentId: {
              type: "string",
              description:
                "Optional agent UUID to dynamically bind connector tools",
            },
            connectionIds: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of specific connection IDs to scope tools for this query",
            },
          },
        },
        response: {
          200: {
            description:
              "Agent response with chatId, tool calls, and citations",
            type: "object",
            properties: {
              chatId: { type: "string" },
              message: { type: "string" },
              toolCalls: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                },
              },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    pageId: { type: "string" },
                    crawlerId: { type: "string" },
                    url: { type: "string" },
                    title: { type: "string" },
                    score: { type: "number" },
                    snippet: { type: "string" },
                  },
                },
              },
            },
          },
          400: {
            description: "Missing or invalid prompt",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            description: "Error response",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { prompt, chatId, agentId, connectionIds } = req.body;

      if (!prompt || prompt.trim() === "") {
        return reply.status(400).send({ error: "Prompt cannot be empty" });
      }

      try {
        const workspaceId = (req as any).auth?.orgId || (req as any).userId || "default_user";
        const userId = (req as any).userId;
        const response = await chatService.sendMessage({
          prompt,
          chatId,
          agentId,
          workspaceId,
          userId,
          connectionIds,
        });
        return reply.status(200).send(response);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "An unexpected error occurred";
        logger.error(`Error in POST /api/chat:`, err);
        return reply.status(500).send({ error: errorMessage });
      }
    },
  );

  /**
   * POST /api/chat/stream
   * Streams conversational agent response in real time using Server-Sent Events (SSE).
   * Compatible with @microsoft/fetch-event-source and modern streaming frontends.
   */
  fastify.post<{ Body: ChatRequestBody }>(
    "/stream",
    {
      schema: {
        description:
          "Stream a prompt response from the LangChain Gemini agent using Server-Sent Events (SSE)",
        tags: ["Chat"],
        summary: "Stream chat message response",
        body: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: {
              type: "string",
              description: "The user message or research prompt",
            },
            chatId: {
              type: "string",
              description:
                "Optional threadId/chatId UUID to continue an existing conversation",
            },
            agentId: {
              type: "string",
              description:
                "Optional agent UUID to dynamically bind connector tools",
            },
            connectionIds: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of specific connection IDs to scope tools for this query",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { prompt, chatId, agentId, connectionIds } = req.body || {};
      const workspaceId = (req as any).auth?.orgId || (req as any).userId || "default_user";
      const userId = (req as any).userId;

      if (!prompt || prompt.trim() === "") {
        return reply.status(400).send({ error: "Prompt cannot be empty" });
      }

      // Ensure Fastify-computed headers (such as CORS) are applied to the raw response
      const corsHeaders = reply.getHeaders();
      for (const [key, value] of Object.entries(corsHeaders)) {
        if (value !== undefined) {
          reply.raw.setHeader(key, value);
        }
      }

      // Configure Server-Sent Events headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const abortController = new AbortController();
      req.raw.on("close", () => {
        if (!reply.raw.writableEnded) {
          abortController.abort();
        }
      });

      const sendEvent = (event: string, data: any) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      await chatService.sendMessageStream(
        { prompt, chatId, agentId, workspaceId, userId, connectionIds },
        {
          onInit: (data) => {
            sendEvent("init", data);
          },
          onStatus: (data) => {
            sendEvent("status", data);
          },
          onToken: (chunk) => {
            sendEvent("token", { chunk });
          },
          onToolStart: (data) => {
            sendEvent("tool_start", data);
          },
          onToolEnd: (data) => {
            sendEvent("tool_end", data);
          },
          onApprovalRequired: (data) => {
            sendEvent("approval_required", data);
          },
          onDone: (data) => {
            sendEvent("done", data);
            if (!reply.raw.writableEnded) {
              reply.raw.end();
            }
          },
          onError: (err) => {
            const is429 =
              err.message.includes("429") ||
              err.message.toLowerCase().includes("rate_limit") ||
              err.message.toLowerCase().includes("quota");

            sendEvent("error", {
              error: is429
                ? "Gemini rate limit or quota reached. Please wait a moment before trying again."
                : err.message || "An error occurred while streaming response",
              code: is429 ? "RATE_LIMIT" : "INTERNAL_ERROR",
            });

            if (!reply.raw.writableEnded) {
              reply.raw.end();
            }
          },
        },
        abortController.signal,
      );
    },
  );

  /**
   * GET /api/chat/:chatId
   * Retrieve chat thread history by chatId
   */
  fastify.get<{ Params: ChatIdParams }>(
    "/:chatId",
    {
      schema: {
        description: "Fetch chat thread messages by chatId",
        tags: ["Chat"],
        summary: "Get chat messages by chatId",
        params: {
          type: "object",
          properties: {
            chatId: { type: "string" },
          },
          required: ["chatId"],
        },
        response: {
          200: {
            description: "Chat thread history",
            type: "object",
            properties: {
              chatId: { type: "string" },
              title: { type: "string" },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    role: {
                      type: "string",
                      enum: ["user", "assistant", "tool", "system"],
                    },
                    content: { type: "string" },
                    toolCalls: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                    citations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          pageId: { type: "string" },
                          crawlerId: { type: "string" },
                          url: { type: "string" },
                          title: { type: "string" },
                          score: { type: "number" },
                          snippet: { type: "string" },
                        },
                      },
                    },
                    createdAt: { type: "string", format: "date-time" },
                  },
                  required: ["role", "content"],
                },
              },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
          404: {
            description: "Chat thread not found",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            description: "Error response",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { chatId } = req.params;

      try {
        const thread = await chatService.getThread(chatId);

        if (!thread) {
          return reply.status(404).send({ error: "Chat thread not found" });
        }

        return reply.status(200).send({
          chatId: thread.chatId,
          title: thread.title,
          messages: thread.messages,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to retrieve chat thread";
        logger.error(`Error in GET /api/chat/${chatId}:`, err);
        return reply.status(500).send({ error: errorMessage });
      }
    },
  );

  /**
   * GET /api/chat
   * Retrieve list of all conversations (chatId and title)
   */
  fastify.get(
    "/",
    {
      schema: {
        description:
          "Fetch all conversations with chatId, title, and timestamp",
        tags: ["Chat"],
        summary: "Get all chat conversations",
        response: {
          200: {
            description: "List of conversations",
            type: "array",
            items: {
              type: "object",
              properties: {
                chatId: { type: "string" },
                title: { type: "string" },
                updatedAt: { type: "string", format: "date-time" },
                createdAt: { type: "string", format: "date-time" },
              },
              required: ["chatId", "title"],
            },
          },
          500: {
            description: "Error response",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      try {
        const threads = await chatService.listThreads();
        return reply.status(200).send(threads);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch conversations";
        logger.error("Error in GET /api/chat:", err);
        return reply.status(500).send({ error: errorMessage });
      }
    },
  );

  /**
   * DELETE /api/chat/:chatId
   * Delete a chat conversation thread by chatId
   */
  fastify.delete<{ Params: ChatIdParams }>(
    "/:chatId",
    {
      schema: {
        description: "Delete a chat conversation thread by chatId",
        tags: ["Chat"],
        summary: "Delete chat thread",
        params: {
          type: "object",
          properties: {
            chatId: { type: "string" },
          },
          required: ["chatId"],
        },
        response: {
          200: {
            description: "Chat thread deleted successfully",
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              chatId: { type: "string" },
            },
          },
          404: {
            description: "Chat thread not found",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            description: "Error response",
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { chatId } = req.params;

      try {
        const deleted = await chatService.deleteThread(chatId);

        if (!deleted) {
          return reply.status(404).send({ error: "Chat thread not found" });
        }

        return reply.status(200).send({
          success: true,
          message: "Chat thread deleted successfully",
          chatId,
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete chat thread";
        logger.error(`Error deleting chat thread chatId=${chatId}:`, err);
        return reply.status(500).send({ error: errorMessage });
      }
    },
  );

  /**
   * POST /api/chat/approve
   * Confirms or rejects a pending Human-in-the-Loop (HITL) tool execution.
   */
  fastify.post<{ Body: ApproveToolBody }>(
    "/approve",
    {
      schema: {
        description:
          "Approve or reject a pending sensitive tool execution emitted via approval_required SSE event",
        tags: ["Chat"],
        summary: "Resolve pending tool approval",
        body: {
          type: "object",
          required: ["approvalToken", "approved"],
          properties: {
            approvalToken: {
              type: "string",
              description: "The approvalToken received in the approval_required event",
            },
            approved: {
              type: "boolean",
              description: "True to execute the tool, false to reject it",
            },
          },
        },
        response: {
          200: {
            description: "Approval resolution result",
            type: "object",
            additionalProperties: true,
          },
          400: {
            description: "Missing or invalid payload",
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            description: "Approval token not found or expired",
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            description: "Execution error",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { approvalToken, approved } = req.body || {};

      if (!approvalToken || typeof approved !== "boolean") {
        return reply
          .status(400)
          .send({ error: "approvalToken and boolean approved are required" });
      }

      try {
        const workspaceId =
          (req as any).auth?.orgId || (req as any).userId || "default_user";
        const result = await executionEngineService.resolveApproval(
          approvalToken,
          workspaceId,
          approved,
        );
        return reply.status(200).send(result);
      } catch (err: unknown) {
        const statusCode = (err as any)?.statusCode || 500;
        const errorMessage =
          err instanceof Error ? err.message : "Failed to resolve approval";
        logger.error(`Error in POST /api/chat/approve:`, err);
        return reply.status(statusCode).send({ error: errorMessage });
      }
    },
  );
};

export default chatRoutes;
