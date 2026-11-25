import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChatOllama } from '@langchain/ollama';
import env from '../../src/config/env';
import { modelFactoryService } from '../../src/services/modelFactory.service';

describe('ModelFactoryService', () => {
  const originalEnv = {
    NODE_ENV: env.NODE_ENV,
    OLLAMA_URL: env.OLLAMA_URL,
    OLLAMA_MODEL: env.OLLAMA_MODEL,
    AGENT_PROVIDER: env.AGENT_PROVIDER,
    AGENT_MODEL: env.AGENT_MODEL,
  };

  afterEach(() => {
    env.NODE_ENV = originalEnv.NODE_ENV;
    env.OLLAMA_URL = originalEnv.OLLAMA_URL;
    env.OLLAMA_MODEL = originalEnv.OLLAMA_MODEL;
    env.AGENT_PROVIDER = originalEnv.AGENT_PROVIDER;
    env.AGENT_MODEL = originalEnv.AGENT_MODEL;
    vi.restoreAllMocks();
  });

  it('uses local Ollama URL and OLLAMA_MODEL for both agent and LLM when NODE_ENV is development', () => {
    env.NODE_ENV = 'development';
    env.OLLAMA_URL = '';
    env.OLLAMA_MODEL = 'gemma4';

    // Default LLM call (e.g. ChatService / SkillService)
    const llmResult = modelFactoryService.createModel({ temperature: 0.5 });
    expect(llmResult.provider).toBe('ollama');
    expect(llmResult.modelName).toBe('gemma4');
    expect(llmResult.model).toBeInstanceOf(ChatOllama);
    expect((llmResult.model as ChatOllama).baseUrl).toBe('http://localhost:11434');

    // Explicit agent version config (e.g. AgentRuntimeService) should still route to local Ollama in development
    const agentResult = modelFactoryService.createModel({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      temperature: 0.2,
    });
    expect(agentResult.provider).toBe('ollama');
    expect(agentResult.modelName).toBe('gemma4');
    expect(agentResult.model).toBeInstanceOf(ChatOllama);
    expect((agentResult.model as ChatOllama).baseUrl).toBe('http://localhost:11434');
  });

  it('normalizes custom OLLAMA_URL by stripping /v1 and trailing slashes', () => {
    env.NODE_ENV = 'development';
    env.OLLAMA_URL = 'http://127.0.0.1:11434/v1/';
    env.OLLAMA_MODEL = 'llama3.2';

    const result = modelFactoryService.createModel();
    expect(result.provider).toBe('ollama');
    expect(result.modelName).toBe('llama3.2');
    expect((result.model as ChatOllama).baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('respects configured provider when NODE_ENV is not development', () => {
    env.NODE_ENV = 'production';
    env.AGENT_PROVIDER = 'auto';

    const result = modelFactoryService.createModel({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
    expect(result.provider).toBe('google');
    expect(result.modelName).toBe('gemini-3.5-flash-lite');
  });
});
