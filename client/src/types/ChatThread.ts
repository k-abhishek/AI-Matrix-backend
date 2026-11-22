export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface IChatCitation {
  pageId?: string;
  crawlerId?: string;
  url: string;
  title?: string;
  score?: number;
  snippet?: string;
}

export interface IToolCall {
  name: string;
  args?: Record<string, any>;
  output?: any;
  toolCallId?: string;
}

export interface IChatMessage {
  _id?: string;
  role: MessageRole;
  content: string;
  toolCalls?: IToolCall[];
  citations?: IChatCitation[];
  createdAt?: string | Date;
}

export interface IChatThread {
  _id?: string;
  chatId: string;
  title?: string;
  messages: IChatMessage[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ChatRequestBody {
  prompt: string;
  chatId?: string;
}

export interface ChatResponse {
  chatId: string;
  message: string;
  toolCalls?: IToolCall[];
  citations?: IChatCitation[];
}

export interface GetMessagesBody {
  chatId: string;
}

// Friendly type aliases without the 'I' prefix
export type ToolCall = IToolCall;
export type ChatCitation = IChatCitation;
export type ChatMessage = IChatMessage;
export type ChatThread = IChatThread;

