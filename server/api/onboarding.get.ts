import { getSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  let onboardingData = null;
  try {
    if (user.onboarding_data) {
      onboardingData = JSON.parse(user.onboarding_data);
    }
  } catch { /* invalid JSON, treat as null */ }

  return {
    step: user.onboarding_step || "welcome",
    data: onboardingData,
    isTemp: user.is_temp,
    hasHca: !!user.sub,
    hasSlack: !!user.slack_id,
  };
});
