import mongoose, { Schema, Document } from 'mongoose';

export interface ILongTermMemory extends Document {
  namespaceKey: string;
  namespace: string[];
  key: string;
  value: Record<string, any>;
  sourceChatId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

const LongTermMemorySchema = new Schema<ILongTermMemory>(
  {
    namespaceKey: { type: String, required: true, index: true },
    namespace: { type: [String], required: true },
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    sourceChatId: { type: String },
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

LongTermMemorySchema.index({ namespaceKey: 1, key: 1 }, { unique: true });

export const LongTermMemory =
  mongoose.models.LongTermMemory ||
  mongoose.model<ILongTermMemory>('LongTermMemory', LongTermMemorySchema);

export default LongTermMemory;
