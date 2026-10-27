// Authenticated by the macondo_session cookie at upgrade; the user is cached on peer.context.

import { isAllowedOrigin } from "../lib/first-party";
import { verifyInternalReauthCookie } from "../lib/internal-reauth";
import { getActiveMacondoBan } from "../lib/macondo-ban";
import { eq } from "drizzle-orm";

import db from "../db";
import { supportTicketTable } from "../db/schema";
import type { users } from "../db/schema";
import { canAccessInternalSupport } from "../policies/internal";
import { getSessionByToken } from "../lib/session";
import {
  heartbeatViewer,
  joinViewer,
  leaveViewer,
  publishTyping,
  type ViewerInfo,
} from "../lib/realtime-presence";
import {
  subscribePeer,
  unsubscribePeer,
  unsubscribePeerAll,
} from "../lib/realtime";

type AuthedUser = typeof users.$inferSelect;

function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

async function authenticate(headers: Headers | Record<string, string | string[] | undefined>): Promise<AuthedUser | null> {
  let cookieHeader: string | null = null;
  if (headers instanceof Headers) {
    cookieHeader = headers.get("cookie");
  } else {
    const raw = headers["cookie"] ?? headers["Cookie"];
    cookieHeader = Array.isArray(raw) ? raw.join("; ") : raw ?? null;
  }
  const token = parseCookie(cookieHeader, "macondo_session");
  if (!token) return null;

  // Reuses the shared session lookup (hashed-at-rest token matching, expiry
  // check, and the user join) instead of a second raw query.
  const user = await getSessionByToken(token);
  if (!user || await getActiveMacondoBan(user.id)) return null;
  return user;
}

type PeerCtx = {
  user?: AuthedUser;
  isAdmin?: boolean;
  joinedTickets?: Set<number>;
  authPromise?: Promise<void>;
  _opened?: boolean;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  closed?: boolean;
  realtimeTopics?: Set<string>;
};

function ctx(peer: { context: Record<string, unknown> }): PeerCtx {
  return peer.context as PeerCtx;
}

async function canSubscribe(user: AuthedUser, isAdmin: boolean, topic: string): Promise<boolean> {
  // Coarse change signals only; the data comes from REST endpoints that already gate access.
  if (topic === "explore") return true;

  if (topic === "tickets:queue:internal") return isAdmin;

  if (topic.startsWith("tickets:queue:user:")) {
    return topic.slice("tickets:queue:user:".length) === user.id || isAdmin;
  }

  if (topic.startsWith("ticket:") || topic.startsWith("presence:ticket:")) {
    const ticketId = Number(topic.startsWith("ticket:")
      ? topic.slice("ticket:".length)
      : topic.slice("presence:ticket:".length));
    if (!Number.isInteger(ticketId) || ticketId <= 0) return false;
    if (isAdmin) return true;
    const [t] = await db
      .select({ user_id: supportTicketTable.user_id })
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, ticketId))
      .limit(1);
    return t?.user_id === user.id;
  }

  return false;
}

function send(peer: { send: (data: string) => unknown }, payload: unknown): void {
  try {
    peer.send(JSON.stringify(payload));
  } catch {
    // peer is gone; ignore
  }
}

export default defineWebSocketHandler({
  upgrade(request) {
    // Cookies alone must not let a page on another origin open our socket.
    if (!isAllowedOrigin(request.headers.get("origin"))) {
      return new Response("Forbidden", { status: 403 });
    }
  },
  open(peer) {
    const c = ctx(peer);
    // HMR can re-fire open on the same peer during dev.
    if (c._opened) return;
    c._opened = true;

    // Stored so a `subscribe` sent right on open awaits auth instead of getting a spurious 401.
    c.authPromise = (async () => {
      const user = await authenticate(peer.request.headers);
      if (!user) {
        peer.close(4001, "unauthenticated");
        return;
      }
      if (c.closed) return;
      c.user = user;
      const reauth = verifyInternalReauthCookie(
        parseCookie(peer.request.headers.get("cookie"), "macondo_internal_reauth"),
        user.id,
      );
      c.isAdmin = canAccessInternalSupport(user) && reauth.verified;
      // Reconnects recheck session revocation/roles, and never outlive step-up.
      const lifetime = c.isAdmin && reauth.expiresAt ? Math.min(60_000, reauth.expiresAt - Date.now()) : 60_000;
      c.lifetimeTimer = setTimeout(() => peer.close(4001, "reauthenticate"), Math.max(1, lifetime));
      c.joinedTickets = new Set();
      send(peer, { type: "hello", userId: user.id, isAdmin: c.isAdmin });
    })().catch(() => { peer.close(1011, "authentication failed"); });
  },

  async message(peer, message) {
    const c = ctx(peer);
    if (c.authPromise) await c.authPromise;
    if (!c.user) {
      send(peer, { type: "error", message: "Not authenticated", code: 401 });
      return;
    }

    if (message.uint8Array().byteLength > 16 * 1024) {
      peer.close(1009, "message too large");
      return;
    }
    let parsed: { type?: string; [k: string]: unknown };
    try {
      parsed = JSON.parse(message.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid message");
    } catch {
      send(peer, { type: "error", message: "Invalid JSON" });
      return;
    }

    switch (parsed.type) {
      case "ping":
        send(peer, { type: "pong" });
        return;

      case "subscribe": {
        const topic = typeof parsed.topic === "string" ? parsed.topic : null;
        if (!topic) {
          send(peer, { type: "error", message: "Missing topic" });
          return;
        }
        if (!(await canSubscribe(c.user, c.isAdmin === true, topic))) {
          send(peer, { type: "error", message: "Forbidden topic", code: 403 });
          return;
        }
        if ((c.realtimeTopics?.size ?? 0) >= 64) {
          send(peer, { type: "error", message: "Too many subscriptions" });
          return;
        }
        subscribePeer(peer, topic);
        send(peer, { type: "subscribed", topic });
        return;
      }

      case "unsubscribe": {
        const topic = typeof parsed.topic === "string" ? parsed.topic : null;
        if (!topic) return;
        unsubscribePeer(peer, topic);
        return;
      }

      case "presence_join": {
        const ticketId = Number(parsed.ticketId);
        if (!Number.isInteger(ticketId) || ticketId <= 0) return;
        if (!(await canSubscribe(c.user, c.isAdmin === true, `ticket:${ticketId}`))) {
          send(peer, { type: "error", message: "Forbidden ticket", code: 403 });
          return;
        }
        if (c.joinedTickets!.size >= 32) return;
        c.joinedTickets!.add(ticketId);
        await joinViewer(ticketId, peer.id, {
          userId: c.user.id,
          name: c.user.name,
          image: c.user.image ?? null,
        } satisfies ViewerInfo);
        return;
      }

      case "presence_heartbeat": {
        const ticketId = Number(parsed.ticketId);
        if (!Number.isInteger(ticketId) || ticketId <= 0) return;
        if (!c.joinedTickets?.has(ticketId)) return;
        await heartbeatViewer(ticketId, peer.id);
        return;
      }

      case "presence_leave": {
        const ticketId = Number(parsed.ticketId);
        if (!Number.isInteger(ticketId) || ticketId <= 0) return;
        c.joinedTickets?.delete(ticketId);
        await leaveViewer(ticketId, peer.id);
        return;
      }

      case "typing": {
        const ticketId = Number(parsed.ticketId);
        const state = parsed.state === "start" ? "start" : parsed.state === "stop" ? "stop" : null;
        if (!Number.isInteger(ticketId) || ticketId <= 0 || !state) return;
        if (!c.joinedTickets?.has(ticketId)) {
          // Not joined: a buggy client mustn't leak typing across tickets.
          return;
        }
        await publishTyping(ticketId, c.user.id, state);
        return;
      }

      default:
        send(peer, { type: "error", message: `Unknown type: ${parsed.type}` });
        return;
    }
  },

  async close(peer) {
    const c = ctx(peer);
    c.closed = true;
    if (c.lifetimeTimer) clearTimeout(c.lifetimeTimer);
    if (c.joinedTickets && c.joinedTickets.size > 0) {
      // Fire-and-forget per ticket; the peer is already gone.
      for (const ticketId of c.joinedTickets) {
        void leaveViewer(ticketId, peer.id);
      }
      c.joinedTickets.clear();
    }
    unsubscribePeerAll(peer);
  },
});
