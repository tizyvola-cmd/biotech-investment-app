import { useCallback, useEffect, useRef, useState } from "react";

interface WebSocketMessage {
  type: string;
  data: unknown;
}

interface UseWebSocketOptions {
  /** WebSocket URL (default: ws://127.0.0.1:8765/ws/quotes) */
  url?: string;
  /** Reconnect interval in ms (default: 5000) */
  reconnectInterval?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
}

interface UseWebSocketResult {
  /** WebSocket connection status */
  status: "connecting" | "connected" | "disconnected" | "error";
  /** Send message to WebSocket server */
  send: (message: unknown) => void;
  /** Subscribe to ticker updates */
  subscribe: (tickers: string[]) => void;
  /** Unsubscribe from ticker updates */
  unsubscribe: (tickers: string[]) => void;
  /** Last received message */
  lastMessage: WebSocketMessage | null;
}

/**
 * Hook for WebSocket connection to real-time quote updates.
 *
 * Not used in production sheets while SHEET_WS_REALTIME_ENABLED is false
 * (FASE 1 Step 4 — see RealTimeSheetUpdater.tsx). Backend /ws/quotes is echo-only today.
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  const {
    url = "ws://127.0.0.1:8765/ws/quotes",
    reconnectInterval = 5000,
    autoReconnect = true,
  } = options;

  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedTickersRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        // Re-subscribe to tickers after reconnection
        if (subscribedTickersRef.current.size > 0) {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              tickers: Array.from(subscribedTickersRef.current),
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus("disconnected");
        if (autoReconnect) {
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };
    } catch (error) {
      console.error("WebSocket connection error:", error);
      setStatus("error");
    }
  }, [url, autoReconnect, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected, cannot send message");
    }
  }, []);

  const subscribe = useCallback((tickers: string[]) => {
    subscribedTickersRef.current = new Set(tickers);
    send({ type: "subscribe", tickers });
  }, [send]);

  const unsubscribe = useCallback((tickers: string[]) => {
    tickers.forEach((ticker) => {
      subscribedTickersRef.current.delete(ticker);
    });
    send({ type: "unsubscribe", tickers });
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    send,
    subscribe,
    unsubscribe,
    lastMessage,
  };
}
