import { formatSize } from './utils.js';

export interface AgentCLIExecutionPolicy {
  maxMaterializedBytes?: number;
}

export type ResolvedAgentCLIExecutionPolicy = Readonly<AgentCLIExecutionPolicy>;

export interface MaterializedByteLimit {
  limit: number;
  actual: number;
}

const EMPTY_EXECUTION_POLICY: ResolvedAgentCLIExecutionPolicy = Object.freeze({});

export function resolveExecutionPolicy(policy?: AgentCLIExecutionPolicy): ResolvedAgentCLIExecutionPolicy {
  if (!policy) {
    return EMPTY_EXECUTION_POLICY;
  }

  const resolved: AgentCLIExecutionPolicy = {};
  validateLimit('executionPolicy.maxMaterializedBytes', policy.maxMaterializedBytes);

  if (policy.maxMaterializedBytes !== undefined) {
    resolved.maxMaterializedBytes = policy.maxMaterializedBytes;
  }

  return Object.freeze(resolved);
}

export function checkMaterializedByteLimit(
  policy: ResolvedAgentCLIExecutionPolicy,
  actual: number,
): MaterializedByteLimit | null {
  const limit = policy.maxMaterializedBytes;
  if (limit === undefined || actual <= limit) {
    return null;
  }

  return { limit, actual };
}

export function formatMaterializedLimitMessage(
  commandName: string,
  subject: string,
  actual: number,
  limit: number,
): string {
  return `${commandName}: input exceeds max materialized size (${formatSize(actual)} > ${formatSize(limit)}): ${subject}`;
}

function validateLimit(label: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}
