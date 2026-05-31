/** BullMQ queue definitions for the Anton trading pipeline. */

import { Queue, type QueueOptions, type JobsOptions, type ConnectionOptions } from "bullmq";
import { QUEUES } from "@anton/shared-types";
import type { QueueName, EnrichedCandidate, DecisionRecord } from "@anton/shared-types";

/** Job payload shapes per queue. */
export interface JobData {
  "anton:candidates": { candidate: EnrichedCandidate };
  "anton:screening": { mint: string; candidate: EnrichedCandidate };
  "anton:decision": { candidate?: EnrichedCandidate };
  "anton:execution": { decision: DecisionRecord };
  "anton:reflection": { positionId: string };
  "anton:monitor": { positionId: string; mint: string };
}

/**
 * Build a BullMQ connection from a redis URL. We hand BullMQ a connection
 * options object (not a pre-built client) so BullMQ owns its bundled ioredis
 * version, avoiding dual-version type clashes.
 */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

export interface QueueRegistry {
  candidates: Queue<JobData["anton:candidates"]>;
  screening: Queue<JobData["anton:screening"]>;
  decision: Queue<JobData["anton:decision"]>;
  execution: Queue<JobData["anton:execution"]>;
  reflection: Queue<JobData["anton:reflection"]>;
  monitor: Queue<JobData["anton:monitor"]>;
}

export function createQueues(connection: ConnectionOptions): QueueRegistry {
  const base: QueueOptions = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };
  return {
    candidates: new Queue(QUEUES.candidates, base),
    screening: new Queue(QUEUES.screening, base),
    decision: new Queue(QUEUES.decision, base),
    execution: new Queue(QUEUES.execution, base),
    reflection: new Queue(QUEUES.reflection, base),
    monitor: new Queue(QUEUES.monitor, base),
  };
}

/** Schedule the recurring decision cycle (default every 30s). */
export async function scheduleRecurringCycle(
  decision: Queue<JobData["anton:decision"]>,
  everyMs = 30_000,
): Promise<void> {
  await decision.add("cycle-tick", {}, { repeat: { every: everyMs }, jobId: "anton:cycle" });
}

export { QUEUES };
export type { QueueName, ConnectionOptions };
