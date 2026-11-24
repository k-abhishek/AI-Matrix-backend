import mongoose, { Schema, Document } from 'mongoose';

export interface IChatCitation {
  index?: number;
  pageId?: string;
  crawlerId?: string;
  url: string;
  title?: string;
  score?: number;
  snippet?: string;
}

export interface IToolCall {
  name: string;
  taskName?: string;
  args?: Record<string, any>;
  output?: any;
  toolCallId?: string;
}

export interface IChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: IToolCall[];
  citations?: IChatCitation[];
  createdAt: Date;
}

export interface IChatThread extends Document {
  chatId: string;
  title?: string;
  summary?: string;
  summarizedMessageCount?: number;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const CitationSchema = new Schema<IChatCitation>(
  {
    index: { type: Number },
    pageId: { type: String },
    crawlerId: { type: String },
    url: { type: String, required: true },
    title: { type: String },
    score: { type: Number },
    snippet: { type: String },
  },
  { _id: false }
);

const ToolCallSchema = new Schema<IToolCall>(
  {
    name: { type: String, required: true },
    taskName: { type: String },
    args: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    toolCallId: { type: String },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    role: {
      type: String,
      enum: ['user', 'assistant', 'tool', 'system'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    toolCalls: {
      type: [ToolCallSchema],
      default: undefined,
    },
    citations: {
      type: [CitationSchema],
      default: undefined,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const ChatThreadSchema = new Schema<IChatThread>(
  {
    chatId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
    },
    summary: {
      type: String,
      default: undefined,
    },
    summarizedMessageCount: {
      type: Number,
      default: 0,
    },
    messages: {
      type: [ChatMessageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const ChatThread = mongoose.models.ChatThread || mongoose.model<IChatThread>('ChatThread', ChatThreadSchema);
export default ChatThread;

