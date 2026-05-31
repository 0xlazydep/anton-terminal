/** Redis Pub/Sub event bus for intra-service communication. */

import { Redis } from "ioredis";
import { CHANNELS } from "@anton/shared-types";
import type { ChannelName } from "@anton/shared-types";

export interface EventBus {
  publish<T>(channel: ChannelName, payload: T): Promise<void>;
  subscribe<T>(channel: ChannelName, handler: (payload: T) => void): Promise<void>;
  close(): Promise<void>;
}

/**
 * Redis-backed event bus. Uses separate pub/sub connections (ioredis requires
 * a dedicated connection in subscriber mode).
 */
export class RedisEventBus implements EventBus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
    this.sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
    this.sub.on("message", (channel, message) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      for (const h of set) h(parsed);
    });
  }

  async publish<T>(channel: ChannelName, payload: T): Promise<void> {
    if (this.pub.status === "wait") await this.pub.connect();
    await this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T>(channel: ChannelName, handler: (payload: T) => void): Promise<void> {
    if (this.sub.status === "wait") await this.sub.connect();
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(handler as (payload: unknown) => void);
  }

  async close(): Promise<void> {
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

/** In-memory bus for tests / single-process dev (no Redis required). */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  async publish<T>(channel: ChannelName, payload: T): Promise<void> {
    const set = this.handlers.get(channel);
    if (!set) return;
    for (const h of set) h(payload);
  }

  async subscribe<T>(channel: ChannelName, handler: (payload: T) => void): Promise<void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler as (payload: unknown) => void);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

export { CHANNELS };
