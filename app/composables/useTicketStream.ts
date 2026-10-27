// Dedup by client_dedup_key is the page's job, since it owns the optimistic submit state.

import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRealtime } from "./useRealtime";

export type ViewerInfo = {
  userId: string;
  name: string;
  image: string | null;
};

type TicketMessageRow = {
  id: number;
  body: string;
  author_user_id: string | null;
  author_kind?: string;
  is_internal_note: boolean;
  created_at: string | Date;
  author_name: string | null;
  author_image: string | null;
  client_dedup_key?: string | null;
  slack_ts?: string | null;
};

type AttachmentRow = {
  id: number;
  message_id: number;
  url: string;
  filename: string;
  size_bytes: number | null;
  mime_type: string | null;
  sha: string | null;
};

type CursorResponse = {
  messages: TicketMessageRow[];
  attachments: AttachmentRow[];
};

type MessageEditedPatch = {
  id: number;
  body: string;
  edited_at: string | Date | null;
  deleted_at: string | Date | null;
  original_body: string | null;
};

type StreamOptions = {
  scope: "internal" | "student";
  presence?: boolean;
  getLastSeenMessageId: () => number | null;
  onMessage: (msg: TicketMessageRow, attachments: AttachmentRow[]) => void;
  // Deletes set deleted_at but keep the body so reviewers can still read it.
  onMessageEdited?: (patch: MessageEditedPatch) => void;
  onMessageDeleted?: (messageId: number) => void;
  onStatusChange?: (event: {
    status: string;
    claimed_by_user_id?: string | null;
    resolved_by_user_id?: string | null;
    [key: string]: unknown;
  }) => void;
  onTicketUpdate?: (patch: Record<string, unknown>) => void;
};

export function useTicketStream(ticketId: number, opts: StreamOptions) {
  const rt = useRealtime();
  const viewers = ref<ViewerInfo[]>([]);
  const typingUsers = ref<{ userId: string; name: string }[]>([]);
  const connected = rt.connected;

  const ticketTopic = `ticket:${ticketId}`;
  const presenceTopicName = `presence:ticket:${ticketId}`;
  const usePresence = opts.presence !== false;

  const cursorPath =
    opts.scope === "internal"
      ? `/api/internal/support/tickets/${ticketId}/messages`
      : `/api/support/tickets/${ticketId}/messages`;

  // Silence clears the typing chip even if the explicit stop never arrives.
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTypingTimer(userId: string): void {
    const t = typingTimers.get(userId);
    if (t) {
      clearTimeout(t);
      typingTimers.delete(userId);
    }
  }

  function setTypingFor(userId: string, name: string): void {
    if (!typingUsers.value.some((u) => u.userId === userId)) {
      typingUsers.value = [...typingUsers.value, { userId, name }];
    }
    clearTypingTimer(userId);
    typingTimers.set(
      userId,
      setTimeout(() => removeTyping(userId), 6_000), // typing chip goes stale after 6s
    );
  }

  function removeTyping(userId: string): void {
    typingUsers.value = typingUsers.value.filter((u) => u.userId !== userId);
    clearTypingTimer(userId);
  }

  let lastDrainAt = 0;
  async function drainCursor(): Promise<void> {
    // Live events already deliver messages; the drain only fills reconnect gaps.
    if (Date.now() - lastDrainAt < 30_000) return; // 30s floor so a flapping socket doesn't hammer the endpoint
    const since = opts.getLastSeenMessageId();
    try {
      const res = await $fetch<CursorResponse>(cursorPath, {
        params: since ? { since } : undefined,
      });
      // Stamp only on success so a failed drain doesn't block recovery.
      lastDrainAt = Date.now();
      const byMessage = new Map<number, AttachmentRow[]>();
      for (const a of res.attachments) {
        const arr = byMessage.get(a.message_id) ?? [];
        arr.push(a);
        byMessage.set(a.message_id, arr);
      }
      for (const m of res.messages) {
        opts.onMessage(m, byMessage.get(m.id) ?? []);
      }
    } catch (err) {
      console.warn("[ticket-stream] cursor drain failed", err);
    }
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubTicket: (() => void) | null = null;
  let unsubPresence: (() => void) | null = null;
  let offReconnect: (() => void) | null = null;

  function handleTicketEvent(event: { type: string; [k: string]: unknown }): void {
    if (event.type === "message_added") {
      const msg = event.message as TicketMessageRow | undefined;
      const attachments = (event.attachments as AttachmentRow[] | undefined) ?? [];
      if (msg) opts.onMessage(msg, attachments);
      return;
    }
    if (event.type === "status_changed") {
      opts.onStatusChange?.({
        status: String(event.status ?? ""),
        claimed_by_user_id: (event.claimed_by_user_id as string | null | undefined) ?? null,
        resolved_by_user_id: (event.resolved_by_user_id as string | null | undefined) ?? null,
        ...event,
      });
      return;
    }
    if (event.type === "ticket_updated") {
      opts.onTicketUpdate?.((event.patch as Record<string, unknown>) ?? {});
      return;
    }
    if (event.type === "message_edited") {
      const patch = event.message as MessageEditedPatch | undefined;
      if (patch && typeof patch.id === "number") opts.onMessageEdited?.(patch);
      return;
    }
    if (event.type === "message_deleted") {
      const id = event.messageId;
      if (typeof id === "number") opts.onMessageDeleted?.(id);
      return;
    }
  }

  function handlePresenceEvent(event: { type: string; [k: string]: unknown }): void {
    if (event.type === "viewing") {
      viewers.value = Array.isArray(event.viewers) ? (event.viewers as ViewerInfo[]) : [];
      return;
    }
    if (event.type === "typing") {
      const userId = String(event.userId ?? "");
      if (!userId) return;
      if (event.state === "start") {
        setTypingFor(userId, viewers.value.find((v) => v.userId === userId)?.name ?? "Someone");
      } else {
        removeTyping(userId);
      }
    }
  }

  function emitTyping(state: "start" | "stop"): void {
    if (!usePresence) return;
    rt.send({ type: "typing", ticketId, state });
  }

  onMounted(() => {
    unsubTicket = rt.subscribe(ticketTopic, handleTicketEvent);
    if (usePresence) {
      unsubPresence = rt.subscribe(presenceTopicName, handlePresenceEvent);
      rt.send({ type: "presence_join", ticketId });
      heartbeat = setInterval(() => {
        rt.send({ type: "presence_heartbeat", ticketId });
      }, 15_000); // presence heartbeat interval
    }
    offReconnect = rt.onReconnect(() => {
      void drainCursor();
      if (usePresence) rt.send({ type: "presence_join", ticketId });
    });
  });

  onBeforeUnmount(() => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (usePresence) rt.send({ type: "presence_leave", ticketId });
    unsubTicket?.();
    unsubPresence?.();
    offReconnect?.();
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
  });

  return {
    viewers,
    typingUsers,
    connected,
    emitTyping,
    refreshFromCursor: drainCursor,
  };
}
