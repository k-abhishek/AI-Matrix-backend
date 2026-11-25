import { AgentStatus, AgentVersionStatus, AgentVisibility } from '@prisma/client';

export interface AgentDraftConfigInput {
  systemInstructions?: string;
  provider?: 'google' | 'groq' | 'openai' | 'anthropic' | 'ollama' | null;
  model?: string | null;
  temperature?: number;
  maxTokens?: number | null;
  maxIterations?: number;
  timeoutMs?: number;
  memoryConfig?: Record<string, any> | null;
  executionPolicy?: Record<string, any> | null;
}

export interface CreateAgentDTO extends AgentDraftConfigInput {
  name: string;
  description?: string;
  visibility?: AgentVisibility;
  systemInstructions: string;
}

export interface UpdateAgentDTO extends AgentDraftConfigInput {
  name?: string;
  description?: string | null;
  visibility?: AgentVisibility;
}

export interface AgentValidationResult {
  valid: boolean;
  versionId: string;
  errors: string[];
  warnings: string[];
}

export interface ListAgentsFilter {
  status?: AgentStatus;
  visibility?: AgentVisibility;
}

export type { AgentStatus, AgentVersionStatus, AgentVisibility };
