"use client";

const WS_API_URL = "wss://ws-api.binance.com:443/ws-api/v3";
const DEFAULT_TIMEOUT_MS = 4_000;

export async function requestBinanceWebSocketApi<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const id = `orca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* ignore */ }
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`Binance WebSocket API ${method} timeout`))), timeoutMs);
    try {
      socket = new WebSocket(WS_API_URL);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    socket.onopen = () => {
      try {
        socket?.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    };
    socket.onmessage = (event) => {
      try {
        const response = JSON.parse(String(event.data)) as { id?: string; status?: number; result?: T; error?: { msg?: string } };
        if (response.id !== id) return;
        if (response.status !== 200) {
          finish(() => reject(new Error(response.error?.msg ?? `Binance WebSocket API ${method} error`)));
          return;
        }
        finish(() => resolve(response.result as T));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("Invalid Binance WebSocket API payload")));
      }
    };
    socket.onerror = () => finish(() => reject(new Error(`Binance WebSocket API ${method} network error`)));
    socket.onclose = () => {
      if (!settled) finish(() => reject(new Error(`Binance WebSocket API ${method} disconnected`)));
    };
  });
}
