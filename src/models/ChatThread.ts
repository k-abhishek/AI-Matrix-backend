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

export interface IChatStep {
  type: 'status' | 'tool' | 'approval';
  status: string;
  taskName?: string;
  tool?: string;
  input?: Record<string, any>;
  citations?: IChatCitation[];
  timestamp: Date;
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
  steps?: IChatStep[];
  createdAt: Date;
}

export interface IChatThread extends Document {
  chatId: string;
  workspaceId?: string;
  userId?: string;
  agentId?: string;
  agentVersionId?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
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

const ChatStepSchema = new Schema<IChatStep>(
  {
    type: {
      type: String,
      enum: ['status', 'tool', 'approval'],
      required: true,
    },
    status: { type: String, required: true },
    taskName: { type: String },
    tool: { type: String },
    input: { type: Schema.Types.Mixed },
    citations: {
      type: [CitationSchema],
      default: undefined,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
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
      default: '',
    },
    toolCalls: {
      type: [ToolCallSchema],
      default: undefined,
    },
    citations: {
      type: [CitationSchema],
      default: undefined,
    },
    steps: {
      type: [ChatStepSchema],
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
    workspaceId: {
      type: String,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    agentId: {
      type: String,
      index: true,
    },
    agentVersionId: {
      type: String,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
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

ChatThreadSchema.index({ workspaceId: 1, userId: 1, updatedAt: -1 });

export const ChatThread = mongoose.models.ChatThread || mongoose.model<IChatThread>('ChatThread', ChatThreadSchema);
export default ChatThread;

