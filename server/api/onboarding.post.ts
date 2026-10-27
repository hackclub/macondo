import { eq } from "drizzle-orm";
import db from "../db";
import { users } from "../db/schema";
import { getSession } from "~~/server/lib/session";
import { writeAudit } from "../lib/audit";
import { syncLoopsEvent } from "../lib/loops";

const VALID_STEPS = ["story-part1", "story-part2a", "experience", "story-part2b", "ask-project", "tutorial", "github", "skip-tutorial", "story-part3", "complete"] as const;

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const { step, data } = await readBody(event);

  if (step && !VALID_STEPS.includes(step)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid onboarding step" });
  }

  const updates: Record<string, unknown> = {};
  if (step) updates.onboarding_step = step;
  if (data !== undefined) updates.onboarding_data = JSON.stringify(data);

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, user.id));

    try {
      await writeAudit({
        actor_id: user.id,
        action: "update_onboarding",
        entity_type: "user",
        entity_id: user.id,
        old_value: null,
        new_value: updates,
        sensitive: false,
        public_message: `Onboarding progress updated`,
      });
    } catch (e) {
      console.error("Failed to write audit log for onboarding update", e);
    }

    // Guard on the previous step so a re-POST doesn't re-fire the Loops event.
    if (step === "complete" && user.onboarding_step !== "complete") {
      try {
        await syncLoopsEvent({
          email: user.email,
          user_id: user.id,
          slack_id: user.slack_id ?? null,
          event: "macondoOnboardingCompleted",
        });
      } catch (e) {
        console.error("Failed to sync onboarding-completed Loops event", e);
      }
    }
  }

  return { ok: true, step: step || user.onboarding_step };
});
