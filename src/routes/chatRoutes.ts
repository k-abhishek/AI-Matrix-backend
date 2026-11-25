import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import chatService from "../modules/chat/chat.service";
import agentRuntimeService, {
  RuntimeStreamCallbacks,
} from "../modules/runtime/agent-runtime.service";
import logger from "../lib/logger";
import { requireAuth, getWorkspaceContext } from "../middleware/auth";

interface InitChatBody {
  prompt: string;
  agentId?: string;
}

interface StreamChatBody {
  prompt?: string;
  chatId?: string;
  agentId?: string;
  versionId?: string;
}

interface ApproveToolBody {
  approvalId?: string;
  approvalToken?: string;
  approved: boolean;
}

interface ChatIdParams {
  chatId: string;
}

function createSseBridge(
  req: FastifyRequest,
  reply: FastifyReply
): { callbacks: RuntimeStreamCallbacks; signal: AbortSignal } {
  const corsHeaders = reply.getHeaders();
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value !== undefined) {
      reply.raw.setHeader(key, value);
    }
  }

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

  const callbacks: RuntimeStreamCallbacks = {
    onInit: (data) => sendEvent("init", data),
    onStatus: (data) => sendEvent("status", data),
    onToken: (chunk) => sendEvent("token", { chunk }),
    onToolStart: (data) => sendEvent("tool_start", data),
    onToolEnd: (data) => sendEvent("tool_end", data),
    onApprovalRequired: (data) => {
      sendEvent("approval_required", data);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
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
          ? "Rate limit or quota reached. Please wait a moment before trying again."
          : err.message || "An error occurred while streaming response",
        code: is429 ? "RATE_LIMIT" : (err as any).code || "INTERNAL_ERROR",
      });

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    },
  };

  return { callbacks, signal: abortController.signal };
}

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  /**
   * POST /api/chat
   * Non-blocking thread initialization: validates agent/version, creates ChatThread
   * with initial user message, and returns 201 immediately without calling the LLM.
   */
  fastify.post<{ Body: InitChatBody }>(
    "/",
    {
      schema: {
        description:
          "Initialize a new chat thread with an optional agentId without blocking on LLM execution",
        tags: ["Chat"],
        summary: "Initialize chat thread",
        body: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "Initial user message" },
            agentId: { type: "string", description: "Optional agent UUID" },
          },
        },
        response: {
          201: {
            description: "Thread initialized",
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  chatId: { type: "string" },
                  agentId: { type: "string", nullable: true },
                  agentVersionId: { type: "string", nullable: true },
                  title: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { prompt, agentId } = req.body || {};
      if (!prompt || prompt.trim() === "") {
        return reply.status(400).send({ success: false, error: "Prompt cannot be empty" });
      }

      const ctx = getWorkspaceContext(req);
      const data = await chatService.initializeThread(ctx, { prompt, agentId });
      return reply.status(201).send({ success: true, data });
    }
  );

  /**
   * POST /api/chat/stream
   * Streams conversational agent response in real time using Server-Sent Events (SSE).
   */
  fastify.post<{ Body: StreamChatBody }>(
    "/stream",
    {
      schema: {
        description: "Stream an agent turn using Server-Sent Events (SSE)",
        tags: ["Chat"],
        summary: "Stream chat message response",
        body: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            chatId: { type: "string" },
            agentId: { type: "string" },
            versionId: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { prompt, chatId, agentId, versionId } = req.body || {};
      if ((!prompt || prompt.trim() === "") && (!chatId || chatId.trim() === "")) {
        return reply
          .status(400)
          .send({ success: false, error: "Either prompt or chatId is required" });
      }

      const ctx = getWorkspaceContext(req);
      const { callbacks, signal } = createSseBridge(req, reply);

      try {
        await agentRuntimeService.streamExecution(
          ctx,
          { prompt, chatId, agentId, versionId },
          callbacks,
          signal
        );
      } catch (err: any) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );

  /**
   * GET /api/chat/:chatId
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
          properties: { chatId: { type: "string" } },
          required: ["chatId"],
        },
      },
    },
    async (req, reply) => {
      const { chatId } = req.params;
      const { workspaceId, userId } = getWorkspaceContext(req);

      try {
        const thread = await chatService.getThread(chatId, { workspaceId, userId });
        if (!thread) {
          return reply.status(404).send({ error: "Chat thread not found" });
        }

        return reply.status(200).send({
          chatId: thread.chatId,
          agentId: thread.agentId ?? null,
          agentVersionId: thread.agentVersionId ?? null,
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
    }
  );

  /**
   * GET /api/chat
   */
  fastify.get(
    "/",
    {
      schema: {
        description: "Fetch all active conversations for the caller in the workspace",
        tags: ["Chat"],
        summary: "Get all chat conversations",
      },
    },
    async (req, reply) => {
      try {
        const { workspaceId, userId } = getWorkspaceContext(req);
        const threads = await chatService.listThreads(50, { workspaceId, userId });
        return reply.status(200).send(threads);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch conversations";
        logger.error("Error in GET /api/chat:", err);
        return reply.status(500).send({ error: errorMessage });
      }
    }
  );

  /**
   * DELETE /api/chat/:chatId
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
          properties: { chatId: { type: "string" } },
          required: ["chatId"],
        },
      },
    },
    async (req, reply) => {
      const { chatId } = req.params;
      const { workspaceId, userId } = getWorkspaceContext(req);

      try {
        const deleted = await chatService.deleteThread(chatId, { workspaceId, userId });
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
    }
  );

  /**
   * POST /api/chat/approve
   * Resolves a pending HITL approval and SSE-streams the resumed LangGraph turn.
   */
  fastify.post<{ Body: ApproveToolBody }>(
    "/approve",
    {
      schema: {
        description:
          "Approve or reject a pending HITL tool execution and SSE-stream the resumed turn",
        tags: ["Chat"],
        summary: "Resolve pending tool approval and stream resumed turn",
        body: {
          type: "object",
          required: ["approved"],
          properties: {
            approvalId: { type: "string" },
            approvalToken: { type: "string" },
            approved: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const { approvalId, approvalToken, approved } = req.body || {};
      const resolvedId = approvalId || approvalToken;

      if (!resolvedId || typeof approved !== "boolean") {
        return reply
          .status(400)
          .send({ error: "approvalId (or approvalToken) and boolean approved are required" });
      }

      const ctx = getWorkspaceContext(req);
      const { callbacks, signal } = createSseBridge(req, reply);

      try {
        await agentRuntimeService.resumeApprovalStream(
          ctx,
          resolvedId,
          approved,
          callbacks,
          signal
        );
      } catch (err: any) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );
};

export default chatRoutes;
