import crypto from 'crypto';
import { Command } from '@langchain/langgraph';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import prisma from '../../lib/prisma';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import { WorkspaceContext } from '../../middleware/auth';
import modelFactoryService, { ModelProvider } from '../../services/modelFactory.service';
import chatRepository from '../chat/chat.repository';
import capabilityResolverService from '../capabilities/capability-resolver.service';
import graphBuilderService from './graph-builder.service';
import graphCacheService from './graph-cache.service';
import mongoCheckpointSaver from './mongo-checkpointer.service';
import { AgentRun, AgentExecutionEvent } from '../../models/AgentRun';
import { IChatCitation, IChatMessage, IChatStep, IToolCall } from '../../models/ChatThread';
import contextWindowService from '../../services/contextWindow.service';
import { vectorKnowledgeBaseTool, webSearchTool } from '../../tools';
import { inferStatusPhase } from '../agents/agent-tool-resolver.service';

export interface ExecuteAgentInput {
  agentId: string;
  prompt: string;
  chatId?: string;
  versionId?: string;
}

export interface StreamAgentInput {
  chatId?: string;
  agentId?: string;
  prompt?: string;
  versionId?: string;
}

export interface RuntimeStreamCallbacks {
  onInit?: (data: { chatId: string }) => void;
  onStatus?: (data: { status: string; taskName?: string; tool?: string }) => void;
  onToken?: (chunk: string) => void;
  onToolStart?: (data: { tool: string; taskName?: string; input: any }) => void;
  onToolEnd?: (data: { tool: string; taskName?: string; citations?: IChatCitation[] }) => void;
  onApprovalRequired?: (data: {
    approvalId: string;
    approvalToken: string;
    toolName: string;
    parameters: Record<string, any>;
    message: string;
  }) => void;
  onDone?: (data: {
    chatId: string;
    message: string;
    toolCalls: IToolCall[];
    citations: IChatCitation[];
    steps: IChatStep[];
  }) => void;
  onError?: (error: Error) => void;
}

export class AgentRuntimeService {
  private async recordEvent(
    runId: string,
    workspaceId: string,
    seq: number,
    eventType:
      | 'LLM_START'
      | 'LLM_END'
      | 'SKILL_LOAD'
      | 'KB_RETRIEVAL'
      | 'TOOL_START'
      | 'TOOL_END'
      | 'APPROVAL_REQUIRED'
      | 'ERROR',
    payload?: Record<string, any>
  ) {
    try {
      await AgentExecutionEvent.create({
        runId,
        workspaceId,
        seq,
        eventType,
        payload,
        timestamp: new Date(),
      });
    } catch {
      // Best-effort telemetry
    }
  }

  /**
   * Resolves the AgentVersion for execution:
   * - Pins new threads to Agent.activeVersionId
   * - Enforces thread.agentVersionId on existing threads
   * - Rejects REVOKED versions
   */
  async resolveExecutionVersion(ctx: WorkspaceContext, input: ExecuteAgentInput) {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      include: {
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });

    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${input.agentId}' not found in this workspace`);
    }
    if (agent.visibility === 'PERSONAL' && agent.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('You do not have access to this personal agent');
    }
    if (agent.status === 'ARCHIVED') {
      throw new BadRequestError('Cannot execute an archived agent');
    }

    const chatId = input.chatId?.trim() || crypto.randomUUID();
    const existingThread = await chatRepository.findByChatId(chatId, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });

    const targetVersionId =
      existingThread?.agentVersionId ||
      input.versionId ||
      agent.activeVersionId ||
      agent.versions[0]?.id;

    if (!targetVersionId) {
      throw new BadRequestError('Agent has no executable version');
    }

    const version = agent.versions.find((v) => v.id === targetVersionId);
    if (!version) {
      throw new NotFoundError(`Agent version '${targetVersionId}' not found`);
    }
    if (version.status === 'REVOKED') {
      throw new ForbiddenError(
        'This agent version has been revoked by an administrator. Please start a new conversation with the latest published version.'
      );
    }

    if (!existingThread) {
      const thread = await chatRepository.createThread(
        chatId,
        input.prompt.slice(0, 50),
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          agentId: agent.id,
        }
      );
      thread.agentVersionId = version.id;
      await thread.save();
    } else if (!existingThread.agentVersionId) {
      existingThread.agentVersionId = version.id;
      await existingThread.save();
    }

    return { agent, version, chatId };
  }

  async execute(ctx: WorkspaceContext, input: ExecuteAgentInput) {
    const startTime = Date.now();
    const runId = crypto.randomUUID();
    const { agent, version, chatId } = await this.resolveExecutionVersion(ctx, input);

    await AgentRun.create({
      runId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      chatId,
      agentId: agent.id,
      agentVersionId: version.id,
      status: 'RUNNING',
      provider: version.provider || undefined,
      llmModel: version.model || undefined,
      startedAt: new Date(),
    });

    let seq = 0;
    try {
      // Resolve attached KBs
      const kbLinks = await prisma.agentKnowledgeBase.findMany({
        where: {
          agentId: agent.id,
          isEnabled: true,
          OR: [{ agentVersionId: version.id }, { agentVersionId: null }],
        },
        select: { knowledgeBaseId: true },
      });
      const knowledgeBaseIds = [...new Set(kbLinks.map((k) => k.knowledgeBaseId))];

      // Resolve attached Skills
      const skillLinks = await prisma.agentSkill.findMany({
        where: {
          agentId: agent.id,
          isEnabled: true,
          OR: [{ agentVersionId: version.id }, { agentVersionId: null }],
        },
        include: { skill: true, skillVersion: true },
        orderBy: { priority: 'asc' },
      });

      const skills = skillLinks
        .filter((s) => s.skillVersion)
        .map((s) => ({
          key: s.skill.key,
          name: s.skill.name,
          summary: s.skillVersion!.summary,
          instructions: s.skillVersion!.instructions,
        }));

      // Resolve Tool Grants (WORKSPACE_SHARED & USER_DELEGATED)
      const { tools: grantedTools, connectionErrors } =
        await capabilityResolverService.resolveAgentGrants(ctx, agent.id, null);

      const approvalRequiredTools = new Set(
        grantedTools.filter((t) => t.requiresApproval).map((t) => t.toolKey)
      );

      const toolSetHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            kbs: knowledgeBaseIds,
            skills: skills.map((s) => s.key),
            tools: grantedTools.map((t) => t.toolKey),
          })
        )
        .digest('hex')
        .slice(0, 16);

      const cacheKey = graphCacheService.buildKey(version.id, version.configHash, toolSetHash);
      let compiledGraph = graphCacheService.get(cacheKey);

      if (!compiledGraph) {
        const { model } = modelFactoryService.createModel({
          provider: (version.provider as ModelProvider) || undefined,
          model: version.model || undefined,
          temperature: version.temperature,
          streaming: false,
        });

        compiledGraph = graphBuilderService.buildGraph({
          model,
          systemInstructions: version.systemInstructions,
          maxIterations: version.maxIterations,
          workspaceId: ctx.workspaceId,
          knowledgeBaseIds,
          skills,
          tools: grantedTools.map((t) => t.langchainTool),
          approvalRequiredTools,
          checkpointer: mongoCheckpointSaver,
          onApprovalInterrupt: async ({ toolName, args }) => {
            const approval = await prisma.agentApproval.create({
              data: {
                workspaceId: ctx.workspaceId,
                runId,
                conversationId: chatId,
                agentVersionId: version.id,
                userId: ctx.userId,
                toolName,
                parameters: args,
                status: 'PENDING',
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });
            await this.recordEvent(runId, ctx.workspaceId, ++seq, 'APPROVAL_REQUIRED', {
              approvalId: approval.id,
              toolName,
            });
            return approval.id;
          },
        });

        graphCacheService.set(cacheKey, compiledGraph);
      }

      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), version.timeoutMs);

      const result = await compiledGraph.invoke(
        { messages: [new HumanMessage(input.prompt)], iterationCount: 0, citationUrls: [] },
        {
          configurable: {
            thread_id: chatId,
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            runId,
          },
          recursionLimit: version.maxIterations * 2 + 4,
          signal: abortController.signal,
        }
      );

      clearTimeout(timeoutHandle);

      const resultMessages = Array.isArray(result.messages) ? result.messages : [];
      const lastMsg = resultMessages.at(-1) as any;
      const replyText =
        typeof lastMsg?.content === 'string'
          ? lastMsg.content
          : JSON.stringify(lastMsg?.content ?? '');

      const seenUrls = new Set<string>();
      const { toolCalls, citations, steps } = this.extractFromMessages(resultMessages, seenUrls);

      await chatRepository.appendMessages(chatId, [
        { role: 'user', content: input.prompt, createdAt: new Date() },
        {
          role: 'assistant',
          content: replyText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          citations: citations.length > 0 ? citations : undefined,
          steps: steps.length > 0 ? steps : undefined,
          createdAt: new Date(),
        },
      ]);

      await AgentRun.updateOne(
        { runId },
        {
          $set: {
            status: 'COMPLETED',
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        }
      );

      return {
        runId,
        chatId,
        agentId: agent.id,
        agentVersionId: version.id,
        message: replyText,
        toolCalls,
        citations,
        steps,
        connectionErrors,
      };
    } catch (err: any) {
      await this.recordEvent(runId, ctx.workspaceId, ++seq, 'ERROR', { message: err.message });
      await AgentRun.updateOne(
        { runId },
        {
          $set: {
            status: 'FAILED',
            error: err.message,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        }
      );
      throw err;
    }
  }

  async resolveApproval(
    ctx: WorkspaceContext,
    approvalId: string,
    approved: boolean
  ) {
    const approval = await prisma.agentApproval.findUnique({ where: { id: approvalId } });
    if (!approval || approval.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Approval '${approvalId}' not found in this workspace`);
    }
    if (approval.status !== 'PENDING') {
      throw new BadRequestError(`Approval '${approvalId}' is already ${approval.status}`);
    }

    const updated = await prisma.agentApproval.update({
      where: { id: approvalId },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        resolvedByUserId: ctx.userId,
        resolvedAt: new Date(),
      },
    });

    return {
      approval: updated,
      resumeCommand: new Command({ resume: { approved } }),
    };
  }

  private getToolMeta(toolName: string): { taskName: string; statusPhase: string } {
    if (toolName === 'search_knowledge_base') {
      return { taskName: 'Knowledge Base: Search', statusPhase: 'Searching' };
    }
    if (toolName === 'web_search') {
      return { taskName: 'Web: Search', statusPhase: 'Searching' };
    }
    if (toolName === 'load_skill') {
      return { taskName: 'Loading skill', statusPhase: 'Working' };
    }
    return {
      taskName: toolName,
      statusPhase: inferStatusPhase(toolName, false),
    };
  }

  private extractCitationsFromOutput(rawOutput: any, seenUrls: Set<string>): IChatCitation[] {
    const citations: IChatCitation[] = [];
    try {
      const content =
        typeof rawOutput === 'object' && rawOutput !== null && 'content' in rawOutput
          ? rawOutput.content
          : rawOutput;
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.url && !seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            citations.push({
              index: seenUrls.size,
              pageId: item.pageId,
              crawlerId: item.crawlerId,
              url: item.url,
              title: item.title,
              score: typeof item.score === 'number' ? item.score : undefined,
              snippet: typeof item.content === 'string' ? item.content.slice(0, 300) : undefined,
            });
          }
        }
      }
    } catch {
      // Non-JSON tool output
    }
    return citations;
  }

  private extractFromMessages(
    messages: any[],
    seenUrls: Set<string>
  ): { toolCalls: IToolCall[]; citations: IChatCitation[]; steps: IChatStep[] } {
    const toolCalls: IToolCall[] = [];
    const citations: IChatCitation[] = [];
    const steps: IChatStep[] = [];

    for (const msg of messages) {
      const rawMsg = msg as any;
      if (rawMsg?.tool_calls && Array.isArray(rawMsg.tool_calls)) {
        for (const tc of rawMsg.tool_calls) {
          const toolName = tc.name || 'tool';
          const meta = this.getToolMeta(toolName);
          toolCalls.push({
            name: toolName,
            taskName: meta.taskName,
            args: tc.args,
            toolCallId: tc.id,
          });
          steps.push({
            type: 'tool',
            status: meta.statusPhase,
            taskName: meta.taskName,
            tool: toolName,
            input: tc.args,
            timestamp: new Date(),
          });
        }
      }

      const isToolMsg =
        (typeof rawMsg?._getType === 'function' && rawMsg._getType() === 'tool') ||
        rawMsg?.role === 'tool';
      if (isToolMsg) {
        const matching = toolCalls.find((tc) => tc.toolCallId === rawMsg.tool_call_id);
        if (matching) {
          matching.output = rawMsg.content;
        }
        const newCitations = this.extractCitationsFromOutput(rawMsg.content, seenUrls);
        if (newCitations.length > 0) {
          citations.push(...newCitations);
          const matchingStep = [...steps]
            .reverse()
            .find((s) => s.type === 'tool' && s.tool === matching?.name && !s.citations);
          if (matchingStep) {
            matchingStep.citations = newCitations;
          }
        }
      }
    }

    return { toolCalls, citations, steps };
  }

  private async compileForAgentOrDefault(
    ctx: WorkspaceContext,
    params: {
      agentId: string | null;
      versionId: string | null;
      runId: string;
      chatId: string;
      streaming: boolean;
    }
  ) {
    if (!params.agentId || !params.versionId) {
      const { model } = modelFactoryService.createModel({
        temperature: 0.7,
        streaming: params.streaming,
      });
      const compiledGraph = graphBuilderService.buildGraph({
        model,
        systemInstructions:
          'You are a helpful and intelligent AI assistant Matrix. Provide concise, accurate answers.',
        maxIterations: 15,
        workspaceId: ctx.workspaceId,
        knowledgeBaseIds: [],
        skills: [],
        tools: [vectorKnowledgeBaseTool, webSearchTool],
        approvalRequiredTools: new Set(),
        checkpointer: mongoCheckpointSaver,
      });
      return { compiledGraph, maxIterations: 15, timeoutMs: 60000 };
    }

    const agent = await prisma.agent.findUnique({
      where: { id: params.agentId },
      include: { versions: true },
    });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${params.agentId}' not found in this workspace`);
    }
    if (agent.visibility === 'PERSONAL' && agent.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('You do not have access to this personal agent');
    }

    const version = agent.versions.find((v) => v.id === params.versionId);
    if (!version) {
      throw new NotFoundError(`Agent version '${params.versionId}' not found`);
    }
    if (version.status === 'REVOKED') {
      const err = new ForbiddenError(
        'This agent version has been revoked by an administrator. Please start a new conversation with the latest published version.'
      );
      (err as any).code = 'VERSION_REVOKED';
      throw err;
    }

    const kbLinks = await prisma.agentKnowledgeBase.findMany({
      where: {
        agentId: agent.id,
        isEnabled: true,
        OR: [{ agentVersionId: version.id }, { agentVersionId: null }],
      },
      select: { knowledgeBaseId: true },
    });
    const knowledgeBaseIds = [...new Set(kbLinks.map((k) => k.knowledgeBaseId))];

    const skillLinks = await prisma.agentSkill.findMany({
      where: {
        agentId: agent.id,
        isEnabled: true,
        OR: [{ agentVersionId: version.id }, { agentVersionId: null }],
      },
      include: { skill: true, skillVersion: true },
      orderBy: { priority: 'asc' },
    });
    const skills = skillLinks
      .filter((s) => s.skillVersion)
      .map((s) => ({
        key: s.skill.key,
        name: s.skill.name,
        summary: s.skillVersion!.summary,
        instructions: s.skillVersion!.instructions,
      }));

    const { tools: grantedTools } = await capabilityResolverService.resolveAgentGrants(
      ctx,
      agent.id,
      null
    );
    const approvalRequiredTools = new Set(
      grantedTools.filter((t) => t.requiresApproval).map((t) => t.toolKey)
    );

    const { model } = modelFactoryService.createModel({
      provider: (version.provider as ModelProvider) || undefined,
      model: version.model || undefined,
      temperature: version.temperature,
      streaming: params.streaming,
    });

    const compiledGraph = graphBuilderService.buildGraph({
      model,
      systemInstructions: version.systemInstructions,
      maxIterations: version.maxIterations,
      workspaceId: ctx.workspaceId,
      knowledgeBaseIds,
      skills,
      tools: grantedTools.map((t) => t.langchainTool),
      approvalRequiredTools,
      checkpointer: mongoCheckpointSaver,
      onApprovalInterrupt: async ({ toolName, args }) => {
        const approval = await prisma.agentApproval.create({
          data: {
            workspaceId: ctx.workspaceId,
            runId: params.runId,
            conversationId: params.chatId,
            agentVersionId: version.id,
            userId: ctx.userId,
            toolName,
            parameters: args,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
        return approval.id;
      },
    });

    return {
      compiledGraph,
      maxIterations: version.maxIterations,
      timeoutMs: version.timeoutMs,
    };
  }

  private async runGraphStream(
    ctx: WorkspaceContext,
    params: {
      compiledGraph: any;
      graphInput: any;
      chatId: string;
      runId: string;
      agentId?: string | null;
      versionId?: string | null;
      maxIterations: number;
      timeoutMs: number;
      promptForPersistence?: string;
      userMessageAlreadyPersisted: boolean;
      initialSteps?: IChatStep[];
    },
    callbacks: RuntimeStreamCallbacks,
    signal?: AbortSignal
  ) {
    const startTime = Date.now();
    const extractedToolCalls: IToolCall[] = [];
    const extractedCitations: IChatCitation[] = [];
    const extractedSteps: IChatStep[] = [...(params.initialSteps ?? [])];
    const seenUrls = new Set<string>();
    let fullAssistantContent = '';
    let hasEmittedComposing = false;
    let seq = 0;

    const emitStatus = (status: string, taskName?: string, tool?: string) => {
      extractedSteps.push({
        type: 'status',
        status,
        taskName,
        ...(tool ? { tool } : {}),
        timestamp: new Date(),
      });
      callbacks.onStatus?.({ status, taskName, ...(tool ? { tool } : {}) });
    };

    const configurable = {
      thread_id: params.chatId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      runId: params.runId,
    };

    try {
      const maxStreamAttempts = 2;
      for (let attempt = 0; attempt < maxStreamAttempts; attempt++) {
        try {
          const eventStream = params.compiledGraph.streamEvents(params.graphInput, {
            version: 'v2',
            configurable,
            recursionLimit: params.maxIterations * 2 + 4,
            signal,
          });

          for await (const event of eventStream) {
            if (signal?.aborted) return;

            if (event.event === 'on_chat_model_stream') {
              const chunk = event.data?.chunk;
              let textChunk = '';
              if (typeof chunk?.content === 'string') {
                textChunk = chunk.content;
              } else if (Array.isArray(chunk?.content)) {
                for (const part of chunk.content) {
                  if (typeof part === 'string') textChunk += part;
                  else if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
                    textChunk += (part as any).text;
                  }
                }
              }
              if (textChunk) {
                if (!hasEmittedComposing) {
                  hasEmittedComposing = true;
                  emitStatus('Composing', 'Composing response');
                }
                fullAssistantContent += textChunk;
                callbacks.onToken?.(textChunk);
              }
            } else if (event.event === 'on_tool_start') {
              const toolName = event.name || 'tool';
              const meta = this.getToolMeta(toolName);
              extractedToolCalls.push({
                name: toolName,
                taskName: meta.taskName,
                args: event.data?.input,
              });
              extractedSteps.push({
                type: 'tool',
                status: meta.statusPhase,
                taskName: meta.taskName,
                tool: toolName,
                input: event.data?.input,
                timestamp: new Date(),
              });
              await this.recordEvent(params.runId, ctx.workspaceId, ++seq, 'TOOL_START', { toolName });
              callbacks.onStatus?.({ status: meta.statusPhase, taskName: meta.taskName, tool: toolName });
              callbacks.onToolStart?.({ tool: toolName, taskName: meta.taskName, input: event.data?.input });
            } else if (event.event === 'on_tool_end') {
              const toolName = event.name || 'tool';
              const meta = this.getToolMeta(toolName);
              const toolOutput = event.data?.output;
              const matching =
                [...extractedToolCalls].reverse().find((tc) => tc.name === toolName && !tc.output) ||
                extractedToolCalls.at(-1);
              if (matching) matching.output = toolOutput;

              const citations = this.extractCitationsFromOutput(toolOutput, seenUrls);
              if (citations.length > 0) extractedCitations.push(...citations);

              const matchingStep =
                [...extractedSteps].reverse().find((s) => s.type === 'tool' && s.tool === toolName && !s.citations) ||
                extractedSteps.at(-1);
              if (matchingStep && matchingStep.type === 'tool' && citations.length > 0) {
                matchingStep.citations = citations;
              }

              await this.recordEvent(params.runId, ctx.workspaceId, ++seq, 'TOOL_END', { toolName });
              callbacks.onToolEnd?.({
                tool: toolName,
                taskName: meta.taskName,
                citations: citations.length > 0 ? citations : undefined,
              });
              hasEmittedComposing = false;
              emitStatus('Solving', 'Analyzing results');
            }
          }
          break;
        } catch (streamErr: unknown) {
          const streamMsg =
            streamErr instanceof Error ? streamErr.message : String(streamErr);
          const isTransientStreamParseError =
            streamMsg.includes('Failed to parse stream') ||
            streamMsg.includes('Error parsing JSON response');

          if (!isTransientStreamParseError || signal?.aborted) {
            throw streamErr;
          }

          // If tokens were already streamed and the stream parser errored at EOF,
          // keep the streamed content so it is persisted and onDone is emitted.
          if (fullAssistantContent !== '') {
            break;
          }

          const canRetry = attempt === 0 && extractedToolCalls.length === 0;
          if (canRetry) {
            hasEmittedComposing = false;
            continue;
          }

          // Fallback to non-streaming graph invoke when stream parsing persists
          const { compiledGraph: fallbackGraph } = await this.compileForAgentOrDefault(ctx, {
            agentId: params.agentId ?? null,
            versionId: params.versionId ?? null,
            runId: params.runId,
            chatId: params.chatId,
            streaming: false,
          });

          const fallbackResult = await fallbackGraph.invoke(params.graphInput, {
            configurable,
            recursionLimit: params.maxIterations * 2 + 4,
            signal,
          });

          const resultMessages: BaseMessage[] = Array.isArray(fallbackResult?.messages)
            ? fallbackResult.messages
            : [];
          const fallbackExtracted = this.extractFromMessages(resultMessages, seenUrls);
          extractedToolCalls.push(...fallbackExtracted.toolCalls);
          extractedCitations.push(...fallbackExtracted.citations);
          extractedSteps.push(...fallbackExtracted.steps);

          for (const tc of fallbackExtracted.toolCalls) {
            callbacks.onToolStart?.({
              tool: tc.name,
              taskName: tc.taskName,
              input: tc.args,
            });
            callbacks.onToolEnd?.({
              tool: tc.name,
              taskName: tc.taskName,
              citations: fallbackExtracted.citations.length > 0 ? fallbackExtracted.citations : undefined,
            });
          }

          const lastFallbackMsg = resultMessages.at(-1) as any;
          if (lastFallbackMsg) {
            if (typeof lastFallbackMsg.content === 'string') {
              fullAssistantContent = lastFallbackMsg.content;
            } else if (Array.isArray(lastFallbackMsg.content)) {
              fullAssistantContent = lastFallbackMsg.content
                .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
                .join('');
            }
          }

          emitStatus('Composing', 'Composing response');
          if (fullAssistantContent) {
            callbacks.onToken?.(fullAssistantContent);
          }
          break;
        }
      }

      // Check if execution paused at a LangGraph interrupt()
      const graphState = await params.compiledGraph.getState({ configurable }).catch(() => null);
      const pendingInterrupt = (graphState as any)?.tasks
        ?.flatMap((t: any) => t.interrupts || [])
        ?.at(0);

      if (pendingInterrupt) {
        const val = (pendingInterrupt.value || {}) as Record<string, any>;
        const approvalId = String(val.approvalId || '');
        const toolName = String(val.toolName || 'tool');
        extractedSteps.push({
          type: 'approval',
          status: 'ApprovalRequired',
          taskName: `Approval required: ${toolName}`,
          tool: toolName,
          input: (val.args as Record<string, any>) || {},
          timestamp: new Date(),
        });
        await AgentRun.updateOne(
          { runId: params.runId },
          { $set: { status: 'WAITING_APPROVAL', pendingSteps: extractedSteps } }
        );
        await this.recordEvent(params.runId, ctx.workspaceId, ++seq, 'APPROVAL_REQUIRED', {
          approvalId,
          toolName: val.toolName,
        });
        callbacks.onApprovalRequired?.({
          approvalId,
          approvalToken: approvalId,
          toolName,
          parameters: (val.args as Record<string, any>) || {},
          message: `Action '${toolName}' requires human approval before execution.`,
        });
        return;
      }

      if (!signal?.aborted) {
        const toAppend: IChatMessage[] = [];
        if (params.promptForPersistence && !params.userMessageAlreadyPersisted) {
          toAppend.push({ role: 'user', content: params.promptForPersistence, createdAt: new Date() });
        }
        toAppend.push({
          role: 'assistant',
          content: fullAssistantContent,
          toolCalls: extractedToolCalls.length > 0 ? extractedToolCalls : undefined,
          citations: extractedCitations.length > 0 ? extractedCitations : undefined,
          steps: extractedSteps.length > 0 ? extractedSteps : undefined,
          createdAt: new Date(),
        });
        await chatRepository.appendMessages(params.chatId, toAppend);

        await AgentRun.updateOne(
          { runId: params.runId },
          {
            $set: {
              status: 'COMPLETED',
              durationMs: Date.now() - startTime,
              completedAt: new Date(),
            },
            $unset: { pendingSteps: '' },
          }
        );

        callbacks.onDone?.({
          chatId: params.chatId,
          message: fullAssistantContent,
          toolCalls: extractedToolCalls,
          citations: extractedCitations,
          steps: extractedSteps,
        });
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') return;
      await this.recordEvent(params.runId, ctx.workspaceId, ++seq, 'ERROR', { message: err.message });
      await AgentRun.updateOne(
        { runId: params.runId },
        {
          $set: {
            status: 'FAILED',
            error: err.message,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        }
      );
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Streams a conversational turn using the pinned AgentVersion & MongoCheckpointSaver.
   */
  async streamExecution(
    ctx: WorkspaceContext,
    input: StreamAgentInput,
    callbacks: RuntimeStreamCallbacks,
    signal?: AbortSignal
  ) {
    const chatId = input.chatId?.trim() || crypto.randomUUID();
    const initialSteps: IChatStep[] = [];
    const pushInitialStatus = (status: string, taskName: string) => {
      initialSteps.push({ type: 'status', status, taskName, timestamp: new Date() });
      callbacks.onStatus?.({ status, taskName });
    };

    callbacks.onInit?.({ chatId });
    pushInitialStatus('Working', 'Understanding your request');

    const existingThread = await chatRepository.findByChatId(chatId, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });

    const lastThreadMsg = existingThread?.messages?.at(-1);
    const trimmedPrompt = input.prompt?.trim();
    const resolvedPrompt =
      trimmedPrompt ||
      (lastThreadMsg?.role === 'user' ? lastThreadMsg.content : '');

    if (!resolvedPrompt) {
      throw new BadRequestError('Prompt is required when no pending user message exists in thread');
    }

    const userMessageAlreadyPersisted = Boolean(
      existingThread &&
        lastThreadMsg?.role === 'user' &&
        lastThreadMsg.content.trim() === resolvedPrompt
    );

    const agentId = existingThread?.agentId || input.agentId || null;
    let versionId = existingThread?.agentVersionId || input.versionId || null;

    if (agentId && !versionId) {
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      versionId = agent?.activeVersionId || null;
    }

    if (!existingThread) {
      await chatRepository.createThread(
        chatId,
        resolvedPrompt.slice(0, 50),
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          agentId: agentId ?? undefined,
          agentVersionId: versionId ?? undefined,
        }
      );
    }

    const runId = crypto.randomUUID();
    await AgentRun.create({
      runId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      chatId,
      agentId: agentId || 'default-assistant',
      agentVersionId: versionId || 'default',
      status: 'RUNNING',
      startedAt: new Date(),
    });

    const { compiledGraph, maxIterations, timeoutMs } = await this.compileForAgentOrDefault(ctx, {
      agentId,
      versionId,
      runId,
      chatId,
      streaming: true,
    });

    // Avoid duplicating history when a LangGraph checkpoint already exists for this thread;
    // only hydrate via contextWindowService when no checkpoint exists yet.
    const existingCheckpoint = await mongoCheckpointSaver
      .getTuple({ configurable: { thread_id: chatId } })
      .catch(() => undefined);

    let graphMessages: any[] = [new HumanMessage(resolvedPrompt)];
    if (
      !existingCheckpoint &&
      existingThread &&
      existingThread.messages.length > (userMessageAlreadyPersisted ? 1 : 0)
    ) {
      const { model } = modelFactoryService.createModel({ streaming: false });
      const threadSlice = userMessageAlreadyPersisted
        ? ({
            ...(existingThread.toObject?.() || existingThread),
            messages: existingThread.messages.slice(0, -1),
          } as any)
        : existingThread;
      const prepared = await contextWindowService.prepareMessages({
        thread: threadSlice,
        newPrompt: resolvedPrompt,
        model,
        provider: 'google',
        includeSystemPrompt: false,
      });
      graphMessages = prepared.messages;
    }

    pushInitialStatus('Solving', 'Planning response');

    await this.runGraphStream(
      ctx,
      {
        compiledGraph,
        graphInput: { messages: graphMessages, iterationCount: 0, citationUrls: [] },
        chatId,
        runId,
        agentId,
        versionId,
        maxIterations,
        timeoutMs,
        promptForPersistence: resolvedPrompt,
        userMessageAlreadyPersisted,
        initialSteps,
      },
      callbacks,
      signal
    );
  }

  /**
   * Resolves a pending HITL approval and SSE-streams the resumed LangGraph turn.
   */
  async resumeApprovalStream(
    ctx: WorkspaceContext,
    approvalId: string,
    approved: boolean,
    callbacks: RuntimeStreamCallbacks,
    signal?: AbortSignal
  ) {
    const { approval, resumeCommand } = await this.resolveApproval(ctx, approvalId, approved);
    const [thread, existingRun] = await Promise.all([
      chatRepository.findByChatId(approval.conversationId, {
        workspaceId: ctx.workspaceId,
      }),
      AgentRun.findOne({ runId: approval.runId }).lean(),
    ]);

    const initialSteps: IChatStep[] = Array.isArray((existingRun as any)?.pendingSteps)
      ? ([...(existingRun as any).pendingSteps] as IChatStep[])
      : [];
    const resumeTaskName = approved ? 'Resuming approved action' : 'Handling rejected action';
    initialSteps.push({
      type: 'status',
      status: 'Working',
      taskName: resumeTaskName,
      timestamp: new Date(),
    });

    callbacks.onInit?.({ chatId: approval.conversationId });
    callbacks.onStatus?.({
      status: 'Working',
      taskName: resumeTaskName,
    });

    const { compiledGraph, maxIterations, timeoutMs } = await this.compileForAgentOrDefault(ctx, {
      agentId: thread?.agentId || null,
      versionId: approval.agentVersionId,
      runId: approval.runId,
      chatId: approval.conversationId,
      streaming: true,
    });

    await AgentRun.updateOne({ runId: approval.runId }, { $set: { status: 'RUNNING' } });

    await this.runGraphStream(
      ctx,
      {
        compiledGraph,
        graphInput: resumeCommand,
        chatId: approval.conversationId,
        runId: approval.runId,
        maxIterations,
        timeoutMs,
        userMessageAlreadyPersisted: true,
        initialSteps,
      },
      callbacks,
      signal
    );
  }
}

export const agentRuntimeService = new AgentRuntimeService();
export default agentRuntimeService;
