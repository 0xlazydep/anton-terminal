/**
 * Reusable realtime HTTP server factory. Bridges an EventBus to dashboard
 * clients over Socket.IO (/trading) and SSE (/api/agent/stream).
 *
 * This is the embeddable core: the standalone `server.ts` calls it, and the
 * agent process can also call it directly to share a single in-memory bus
 * (so agent → bus → UI works in one process without Redis).
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { EventBus } from "./bus.js";
import {
  createTradingSocketServer,
  type ControlHandlers,
  type SnapshotProvider,
} from "./socket-server.js";
import { createReasoningSseBridge, SSE_KEEPALIVE } from "./sse.js";

export interface RealtimeServerOptions {
  port?: number;
  host?: string;
  corsOrigin?: string | string[];
  controls?: ControlHandlers;
  getSnapshot?: SnapshotProvider;
  busLabel?: string;
}

export interface RealtimeServerHandle {
  httpServer: HttpServer;
  close: () => void;
}

function applyCors(res: ServerResponse, origin: string | string[]): void {
  res.setHeader(
    "Access-Control-Allow-Origin",
    Array.isArray(origin) ? origin.join(",") : origin,
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
}

function handleSse(bus: EventBus, res: ServerResponse, origin: string | string[]): void {
  applyCors(res, origin);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(SSE_KEEPALIVE);

  const cleanup = createReasoningSseBridge(bus, (chunk) => {
    if (!res.writableEnded) res.write(chunk);
  });
  const onClose = (): void => {
    cleanup();
    res.end();
  };
  res.on("close", onClose);
  res.on("error", onClose);
}

/**
 * Start a realtime server bound to the given bus. Returns a handle with a
 * close() for graceful shutdown.
 */
export function createRealtimeServer(
  bus: EventBus,
  opts: RealtimeServerOptions = {},
): RealtimeServerHandle {
  const port = opts.port ?? 4000;
  const host = opts.host ?? "0.0.0.0";
  const corsOrigin = opts.corsOrigin ?? "*";
  const busLabel = opts.busLabel ?? "in-memory";

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (req.method === "OPTIONS") {
      applyCors(res, corsOrigin);
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === "/health" || url === "/") {
      applyCors(res, corsOrigin);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "anton-realtime", bus: busLabel }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/api/agent/stream")) {
      handleSse(bus, res, corsOrigin);
      return;
    }
    applyCors(res, corsOrigin);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  createTradingSocketServer({
    httpServer,
    bus,
    corsOrigin,
    controls: opts.controls,
    getSnapshot: opts.getSnapshot,
  });

  httpServer.listen(port, host);

  return {
    httpServer,
    close: () => httpServer.close(),
  };
}
