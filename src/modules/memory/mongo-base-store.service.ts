import {
  BaseStore,
  Item,
  ListNamespacesOperation,
  Operation,
  OperationResults,
  SearchItem,
} from '@langchain/langgraph-checkpoint';
import LongTermMemory from '../../models/LongTermMemory';

function joinNs(namespace: string[]): string {
  return namespace.join('::');
}

/**
 * MongoDB-backed implementation of LangGraph BaseStore for optional cross-thread
 * semantic memory, strictly partitioned by [workspaceId, userId, agentId].
 */
export class MongoBaseStore extends BaseStore {
  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: any[] = [];

    for (const op of operations) {
      if ('key' in op && !('value' in op)) {
        // GetOperation
        const doc = await LongTermMemory.findOne({
          namespaceKey: joinNs(op.namespace),
          key: op.key,
        }).lean();
        if (!doc) {
          results.push(null);
        } else {
          results.push({
            value: (doc as any).value,
            key: (doc as any).key,
            namespace: (doc as any).namespace,
            createdAt: (doc as any).createdAt,
            updatedAt: (doc as any).updatedAt,
          } satisfies Item);
        }
      } else if ('value' in op) {
        // PutOperation
        if (op.value === null) {
          await LongTermMemory.deleteOne({
            namespaceKey: joinNs(op.namespace),
            key: op.key,
          });
        } else {
          await LongTermMemory.findOneAndUpdate(
            { namespaceKey: joinNs(op.namespace), key: op.key },
            {
              $set: {
                namespace: op.namespace,
                value: op.value,
              },
            },
            { upsert: true }
          );
        }
        results.push(undefined);
      } else if ('namespacePrefix' in op) {
        // SearchOperation
        const prefix = joinNs(op.namespacePrefix);
        const docs = await LongTermMemory.find({
          namespaceKey: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
        })
          .sort({ updatedAt: -1 })
          .limit(op.limit ?? 10)
          .skip(op.offset ?? 0)
          .lean();

        const queryLower = (op.query || '').toLowerCase();
        const filtered = queryLower
          ? docs.filter((d: any) =>
              JSON.stringify(d.value).toLowerCase().includes(queryLower)
            )
          : docs;

        results.push(
          filtered.map(
            (d: any) =>
              ({
                value: d.value,
                key: d.key,
                namespace: d.namespace,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
                score: 1.0,
              }) satisfies SearchItem
          )
        );
      } else {
        // ListNamespacesOperation
        const listOp = op as ListNamespacesOperation;
        const docs = await LongTermMemory.distinct('namespace');
        results.push((docs || []).slice(0, listOp.limit ?? 50));
      }
    }

    return results as OperationResults<Op>;
  }

  async clearAgentUserMemory(workspaceId: string, userId: string, agentId: string): Promise<number> {
    const res = await LongTermMemory.deleteMany({
      namespaceKey: joinNs([workspaceId, userId, agentId]),
    });
    return res.deletedCount ?? 0;
  }
}

export const mongoBaseStore = new MongoBaseStore();
export default mongoBaseStore;
