import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentRun extends Document {
  runId: string;
  workspaceId: string;
  userId: string;
  chatId: string;
  agentId: string;
  agentVersionId: string;
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  provider?: string;
  modelName?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs?: number;
  error?: string;
  pendingSteps?: Record<string, any>[];
  startedAt: Date;
  completedAt?: Date;
}

const AgentRunSchema = new Schema<IAgentRun>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    agentId: { type: String, required: true, index: true },
    agentVersionId: { type: String, required: true },
    status: {
      type: String,
      enum: ['RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'RUNNING',
      index: true,
    },
    provider: { type: String },
    modelName: { type: String },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cachedTokens: { type: Number, default: 0 },
    durationMs: { type: Number },
    error: { type: String },
    pendingSteps: { type: [Schema.Types.Mixed], default: undefined },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
  },
  { timestamps: false }
);

AgentRunSchema.index({ workspaceId: 1, startedAt: -1 });
AgentRunSchema.index({ chatId: 1, startedAt: -1 });

export const AgentRun =
  mongoose.models.AgentRun || mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);

export interface IAgentExecutionEvent extends Document {
  runId: string;
  workspaceId: string;
  seq: number;
  eventType:
    | 'LLM_START'
    | 'LLM_END'
    | 'SKILL_LOAD'
    | 'KB_RETRIEVAL'
    | 'TOOL_START'
    | 'TOOL_END'
    | 'APPROVAL_REQUIRED'
    | 'ERROR';
  payload?: Record<string, any>;
  timestamp: Date;
}

const AgentExecutionEventSchema = new Schema<IAgentExecutionEvent>(
  {
    runId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    seq: { type: Number, required: true },
    eventType: {
      type: String,
      enum: [
        'LLM_START',
        'LLM_END',
        'SKILL_LOAD',
        'KB_RETRIEVAL',
        'TOOL_START',
        'TOOL_END',
        'APPROVAL_REQUIRED',
        'ERROR',
      ],
      required: true,
    },
    payload: { type: Schema.Types.Mixed },
    timestamp: {
      type: Date,
      default: Date.now,
      expires: 30 * 24 * 60 * 60,
    },
  },
  { timestamps: false }
);

AgentExecutionEventSchema.index({ runId: 1, seq: 1 });

export const AgentExecutionEvent =
  mongoose.models.AgentExecutionEvent ||
  mongoose.model<IAgentExecutionEvent>('AgentExecutionEvent', AgentExecutionEventSchema);
