import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IConnectorExecutionLog extends Document {
  connectionId: string;
  workspaceId: string;
  agentId?: string;
  userId?: string;
  toolName: string;
  connectorType: 'MCP' | 'NATIVE' | 'CUSTOM_REST';
  success: boolean;
  durationMs: number;
  parameters?: Record<string, any>;
  resultSummary?: string;
  error?: string;
  statusCode?: number;
  timestamp: Date;
}

const ConnectorExecutionLogSchema = new Schema<IConnectorExecutionLog>(
  {
    connectionId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    agentId: { type: String, index: true },
    userId: { type: String, index: true },
    toolName: { type: String, required: true, index: true },
    connectorType: {
      type: String,
      enum: ['MCP', 'NATIVE', 'CUSTOM_REST'],
      required: true,
      index: true,
    },
    success: { type: Boolean, required: true, index: true },
    durationMs: { type: Number, required: true },
    parameters: { type: Schema.Types.Mixed },
    resultSummary: { type: String },
    error: { type: String },
    statusCode: { type: Number },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      expires: 30 * 24 * 60 * 60, // 30-day automatic TTL expiration
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for multi-tenant telemetry and debugging queries
ConnectorExecutionLogSchema.index({ workspaceId: 1, timestamp: -1 });
ConnectorExecutionLogSchema.index({ connectionId: 1, timestamp: -1 });

export const ConnectorExecutionLog: Model<IConnectorExecutionLog> =
  mongoose.models.ConnectorExecutionLog ||
  mongoose.model<IConnectorExecutionLog>('ConnectorExecutionLog', ConnectorExecutionLogSchema);

export default ConnectorExecutionLog;
