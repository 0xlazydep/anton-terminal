/** Generic worker factory wrapping BullMQ Worker with sane defaults. */

import { Worker, type Processor, type WorkerOptions, type ConnectionOptions } from "bullmq";
import type { QueueName } from "@anton/shared-types";

export interface CreateWorkerOpts {
  connection: ConnectionOptions;
  concurrency?: number;
}

export function createWorker<T = unknown, R = unknown>(
  queueName: QueueName,
  processor: Processor<T, R>,
  opts: CreateWorkerOpts,
): Worker<T, R> {
  const workerOpts: WorkerOptions = {
    connection: opts.connection,
    concurrency: opts.concurrency ?? 8,
  };
  return new Worker<T, R>(queueName, processor, workerOpts);
}
