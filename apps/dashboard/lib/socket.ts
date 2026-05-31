"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const url =
    process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";
  socket = io(`${url}/trading`, {
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
