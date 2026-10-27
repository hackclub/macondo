import type { users } from "../db/schema";
import { writeAudit } from "./audit";
import { reviewDm } from "./review-slack-bot";

const SELF_REVIEW_ALERT_ROLES = [
  "admin",
  "fraudster",
  "software_reviewer",
  "hardware_reviewer",
  "hq",
];

const ALERT_RECIPIENT_SLACK_IDS = ["U08PD2ZB3DL", "U05EZRFKRV4"];

type Source = "internal_projects" | "internal_review";

type Actor = typeof users.$inferSelect;

export async function notifySelfProjectAccess(args: {
  actor: Actor;
  projectId: number;
  projectName: string;
  projectUserId: string | null;
  source: Source;
  blocked?: boolean;
}): Promise<void> {
  const { actor, projectId, projectName, projectUserId, source } = args;

  if (!projectUserId || actor.id !== projectUserId) return;
  if ((actor.roles ?? []).includes("supaadmin")) return;

  const matchingRoles = (actor.roles ?? []).filter((r) =>
    SELF_REVIEW_ALERT_ROLES.includes(r),
  );
  if (matchingRoles.length === 0) return;

  const actorLabel = actor.name ?? actor.email ?? actor.id;
  const rolesLabel = matchingRoles.join(", ");
  const timestamp = new Date().toISOString();
  const verb = args.blocked ? "tried to open" : "opened";

  try {
    await writeAudit({
      actor_id: actor.id,
      action: args.blocked ? "attempt_view_own_project" : "view_own_project",
      entity_type: "project",
      entity_id: String(projectId),
      sensitive: true,
      public_message: `${actorLabel} (roles: ${rolesLabel}) ${verb} their own project "${projectName}" via ${source}`,
      change_summary: source,
    });
  } catch (error) {
    console.error("[self-project-access-alert] audit write failed", error);
  }

  const text = [
    ":rotating_light: *Self-review alert*",
    "",
    `*${actorLabel}* (roles: ${rolesLabel}) just ${verb} their own project.`,
    "",
    `*Project:* ${projectName} (#${projectId})`,
    `*Page:* ${source}`,
    `*Time:* ${timestamp}`,
  ].join("\n");

  (
    await Promise.allSettled(
      ALERT_RECIPIENT_SLACK_IDS.map((slackId) => reviewDm({ user: slackId, text })),
    )
  ).forEach((result, idx) => {
    const recipient = ALERT_RECIPIENT_SLACK_IDS[idx];
    if (result.status === "rejected") {
      console.warn(
        `[self-project-access-alert] dm to ${recipient} threw: ${String(result.reason)}`,
      );
    } else if (!result.value.ok) {
      console.warn(
        `[self-project-access-alert] dm to ${recipient} failed: ${result.value.error}`,
      );
    }
  });
}

export async function notifySelfProfileAccess(args: {
  actor: Actor;
}): Promise<void> {
  const { actor } = args;

  const matchingRoles = (actor.roles ?? []).filter((r) =>
    SELF_REVIEW_ALERT_ROLES.includes(r),
  );
  if (matchingRoles.length === 0) return;

  const text = [
    ":rotating_light: *Self-profile access alert*",
    "",
    `*${actor.name ?? actor.email ?? actor.id}* (roles: ${matchingRoles.join(", ")}) just tried to open their own internal profile.`,
    "",
    `*User ID:* ${actor.id}`,
    `*Page:* internal_user_profile`,
    `*Time:* ${new Date().toISOString()}`,
  ].join("\n");

  (
    await Promise.allSettled(
      ALERT_RECIPIENT_SLACK_IDS.map((slackId) => reviewDm({ user: slackId, text })),
    )
  ).forEach((result, idx) => {
    const recipient = ALERT_RECIPIENT_SLACK_IDS[idx];
    if (result.status === "rejected") {
      console.warn(
        `[self-profile-access-alert] dm to ${recipient} threw: ${String(result.reason)}`,
      );
    } else if (!result.value.ok) {
      console.warn(
        `[self-profile-access-alert] dm to ${recipient} failed: ${result.value.error}`,
      );
    }
  });
}
