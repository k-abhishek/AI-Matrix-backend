import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  ChannelVersions,
  PendingWrite,
  writesSortKey,
} from '@langchain/langgraph-checkpoint';
import {
  LangGraphCheckpoint,
  LangGraphCheckpointWrite,
} from '../../models/LangGraphCheckpoint';

/**
 * Durable MongoDB-backed LangGraph checkpointer implementing BaseCheckpointSaver.
 * Stores within-thread graph state and sorted pending writes for interrupt/resume.
 */
export class MongoCheckpointSaver extends BaseCheckpointSaver {
  private encodeBytes(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  private decodeBytes(encoded: string): Uint8Array {
    return new Uint8Array(Buffer.from(encoded, 'base64'));
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    if (!threadId) return undefined;

    const query: Record<string, any> = { threadId, checkpointNs };
    if (checkpointId) {
      query.checkpointId = checkpointId;
    }

    const doc = await LangGraphCheckpoint.findOne(query)
      .sort({ checkpointId: -1 })
      .lean();

    if (!doc) return undefined;

    const record = doc as any;
    const checkpoint = await this.serde.loadsTyped('json', this.decodeBytes(record.checkpoint));
    const metadata = await this.serde.loadsTyped('json', this.decodeBytes(record.metadata));

    const writeDocs = await LangGraphCheckpointWrite.find({
      threadId,
      checkpointNs,
      checkpointId: record.checkpointId,
    }).lean();

    const sortedWrites = [...writeDocs].sort((a: any, b: any) => {
      const ka = writesSortKey(a.taskPath || '', a.taskId, a.idx);
      const kb = writesSortKey(b.taskPath || '', b.taskId, b.idx);
      if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
      return ka[2] - kb[2];
    });

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      sortedWrites.map(async (w: any) => {
        const val = await this.serde.loadsTyped(w.type, this.decodeBytes(w.value));
        return [w.taskId, w.channel, val] as CheckpointPendingWrite;
      })
    );

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: record.checkpointId,
        },
      },
      checkpoint: checkpoint as Checkpoint,
      metadata: metadata as CheckpointMetadata,
      parentConfig: record.parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: record.parentCheckpointId,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return;

    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;

    const query: Record<string, any> = { threadId, checkpointNs };
    if (beforeId) {
      query.checkpointId = { $lt: beforeId };
    }

    const docs = await LangGraphCheckpoint.find(query)
      .sort({ checkpointId: -1 })
      .limit(options?.limit ?? 20)
      .lean();

    for (const doc of docs) {
      const record = doc as any;
      const tuple = await this.getTuple({
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: record.checkpointId,
        },
      });
      if (tuple) yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    const workspaceId = config.configurable?.workspaceId as string | undefined;

    const [, serializedCheckpoint] = await this.serde.dumpsTyped(checkpoint);
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);

    await LangGraphCheckpoint.findOneAndUpdate(
      { threadId, checkpointNs, checkpointId: checkpoint.id },
      {
        $set: {
          threadId,
          checkpointNs,
          checkpointId: checkpoint.id,
          parentCheckpointId,
          workspaceId,
          checkpoint: this.encodeBytes(serializedCheckpoint),
          metadata: this.encodeBytes(serializedMetadata),
        },
      },
      { upsert: true }
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = ''
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId || !checkpointId || writes.length === 0) return;

    const docs = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, serialized] = await this.serde.dumpsTyped(value);
        return {
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          taskPath,
          idx,
          channel: String(channel),
          type,
          value: this.encodeBytes(serialized),
        };
      })
    );

    await LangGraphCheckpointWrite.insertMany(docs);
  }

  async deleteThread(threadId: string): Promise<void> {
    await Promise.all([
      LangGraphCheckpoint.deleteMany({ threadId }),
      LangGraphCheckpointWrite.deleteMany({ threadId }),
    ]);
  }
}

export const mongoCheckpointSaver = new MongoCheckpointSaver();
export default mongoCheckpointSaver;
