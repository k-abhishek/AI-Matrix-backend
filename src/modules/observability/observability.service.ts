import { AgentRun, AgentExecutionEvent } from '../../models/AgentRun';
import ConnectorExecutionLog from '../../models/ConnectorExecutionLog';
import logger from '../../lib/logger';

export class ObservabilityService {
  async startRun(input: {
    runId: string;
    workspaceId: string;
    userId: string;
    conversationId: string;
    agentId: string;
    agentVersionId: string;
    provider?: string;
    modelName?: string;
  }) {
    try {
      await AgentRun.create({
        runId: input.runId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        chatId: input.conversationId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        status: 'RUNNING',
        provider: input.provider,
        model: input.modelName,
        startedAt: new Date(),
      });
    } catch (err: any) {
      logger.warn(`[Observability] Failed to record startRun: ${err.message}`);
    }
  }

  async recordEvent(
    runId: string,
    workspaceId: string,
    seq: number,
    eventType: string,
    payload?: Record<string, any>
  ) {
    try {
      const normalizedType = (
        ['LLM_START', 'LLM_END', 'SKILL_LOAD', 'KB_RETRIEVAL', 'TOOL_START', 'TOOL_END', 'APPROVAL_REQUIRED', 'ERROR'].includes(eventType)
          ? eventType
          : 'LLM_START'
      ) as any;

      await AgentExecutionEvent.create({
        runId,
        workspaceId,
        seq,
        eventType: normalizedType,
        payload,
        timestamp: new Date(),
      });
    } catch (err: any) {
      logger.warn(`[Observability] Failed to record event: ${err.message}`);
    }
  }

  async completeRun(
    runId: string,
    update: {
      status: 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      error?: string;
    }
  ) {
    try {
      await AgentRun.findOneAndUpdate(
        { runId },
        {
          $set: {
            status: update.status,
            durationMs: update.durationMs,
            ...(update.inputTokens !== undefined ? { inputTokens: update.inputTokens } : {}),
            ...(update.outputTokens !== undefined ? { outputTokens: update.outputTokens } : {}),
            ...(update.cachedTokens !== undefined ? { cachedTokens: update.cachedTokens } : {}),
            ...(update.error !== undefined ? { error: update.error } : {}),
            completedAt: new Date(),
          },
        }
      );
    } catch (err: any) {
      logger.warn(`[Observability] Failed to completeRun: ${err.message}`);
    }
  }

  async listConversationRuns(chatId: string, workspaceId: string) {
    return AgentRun.find({ chatId, workspaceId })
      .sort({ startedAt: -1 })
      .limit(50)
      .lean();
  }

  async getRunDetails(runId: string, workspaceId: string) {
    const [run, events, toolLogs] = await Promise.all([
      AgentRun.findOne({ runId, workspaceId }).lean(),
      AgentExecutionEvent.find({ runId, workspaceId }).sort({ seq: 1 }).lean(),
      ConnectorExecutionLog.find({ workspaceId, agentId: { $exists: true } })
        .sort({ timestamp: -1 })
        .limit(20)
        .lean(),
    ]);
    return { run, events, toolLogs };
  }
}

export const observabilityService = new ObservabilityService();
export default observabilityService;
