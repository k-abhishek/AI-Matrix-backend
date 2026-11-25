import {
  BaseStore,
  Item,
  Operation,
  OperationResults,
} from '@langchain/langgraph-checkpoint';
import LongTermMemory from '../../models/LongTermMemory';

/**
 * MongoDB-backed LangGraph BaseStore adapter for optional cross-thread semantic memory.
 * Strictly partitioned by [workspaceId, userId, agentId] namespaces.
 */
export class MongoBaseStore extends BaseStore {
  private encodeNamespace(namespace: string[]): string {
    return namespace.join('::');
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: any[] = [];

    for (const op of operations) {
      if ('value' in op) {
        // PutOperation
        const nsKey = this.encodeNamespace(op.namespace);
        if (op.value === null) {
          await LongTermMemory.deleteOne({ namespaceKey: nsKey, key: op.key });
        } else {
          await LongTermMemory.findOneAndUpdate(
            { namespaceKey: nsKey, key: op.key },
            {
              $set: {
                namespaceKey: nsKey,
                namespace: op.namespace,
                key: op.key,
                value: op.value,
              },
            },
            { upsert: true }
          );
        }
        results.push(undefined);
      } else if ('namespacePrefix' in op) {
        // SearchOperation
        const prefix = this.encodeNamespace(op.namespacePrefix);
        const queryRegex = op.query ? new RegExp(op.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
        const docs = await LongTermMemory.find({
          namespaceKey: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
        })
          .sort({ updatedAt: -1 })
          .limit(op.limit ?? 10)
          .lean();

        const items = docs
          .filter((d: any) => !queryRegex || queryRegex.test(JSON.stringify(d.value)))
          .map((d: any) => ({
            value: d.value,
            key: d.key,
            namespace: d.namespace,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          }));
        results.push(items);
      } else if ('matchConditions' in op) {
        // ListNamespacesOperation
        const namespaces = await LongTermMemory.distinct('namespace');
        results.push(namespaces);
      } else {
        // GetOperation
        const nsKey = this.encodeNamespace((op as any).namespace);
        const doc = (await LongTermMemory.findOne({
          namespaceKey: nsKey,
          key: (op as any).key,
        }).lean()) as any;
        results.push(
          doc
            ? ({
                value: doc.value,
                key: doc.key,
                namespace: doc.namespace,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
              } satisfies Item)
            : null
        );
      }
    }

    return results as OperationResults<Op>;
  }
}

export class MemoryService {
  constructor(private store: MongoBaseStore = new MongoBaseStore()) {}

  private buildNamespace(workspaceId: string, userId: string, agentId: string): string[] {
    return [workspaceId, userId, agentId];
  }

  async putMemory(
    workspaceId: string,
    userId: string,
    agentId: string,
    key: string,
    value: Record<string, any>
  ) {
    await this.store.put(this.buildNamespace(workspaceId, userId, agentId), key, value);
  }

  async listMemories(workspaceId: string, userId: string, agentId: string, query?: string) {
    return this.store.search(this.buildNamespace(workspaceId, userId, agentId), {
      query,
      limit: 50,
    });
  }

  async deleteMemory(workspaceId: string, userId: string, agentId: string, key: string) {
    await this.store.delete(this.buildNamespace(workspaceId, userId, agentId), key);
    return { deleted: true };
  }

  async clearAgentMemories(workspaceId: string, userId: string, agentId: string) {
    const nsKey = [workspaceId, userId, agentId].join('::');
    await LongTermMemory.deleteMany({ namespaceKey: nsKey });
    return { cleared: true };
  }
}

export const mongoBaseStore = new MongoBaseStore();
export const memoryService = new MemoryService(mongoBaseStore);
export default memoryService;
