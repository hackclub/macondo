import { ref } from "vue";

type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

type Envelope = { topic?: string; event?: RealtimeEvent; type?: string; [k: string]: unknown };

type TopicHandler = (event: RealtimeEvent) => void;
type ReconnectHandler = () => void;

type Manager = {
  connected: ReturnType<typeof ref<boolean>>;
  subscribe: (topic: string, handler: TopicHandler) => () => void;
  send: (msg: unknown) => void;
  onReconnect: (handler: ReconnectHandler) => () => void;
  dispose: () => void;
};

let singleton: Manager | null = null;

function buildWsUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/_ws`;
}

function createManager(): Manager {
  const connected = ref(false);
  const handlersByTopic = new Map<string, Set<TopicHandler>>();
  const reconnectHandlers = new Set<ReconnectHandler>();
  const queued: string[] = [];

  let ws: WebSocket | null = null;
  let backoffMs = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let everConnected = false;

  function flushQueue(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (queued.length > 0) {
      const msg = queued.shift()!;
      try {
        ws.send(msg);
      } catch {
        queued.unshift(msg);
        return;
      }
    }
  }

  function rawSend(msg: unknown): void {
    const payload = typeof msg === "string" ? msg : JSON.stringify(msg);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
        return;
      } catch {
        // fall through to queue
      }
    }
    queued.push(payload);
  }

  function resubscribeAll(): void {
    for (const topic of handlersByTopic.keys()) {
      rawSend({ type: "subscribe", topic });
    }
  }

  function startPing(): void {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => rawSend({ type: "ping" }), 30_000);
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }

  function connect(): void {
    if (typeof window === "undefined") return;
    const url = buildWsUrl();
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      connected.value = true;
      backoffMs = 1000;
      flushQueue();
      resubscribeAll();
      startPing();
      if (everConnected) {
        for (const h of reconnectHandlers) {
          try { h(); } catch (err) { console.warn("[realtime] reconnect handler", err); }
        }
      }
      everConnected = true;
    });

    ws.addEventListener("message", (ev) => {
      let msg: Envelope;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg && typeof msg === "object" && msg.topic && msg.event) {
        const set = handlersByTopic.get(msg.topic);
        if (!set) return;
        for (const h of set) {
          try { h(msg.event); } catch (err) { console.warn("[realtime] handler", err); }
        }
      }
    });

    ws.addEventListener("close", () => {
      connected.value = false;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      ws = null;
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close handler will fire next; let it drive the reconnect
    });
  }

  function subscribe(topic: string, handler: TopicHandler): () => void {
    let set = handlersByTopic.get(topic);
    const isNewTopic = !set;
    if (!set) {
      set = new Set();
      handlersByTopic.set(topic, set);
    }
    set.add(handler);
    if (isNewTopic) {
      // Subscribes made before the socket opens are queued and flushed on open.
      ensureStarted();
      rawSend({ type: "subscribe", topic });
    }

    return () => {
      const cur = handlersByTopic.get(topic);
      if (!cur) return;
      cur.delete(handler);
      if (cur.size === 0) {
        handlersByTopic.delete(topic);
        rawSend({ type: "unsubscribe", topic });
      }
    };
  }

  function onReconnect(handler: ReconnectHandler): () => void {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  }

  function dispose(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (ws) {
      try {
        ws.close(1000, "client-dispose");
      } catch {
        // ignore: socket may already be closed
      }
      ws = null;
    }
    handlersByTopic.clear();
    reconnectHandlers.clear();
    queued.length = 0;
    // So a later subscribe() on a recycled singleton can reconnect.
    started = false;
  }

  // Connect lazily on first subscribe so routes without realtime never open a socket.
  let started = false;
  function ensureStarted() {
    if (started) return;
    started = true;
    if (typeof window === "undefined") return;
    setTimeout(connect, 0);
  }

  return {
    connected,
    subscribe,
    send: rawSend,
    onReconnect,
    dispose,
  };
}

// Close on unload so tabs don't leave orphaned half-open sockets on the server.
// Never on bfcache freeze (persisted): `started` would stay true and realtime would die.
if (typeof window !== "undefined") {
  let unloaded = false;
  function teardownOnUnload(persisted?: boolean) {
    if (unloaded) return;
    if (persisted === true) return;
    unloaded = true;
    if (singleton) {
      try {
        singleton.dispose();
      } catch {
        // best-effort: never throw from an unload handler
      }
    }
  }
  window.addEventListener("pagehide", (e: PageTransitionEvent) => teardownOnUnload(e.persisted), { capture: true });
  window.addEventListener("beforeunload", () => teardownOnUnload(false), { capture: true });
}

export function useRealtime(): Manager {
  if (typeof window === "undefined") {
    return {
      connected: ref(false),
      subscribe: () => () => {},
      send: () => {},
      onReconnect: () => () => {},
      dispose: () => {},
    };
  }
  if (!singleton) singleton = createManager();
  return singleton;
}
