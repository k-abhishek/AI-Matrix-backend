import { z } from 'zod';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BadRequestError } from '../../lib/errors';

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['llm', 'tool', 'condition', 'output']),
  promptTemplate: z.string().optional(),
  toolKey: z.string().optional(),
  conditionField: z.string().optional(),
  branches: z.record(z.string(), z.string()).optional(),
  next: z.string().optional(),
});

export const WorkflowDefinitionSchema = z.object({
  version: z.literal('1.0').default('1.0'),
  entryNodeId: z.string().min(1),
  maxNodes: z.number().int().min(1).max(20).default(10),
  maxIterations: z.number().int().min(1).max(25).default(10),
  nodes: z.array(WorkflowNodeSchema).min(1).max(20),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

const SubgraphState = Annotation.Root({
  input: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  context: Annotation<Record<string, any>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  output: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  stepsExecuted: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
});

export class WorkflowSubgraphBuilder {
  /**
   * Validates a declarative JSON DAG workflow definition before publication or compilation.
   */
  validateDefinition(raw: unknown): WorkflowDefinition {
    const parsed = WorkflowDefinitionSchema.parse(raw);
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));

    if (!nodeIds.has(parsed.entryNodeId)) {
      throw new BadRequestError(`entryNodeId '${parsed.entryNodeId}' does not exist in nodes`);
    }

    for (const node of parsed.nodes) {
      if (node.next && node.next !== '__end__' && !nodeIds.has(node.next)) {
        throw new BadRequestError(`Node '${node.id}' references unknown next node '${node.next}'`);
      }
      if (node.branches) {
        for (const target of Object.values(node.branches)) {
          if (target !== '__end__' && !nodeIds.has(target)) {
            throw new BadRequestError(`Node '${node.id}' branch references unknown node '${target}'`);
          }
        }
      }
    }

    return parsed;
  }

  /**
   * Compiles a validated declarative JSON DAG into a bounded LangGraph StateGraph subgraph.
   */
  compileSubgraph(
    rawDef: unknown,
    model: BaseChatModel,
    toolMap: Map<string, (args: Record<string, any>) => Promise<string>>
  ) {
    const def = this.validateDefinition(rawDef);
    const graph = new StateGraph(SubgraphState);

    for (const node of def.nodes) {
      graph.addNode(node.id, async (state) => {
        if (state.stepsExecuted >= def.maxIterations) {
          return { output: state.output || 'Workflow stopped: maxIterations reached.' };
        }

        if (node.type === 'llm') {
          const prompt = (node.promptTemplate || '{{input}}')
            .replace('{{input}}', state.input)
            .replace('{{output}}', state.output);
          const resp = await model.invoke([
            new SystemMessage('Execute this workflow step concisely.'),
            new HumanMessage(prompt),
          ]);
          const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
          return {
            output: text,
            context: { [node.id]: text },
            stepsExecuted: state.stepsExecuted + 1,
          };
        }

        if (node.type === 'tool') {
          const fn = node.toolKey ? toolMap.get(node.toolKey) : undefined;
          const res = fn
            ? await fn({ input: state.input, previousOutput: state.output })
            : `Tool '${node.toolKey}' not permitted in this workflow.`;
          return {
            output: res,
            context: { [node.id]: res },
            stepsExecuted: state.stepsExecuted + 1,
          };
        }

        return { stepsExecuted: state.stepsExecuted + 1 };
      });
    }

    graph.addEdge(START, def.entryNodeId as any);

    for (const node of def.nodes) {
      if (node.type === 'condition' && node.branches && node.conditionField) {
        graph.addConditionalEdges(node.id as any, (state) => {
          const val = String(state.context[node.conditionField!] ?? '');
          const target = node.branches![val] || node.next || '__end__';
          return target === '__end__' ? END : target;
        });
      } else {
        const nextTarget = !node.next || node.next === '__end__' ? END : (node.next as any);
        graph.addEdge(node.id as any, nextTarget);
      }
    }

    return graph.compile();
  }
}

export const workflowSubgraphBuilder = new WorkflowSubgraphBuilder();
export default workflowSubgraphBuilder;
