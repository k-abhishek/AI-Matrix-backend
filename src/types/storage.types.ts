export interface StorageBudgetStatus {
  totalBudgetBytes: number;
  stopThresholdPercent: number;
  stopThresholdBytes: number;
  currentUsageBytes: number;
  usagePercentage: number;
  usageSource: 'ESTIMATED' | 'QDRANT_REPORTED';
  isThresholdReached: boolean;
  availableBytes: number;
}

