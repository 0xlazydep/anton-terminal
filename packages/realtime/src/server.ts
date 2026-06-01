/**
 * Anton Terminal — standalone realtime server.
 *
 * One process that bridges the agent's event bus to the dashboard:
 *   - Socket.IO  on  /trading              (positions, screening, wallets, status)
 *   - SSE        on  GET /api/agent/stream  (reasoning steps + entry decisions)
 *   - GET /health                           (liveness probe)
 *
 * Bus selection:
 *   - REDIS_URL set      → RedisEventBus (real pipeline publishes events)
 *   - REDIS_URL empty    → InMemoryEventBus + built-in mock producer
 *
 * The mock producer lets the WHOLE stack run with zero infrastructure
 * (no Docker / Redis / Postgres) while still exercising the real
 * server → Socket.IO/SSE → UI path end-to-end.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  InMemoryEventBus,
  RedisEventBus,
  type EventBus,
} from "./bus.js";
import { createTradingSocketServer } from "./socket-server.js";
import { createReasoningSseBridge, SSE_KEEPALIVE } from "./sse.js";
import { startMockProducer } from "./mock-producer.js";

const PORT = Number(process.env.REALTIME_PORT ?? 4000);
const HOST = process.env.REALTIME_HOST ?? "0.0.0.0";
const REDIS_URL = process.env.REDIS_URL?.trim() ?? "";
const CORS_ORIGIN = process.env.REALTIME_CORS_ORIGIN ?? "*";

function log(msg: string): void {
  process.stdout.write(`[realtime] ${msg}\n`);
}

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
}

function handleSse(
  bus: EventBus,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  applyCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Open the stream with a keepalive so proxies flush headers immediately.
  res.write(SSE_KEEPALIVE);

  const cleanup = createReasoningSseBridge(bus, (chunk) => {
    // res may already be closed if the client disconnected mid-frame.
    if (!res.writableEnded) res.write(chunk);
  });

  const onClose = (): void => {
    cleanup();
    res.end();
  };
  res.on("close", onClose);
  res.on("error", onClose);
}

async function main(): Promise<void> {
  const useRedis = REDIS_URL.length > 0;
  const bus: EventBus = useRedis
    ? new RedisEventBus(REDIS_URL)
    : new InMemoryEventBus();

  const httpServer = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "OPTIONS") {
      applyCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === "/health" || url === "/") {
      applyCors(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "anton-realtime",
          bus: useRedis ? "redis" : "in-memory",
          mock: !useRedis,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.startsWith("/api/agent/stream")) {
      handleSse(bus, req, res);
      return;
    }

    applyCors(res);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  // Socket.IO server on the /trading namespace. Control events are logged
  // (real handlers attach when the agent pipeline is wired in).
  createTradingSocketServer({
    httpServer,
    bus,
    corsOrigin: CORS_ORIGIN,
    controls: {
      onSetMode: (e) => log(`control set_mode → ${e.mode}`),
      onSetSpendLimits: (e) => log(`control set_spend_limits → ${e.minSol}..${e.maxSol} SOL`),
      onSetRiskConfig: (e) => log(`control set_risk_config → concurrent:${e.maxConcurrent} cap:${e.dailyLossCapSol} sl:${e.defaultStopLossPct}% tp:${e.defaultTakeProfitPct}%`),
      onManualEntry: (e) => log(`control manual_entry → ${e.mint} ${e.sizeSol} SOL`),
      onEmergencyStop: () => log("control emergency_stop"),
    },
  });

  let stopProducer: (() => void) | undefined;
  if (!useRedis) {
    stopProducer = startMockProducer(bus);
    log("mock producer started (no REDIS_URL) — synthetic event stream live");
  }

  httpServer.listen(PORT, HOST, () => {
    log(`listening on http://${HOST}:${PORT}`);
    log(`  socket.io  → ws://${HOST}:${PORT}/trading`);
    log(`  sse        → http://${HOST}:${PORT}/api/agent/stream`);
    log(`  bus        → ${useRedis ? "redis" : "in-memory"}`);
  });

  const shutdown = (signal: string): void => {
    log(`${signal} received, shutting down`);
    stopProducer?.();
    httpServer.close();
    void bus.close();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`[realtime] fatal: ${String(err)}\n`);
  process.exit(1);
});
