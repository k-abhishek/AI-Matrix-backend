import { fetchEventSource } from "@microsoft/fetch-event-source";
import apiClient from "./client";
import type {
  ChatRequestBody,
  ChatResponse,
  ChatThread,
  IChatCitation,
  IToolCall,
} from "../types";

export interface StreamChatCallbacks {
  onInit?: (data: { chatId: string }) => void;
  onToken?: (chunk: string) => void;
  onToolStart?: (data: { tool: string; input: any }) => void;
  onToolEnd?: (data: { tool: string; citations?: IChatCitation[] }) => void;
  onDone?: (data: {
    chatId: string;
    message: string;
    toolCalls?: IToolCall[];
    citations?: IChatCitation[];
  }) => void;
  onError?: (error: Error) => void;
}

export const chatApi = {
  /**
   * Send a prompt to the backend agent synchronously (non-streaming).
   */
  sendMessage: async (data: ChatRequestBody): Promise<ChatResponse> => {
    return apiClient.post<ChatResponse>("/chat", data);
  },

  /**
   * Stream conversational agent response in real-time via Server-Sent Events (SSE).
   * Communicates with Fastify POST /api/chat/stream using @microsoft/fetch-event-source.
   */
  streamMessage: async (
    data: ChatRequestBody,
    callbacks: StreamChatCallbacks,
    signal?: AbortSignal,
  ): Promise<void> => {
    const url = apiClient.getUrl("/chat/stream");
    const headers = await apiClient.getAuthHeaders();

    await fetchEventSource(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal,
      async onopen(response) {
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          return;
        }
        let errorMsg = `Server responded with ${response.status}: ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch {
          // ignore parsing error
        }
        throw new Error(errorMsg);
      },
      onmessage(event) {
        if (!event.data) return;
        try {
          const parsed = JSON.parse(event.data);
          switch (event.event) {
            case "init":
              callbacks.onInit?.(parsed);
              break;
            case "token":
              if (parsed.chunk) {
                callbacks.onToken?.(parsed.chunk);
              }
              break;
            case "tool_start":
              callbacks.onToolStart?.(parsed);
              break;
            case "tool_end":
              callbacks.onToolEnd?.(parsed);
              break;
            case "done":
              callbacks.onDone?.(parsed);
              break;
            case "error":
              callbacks.onError?.(new Error(parsed.error || "Streaming error"));
              break;
          }
        } catch (err) {
          console.error("Failed to parse SSE event data:", event.data, err);
        }
      },
      onerror(err) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        // Rethrow so fetchEventSource does not enter an infinite reconnect loop
        throw err;
      },
    });
  },

  /**
   * Fetch complete chat thread & messages via GET /api/chat/:chatId
   */
  getChatById: async (chatId: string): Promise<ChatThread> => {
    return apiClient.get<ChatThread>(`/chat/${chatId}`);
  },

  getConversationList: async () => {
    return apiClient.get<ChatThread[]>(`/chat`);
  },

  /**
   * Delete a chat thread by chatId via DELETE /api/chat/:chatId
   */
  deleteChat: async (
    chatId: string,
  ): Promise<{ success: boolean; message: string; chatId: string }> => {
    return apiClient.delete(`/chat/${chatId}`);
  },
};

export default chatApi;
