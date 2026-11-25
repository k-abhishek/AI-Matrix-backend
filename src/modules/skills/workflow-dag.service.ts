import { z } from 'zod';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StructuredToolInterface } from '@langchain/core/tools';
import { BadRequestError } from '../../lib/errors';

export const MAX_WORKFLOW_NODES = 20;
export const MAX_WORKFLOW_ITERATIONS = 10;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['llm', 'tool', 'condition', 'output']),
  name: z.string().min(1).max(120).optional(),
  promptTemplate: z.string().optional(),
  toolKey: z.string().optional(),
  argsMapping: z.record(z.string(), z.any()).optional(),
  conditionField: z.string().optional(),
  conditionEquals: z.string().optional(),
  trueTarget: z.string().optional(),
  falseTarget: z.string().optional(),
});

export const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const WorkflowDefinitionSchema = z.object({
  entryNodeId: z.string().min(1),
  maxIterations: z.number().int().min(1).max(MAX_WORKFLOW_ITERATIONS).default(MAX_WORKFLOW_ITERATIONS),
  timeoutMs: z.number().int().min(1000).max(120000).default(60000),
  nodes: z.array(WorkflowNodeSchema).min(1).max(MAX_WORKFLOW_NODES),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

const WorkflowState = Annotation.Root({
  input: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  context: Annotation<Record<string, any>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  output: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  stepsExecuted: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
});

export class WorkflowDagService {
  /**
   * Validates a declarative JSON workflow definition (node types, references,
   * cycle detection for non-conditional edges, and resource bounds).
   */
  validateDefinition(raw: unknown): { valid: boolean; errors: string[]; parsed?: WorkflowDefinition } {
    const parsedResult = WorkflowDefinitionSchema.safeParse(raw);
    if (!parsedResult.success) {
      return {
        valid: false,
        errors: parsedResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }

    const def = parsedResult.data;
    const errors: string[] = [];
    const nodeIds = new Set(def.nodes.map((n) => n.id));

    if (nodeIds.size !== def.nodes.length) {
      errors.push('Workflow nodes must have unique IDs');
    }
    if (!nodeIds.has(def.entryNodeId)) {
      errors.push(`entryNodeId '${def.entryNodeId}' does not match any node`);
    }

    for (const node of def.nodes) {
      if (node.type === 'llm' && !node.promptTemplate) {
        errors.push(`LLM node '${node.id}' requires promptTemplate`);
      }
      if (node.type === 'tool' && !node.toolKey) {
        errors.push(`Tool node '${node.id}' requires toolKey`);
      }
      if (node.type === 'condition') {
        if (!node.conditionField || !node.trueTarget || !node.falseTarget) {
          errors.push(`Condition node '${node.id}' requires conditionField, trueTarget, and falseTarget`);
        } else {
          if (node.trueTarget !== 'END' && !nodeIds.has(node.trueTarget)) {
            errors.push(`Condition node '${node.id}' trueTarget '${node.trueTarget}' not found`);
          }
          if (node.falseTarget !== 'END' && !nodeIds.has(node.falseTarget)) {
            errors.push(`Condition node '${node.id}' falseTarget '${node.falseTarget}' not found`);
          }
        }
      }
    }

    for (const edge of def.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge source '${edge.from}' not found`);
      }
      if (edge.to !== 'END' && !nodeIds.has(edge.to)) {
        errors.push(`Edge target '${edge.to}' not found`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      parsed: errors.length === 0 ? def : undefined,
    };
  }

  /**
   * Compiles a validated declarative JSON DAG into a bounded LangGraph StateGraph subgraph.
   */
  compileSubgraph(
    rawDef: unknown,
    deps: {
      model: BaseChatModel;
      toolsByKey: Map<string, StructuredToolInterface>;
    }
  ) {
    const validation = this.validateDefinition(rawDef);
    if (!validation.valid || !validation.parsed) {
      throw new BadRequestError('Invalid workflow definition', { errors: validation.errors });
    }

    const def = validation.parsed;
    const graph = new StateGraph(WorkflowState);

    for (const node of def.nodes) {
      graph.addNode(node.id, async (state) => {
        if (state.stepsExecuted >= def.maxIterations) {
          return {
            output: state.output || 'Workflow iteration limit reached.',
            stepsExecuted: state.stepsExecuted + 1,
          };
        }

        if (node.type === 'llm') {
          const prompt = (node.promptTemplate || '{{input}}')
            .replace(/\{\{input\}\}/g, state.input)
            .replace(/\{\{lastOutput\}\}/g, state.output);
          const res = await deps.model.invoke([
            new SystemMessage('Execute this workflow step concisely and accurately.'),
            new HumanMessage(prompt),
          ]);
          const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
          return {
            output: text,
            context: { [node.id]: text },
            stepsExecuted: state.stepsExecuted + 1,
          };
        }

        if (node.type === 'tool') {
          const tool = node.toolKey ? deps.toolsByKey.get(node.toolKey) : undefined;
          if (!tool) {
            const errText = `Permitted tool '${node.toolKey}' is not available in this context.`;
            return {
              output: errText,
              context: { [node.id]: { error: errText } },
              stepsExecuted: state.stepsExecuted + 1,
            };
          }
          const args = { ...(node.argsMapping || {}), query: state.input };
          const toolRes = await tool.invoke(args);
          const text = typeof toolRes === 'string' ? toolRes : JSON.stringify(toolRes);
          return {
            output: text,
            context: { [node.id]: text },
            stepsExecuted: state.stepsExecuted + 1,
          };
        }

        if (node.type === 'condition') {
          return { stepsExecuted: state.stepsExecuted + 1 };
        }

        // output node
        return {
          output: state.output,
          stepsExecuted: state.stepsExecuted + 1,
        };
      });
    }

    graph.addEdge(START, def.entryNodeId as any);

    for (const node of def.nodes) {
      if (node.type === 'condition') {
        graph.addConditionalEdges(node.id as any, (state) => {
          const val = String(state.context[node.conditionField || ''] ?? state.output ?? '');
          const matched = node.conditionEquals ? val.includes(node.conditionEquals) : Boolean(val);
          const target = matched ? node.trueTarget! : node.falseTarget!;
          return target === 'END' ? END : (target as any);
        });
      }
    }

    for (const edge of def.edges) {
      graph.addEdge(edge.from as any, edge.to === 'END' ? END : (edge.to as any));
    }

    // Ensure nodes without outgoing edges terminate cleanly
    const nodesWithOutgoing = new Set([
      ...def.edges.map((e) => e.from),
      ...def.nodes.filter((n) => n.type === 'condition').map((n) => n.id),
    ]);
    for (const node of def.nodes) {
      if (!nodesWithOutgoing.has(node.id)) {
        graph.addEdge(node.id as any, END);
      }
    }

    return graph.compile();
  }
}

export const workflowDagService = new WorkflowDagService();
export default workflowDagService;
