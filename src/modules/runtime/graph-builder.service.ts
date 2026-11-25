import {
  Annotation,
  Command,
  END,
  interrupt,
  MessagesAnnotation,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import knowledgeRetrievalService from '../knowledge/knowledge-retrieval.service';

export const CITATION_SYSTEM_INSTRUCTION =
  `\n\nWhen citing information from search_knowledge_base or web_search, include inline numeric citation markers immediately after the supported claim using each result's index (e.g. [1], [2]). Only cite indices returned by the tool and never invent URLs.`;

export const RuntimeAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  loadedSkills: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...a, ...b])],
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  citationUrls: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
});

export interface SkillMetadataEntry {
  key: string;
  name: string;
  summary: string;
  instructions: string;
}

export interface BuildGraphConfig {
  model: BaseChatModel;
  systemInstructions: string;
  maxIterations: number;
  workspaceId: string;
  knowledgeBaseIds: string[];
  skills: SkillMetadataEntry[];
  tools: any[];
  approvalRequiredTools: Set<string>;
  checkpointer?: BaseCheckpointSaver;
  onApprovalInterrupt?: (payload: {
    toolName: string;
    args: Record<string, any>;
    toolCallId?: string;
  }) => Promise<string | undefined>;
}

export class GraphBuilderService {
  /**
   * Dynamically compiles a reusable LangGraph StateGraph from resolved agent configuration:
   * - Registers `search_knowledge_base` ONLY if `knowledgeBaseIds.length > 0`
   * - Registers `load_skill` ONLY if `skills.length > 0` (progressive skill loading)
   * - Enforces `maxIterations` and `tool_gate` HITL interrupts
   */
  buildGraph(config: BuildGraphConfig) {
    const allTools: any[] = [...config.tools];
    const allowedToolNames = new Set<string>(allTools.map((t) => t.name));

    if (config.knowledgeBaseIds.length > 0) {
      const kbTool = tool(
        async ({ query, limit = 5 }) => {
          const results = await knowledgeRetrievalService.retrieve({
            query,
            workspaceId: config.workspaceId,
            knowledgeBaseIds: config.knowledgeBaseIds,
            topK: limit,
          });
          if (results.length === 0) {
            return 'No relevant knowledge base records found.';
          }
          return JSON.stringify(results);
        },
        {
          name: 'search_knowledge_base',
          description:
            'Search the authorized knowledge bases attached to this agent.',
          schema: z.object({
            query: z.string().min(1),
            limit: z.number().int().min(1).max(20).default(5).optional(),
          }),
        }
      );
      allTools.push(kbTool);
      allowedToolNames.add('search_knowledge_base');
    }

    if (config.skills.length > 0) {
      const skillMap = new Map(config.skills.map((s) => [s.key, s]));
      const loadSkillTool = tool(
        async ({ skillKey }) => {
          const found = skillMap.get(skillKey);
          if (!found) {
            return `Skill '${skillKey}' is not attached to this agent.`;
          }
          return `<skill_instructions key="${found.key}" name="${found.name}">\n${found.instructions}\n</skill_instructions>`;
        },
        {
          name: 'load_skill',
          description:
            'Load full operational instructions for an attached skill by its key.',
          schema: z.object({
            skillKey: z.string().min(1),
          }),
        }
      );
      allTools.push(loadSkillTool);
      allowedToolNames.add('load_skill');
    }

    const skillCatalogPrompt =
      config.skills.length > 0
        ? `\n\nAvailable Skills (call load_skill with skillKey when relevant):\n${config.skills
            .map((s) => `- ${s.key} (${s.name}): ${s.summary}`)
            .join('\n')}`
        : '';

    const hasCitationTool =
      allowedToolNames.has('search_knowledge_base') || allowedToolNames.has('web_search');
    const citationInstruction =
      hasCitationTool && !config.systemInstructions.includes('inline numeric citation markers')
        ? CITATION_SYSTEM_INSTRUCTION
        : '';

    const fullSystemPrompt = `${config.systemInstructions}${skillCatalogPrompt}${citationInstruction}`;
    const boundModel =
      allTools.length > 0 && typeof (config.model as any).bindTools === 'function'
        ? (config.model as any).bindTools(allTools)
        : config.model;

    const toolMap = new Map(allTools.map((t) => [t.name, t]));

    const graph = new StateGraph(RuntimeAgentState)
      .addNode('agent_llm', async (state, runnableConfig) => {
        if (state.iterationCount >= config.maxIterations) {
          return {
            messages: [
              new AIMessage(
                'Execution iteration limit reached. Summarizing current progress.'
              ),
            ],
          };
        }

        const response = await boundModel.invoke(
          [new SystemMessage(fullSystemPrompt), ...state.messages],
          runnableConfig
        );

        return {
          messages: [response],
          iterationCount: state.iterationCount + 1,
        };
      })
      .addNode('tool_gate', async (state) => {
        const lastMsg = state.messages.at(-1) as AIMessage;
        const toolCalls = lastMsg?.tool_calls ?? [];

        for (const tc of toolCalls) {
          if (!allowedToolNames.has(tc.name)) {
            return new Command({
              goto: 'agent_llm',
              update: {
                messages: [
                  new ToolMessage({
                    tool_call_id: tc.id || 'unknown',
                    content: `Permission denied: tool '${tc.name}' is not granted to this agent.`,
                  }),
                ],
              },
            });
          }

          if (config.approvalRequiredTools.has(tc.name)) {
            const approvalId = await config.onApprovalInterrupt?.({
              toolName: tc.name,
              args: tc.args || {},
              toolCallId: tc.id,
            });

            const decision = interrupt({
              approvalId,
              toolName: tc.name,
              args: tc.args || {},
            }) as { approved?: boolean } | undefined;

            if (!decision?.approved) {
              return new Command({
                goto: 'agent_llm',
                update: {
                  messages: [
                    new ToolMessage({
                      tool_call_id: tc.id || 'unknown',
                      content: `Tool '${tc.name}' execution was rejected by the user.`,
                    }),
                  ],
                },
              });
            }
          }
        }

        return new Command({ goto: 'tool_executor' });
      })
      .addNode('tool_executor', async (state) => {
        const lastMsg = state.messages.at(-1) as AIMessage;
        const toolCalls = lastMsg?.tool_calls ?? [];
        const toolMessages: ToolMessage[] = [];
        const turnCitationUrls = [...(state.citationUrls ?? [])];

        for (const tc of toolCalls) {
          const targetTool = toolMap.get(tc.name);
          if (!targetTool) {
            toolMessages.push(
              new ToolMessage({
                tool_call_id: tc.id || 'unknown',
                content: `Tool '${tc.name}' not found.`,
              })
            );
            continue;
          }
          try {
            const output = await targetTool.invoke(tc.args || {});
            let content = typeof output === 'string' ? output : JSON.stringify(output);

            try {
              const parsed = typeof output === 'string' ? JSON.parse(output) : output;
              if (Array.isArray(parsed) && parsed.some((item) => item && typeof item.url === 'string')) {
                const reindexed = parsed.map((item) => {
                  if (!item || typeof item.url !== 'string') return item;
                  let idx = turnCitationUrls.indexOf(item.url);
                  if (idx === -1) {
                    turnCitationUrls.push(item.url);
                    idx = turnCitationUrls.length - 1;
                  }
                  return { ...item, index: idx + 1 };
                });
                content = JSON.stringify(reindexed);
              }
            } catch {
              // Non-JSON tool output; pass through as-is
            }

            toolMessages.push(
              new ToolMessage({
                tool_call_id: tc.id || 'unknown',
                content,
              })
            );
          } catch (err: any) {
            toolMessages.push(
              new ToolMessage({
                tool_call_id: tc.id || 'unknown',
                content: `Tool error: ${err.message}`,
              })
            );
          }
        }

        return { messages: toolMessages, citationUrls: turnCitationUrls };
      })
      .addEdge(START, 'agent_llm')
      .addConditionalEdges('agent_llm', (state) => {
        const lastMsg = state.messages.at(-1) as AIMessage;
        return lastMsg?.tool_calls?.length ? 'tool_gate' : END;
      })
      .addEdge('tool_executor', 'agent_llm');

    return graph.compile(
      config.checkpointer ? { checkpointer: config.checkpointer } : undefined
    );
  }
}

export const graphBuilderService = new GraphBuilderService();
export default graphBuilderService;
