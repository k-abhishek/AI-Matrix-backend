export class GraphCacheService {
  private cache = new Map<string, any>();
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  buildKey(agentVersionId: string, configHash: string, toolSetHash: string): string {
    return `${agentVersionId}:${configHash}:${toolSetHash}`;
  }

  get(key: string): any | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    // Refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit;
  }

  set(key: string, compiledGraph: any): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, compiledGraph);
  }

  invalidateByVersion(agentVersionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${agentVersionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const graphCacheService = new GraphCacheService();
export default graphCacheService;
