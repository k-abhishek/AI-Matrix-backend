import mongoose, { Schema, Document } from 'mongoose';

export interface ILangGraphCheckpoint extends Document {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  parentCheckpointId?: string;
  workspaceId?: string;
  checkpoint: string;
  metadata: string;
  createdAt: Date;
}

export interface ILangGraphCheckpointWrite extends Document {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  taskId: string;
  taskPath: string;
  idx: number;
  channel: string;
  type: string;
  value: string;
  createdAt: Date;
}

const LangGraphCheckpointSchema = new Schema<ILangGraphCheckpoint>(
  {
    threadId: { type: String, required: true, index: true },
    checkpointNs: { type: String, default: '' },
    checkpointId: { type: String, required: true },
    parentCheckpointId: { type: String },
    workspaceId: { type: String, index: true },
    checkpoint: { type: String, required: true },
    metadata: { type: String, required: true },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 90 * 24 * 60 * 60, // 90-day TTL
    },
  },
  { timestamps: false }
);

LangGraphCheckpointSchema.index(
  { threadId: 1, checkpointNs: 1, checkpointId: 1 },
  { unique: true }
);

const LangGraphCheckpointWriteSchema = new Schema<ILangGraphCheckpointWrite>(
  {
    threadId: { type: String, required: true },
    checkpointNs: { type: String, default: '' },
    checkpointId: { type: String, required: true },
    taskId: { type: String, required: true },
    taskPath: { type: String, default: '' },
    idx: { type: Number, required: true },
    channel: { type: String, required: true },
    type: { type: String, required: true },
    value: { type: String, required: true },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 90 * 24 * 60 * 60,
    },
  },
  { timestamps: false }
);

LangGraphCheckpointWriteSchema.index({ threadId: 1, checkpointNs: 1, checkpointId: 1 });

export const LangGraphCheckpoint =
  mongoose.models.LangGraphCheckpoint ||
  mongoose.model<ILangGraphCheckpoint>('LangGraphCheckpoint', LangGraphCheckpointSchema);

export const LangGraphCheckpointWrite =
  mongoose.models.LangGraphCheckpointWrite ||
  mongoose.model<ILangGraphCheckpointWrite>(
    'LangGraphCheckpointWrite',
    LangGraphCheckpointWriteSchema
  );
