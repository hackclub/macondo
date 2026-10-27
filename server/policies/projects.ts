import { and, eq, lt, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import db from "../db";
import { dailyProjectActivityTable, journalsTable, piiLockerTable, projectCollaboratorTable } from "../db/schema";
import type { projectTable, users } from "../db/schema";
import { ageOutUtcDay, computeAgeYears, SHIP_MAX_AGE_EXCLUSIVE } from "../lib/age";
import { getProjectGrantHistory } from "../lib/grants";
import { getAuthenticatedProjects } from "../lib/hackatime";
import { syncHcaIdentity } from "../lib/hca";
import {
  safeBufferRequest,
  safeRequest,
  validateOutboundUrl,
} from "../lib/outbound-url";
import { validatePlayableUrl } from "../lib/playable-url";
import { isKnownGuide } from "~/data/guidePrefills";

// Re-exported for existing importers of these from this module.
export { safeBufferRequest, safeRequest, validateOutboundUrl };

export type ProjectShipPolicyReason = {
  code: string;
  message: string;
};

export type ProjectShipPolicyResponse = {
  ok: boolean;
  reasons: ProjectShipPolicyReason[];
};

type ProjectShipPolicyProject = Pick<
  InferSelectModel<typeof projectTable>,
  | "id"
  | "type"
  | "next_ship_needs_funding"
  | "next_ship_is_build_complete"
  | "demo_url"
  | "description"
  | "repository_url"
  | "cart_screenshots"
  | "build_cost_cents"
  | "guide"
  | "hackatime_projects"
>;

type ProjectShipPolicyOptions = {
  hackatimeOAuthToken?: string | null;
  // Only the submit gate probes the network, so creation and field saves stay cheap.
  probePlayableUrl?: boolean;
};

// Reports exact minutes so sub-hour totals don't turn into support tickets.
export function formatInsufficientHoursMessage(loggedHours: number): string {
  if (loggedHours <= 0) {
    return "Log at least 1 hour of real work in Hackatime or journals before submitting for review.";
  }
  const minutes = Math.round(loggedHours * 60);
  if (minutes < 60) {
    return `You've logged ${minutes} minute${minutes === 1 ? "" : "s"} on this project. You need at least 1 hour before submitting for review.`;
  }
  // only reachable with odd negative journal balances
  return "Log at least 1 hour of real work in Hackatime or journals before submitting for review.";
}

// "pending" deliberately doesn't block: those users already submitted and await an HCA reviewer.
const HCA_SHIP_BLOCKED_STATUS_ACTIONS: Record<string, string> = {
  needs_submission: "submit your identity verification documents",
  document_required: "upload your ID document",
  basic_info_required: "finish your basic info",
};

export async function getLockerBirthdayByUserId(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ birthday: piiLockerTable.birthday })
    .from(piiLockerTable)
    .where(eq(piiLockerTable.user_id, userId))
    .limit(1);
  return row?.birthday ?? null;
}

export type PreAgeOutProjectHours = {
  hackatimeHours: number;
  journalHours: number;
  totalHours: number;
};

// The daily rollup is the only per-day Hackatime source, so it's authoritative despite slight lag.
export async function getPreAgeOutProjectHours(
  userId: string,
  projectId: number,
  ageOutDay: string,
): Promise<PreAgeOutProjectHours> {
  const [row] = await db
    .select({
      hackatime: sql<number>`coalesce(sum(${dailyProjectActivityTable.hackatime_seconds}), 0)::float8`,
      journal: sql<number>`coalesce(sum(${dailyProjectActivityTable.journal_seconds}), 0)::float8`,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        eq(dailyProjectActivityTable.project_id, projectId),
        // YYYY-MM-DD varchar, so lexicographic < is date <
        lt(dailyProjectActivityTable.day, ageOutDay),
      ),
    );
  const hackatimeHours = (row?.hackatime ?? 0) / 3600; // seconds to hours
  const journalHours = (row?.journal ?? 0) / 3600; // seconds to hours
  return { hackatimeHours, journalHours, totalHours: hackatimeHours + journalHours };
}

// Reviewer-facing note on capped hours; null unless aged out, so callers can pass it straight through.
export async function getAgedOutJustification(
  userId: string,
  projectId: number,
): Promise<string | null> {
  const birthday = await getLockerBirthdayByUserId(userId);
  const ageOutDay = ageOutUtcDay(birthday);
  if (!ageOutDay || ageOutDay > new Date().toISOString().slice(0, 10)) {
    return null;
  }
  const pre = await getPreAgeOutProjectHours(userId, projectId, ageOutDay);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return (
    `Maker is ${computeAgeYears(birthday) ?? "19+"} (over 18): they aged out during this project, so only ` +
    `time tracked before their 19th birthday (${ageOutDay}) is credited and the ` +
    `submitted Hackatime hours are capped to it. Pre-age-out tracked work: ` +
    `${r2(pre.hackatimeHours)}h Hackatime + ${r2(pre.journalHours)}h journals.`
  );
}

export async function canShipProject(
  user: InferSelectModel<typeof users>,
  project: ProjectShipPolicyProject,
  options: ProjectShipPolicyOptions = {},
): Promise<ProjectShipPolicyResponse> {
  const reasons: ProjectShipPolicyReason[] = [];
  const hackatimeOAuthToken =
    options.hackatimeOAuthToken ?? user.hackatime_oauth_token;

  // ysws_eligible has been null on past offenders, so the birthday is checked locally too.
  // Aged-out makers may ship with 1h+ of pre-19 work; only that work is credited.
  // A suspect snapshot triggers an HCA re-sync so reverified users needn't sign in again.
  let lockerBirthday = await getLockerBirthdayByUserId(user.id);
  let userAge = computeAgeYears(lockerBirthday ?? null);
  let verificationStatus = user.hca_verification_status ?? null;
  let yswsEligible = user.hca_ysws_eligible ?? null;
  const ageWouldFail = userAge !== null && userAge >= SHIP_MAX_AGE_EXCLUSIVE;
  if (user.hca_verification_status !== "verified" || ageWouldFail || yswsEligible === false) {
    const synced = await syncHcaIdentity(user.id, {
      // short enough for a reverified user's retry, long enough to spare HCA's rate limit
      cooldownMs: 5 * 60 * 1000, // 5 minutes
    }).catch((e) => {
      console.error("[canShipProject] syncHcaIdentity failed", user.id, e);
      return null;
    });
    if (synced) {
      // syncHcaIdentity may have just updated pii_locker.
      lockerBirthday = await getLockerBirthdayByUserId(user.id);
      userAge = computeAgeYears(lockerBirthday ?? null);
      verificationStatus = synced.hca_verification_status ?? null;
      yswsEligible = synced.hca_ysws_eligible ?? null;
    }
  }

  const overAge = userAge !== null && userAge >= SHIP_MAX_AGE_EXCLUSIVE;
  let agedOutWithEligibleWork = false;
  if (overAge && project.id > 0) {
    const ageOutDay = ageOutUtcDay(lockerBirthday ?? null);
    if (ageOutDay) {
      agedOutWithEligibleWork =
        (await getPreAgeOutProjectHours(user.id, project.id, ageOutDay)).totalHours >= 1;
    }
  }
  if ((overAge || yswsEligible === false) && !agedOutWithEligibleWork) {
    if (overAge) {
      reasons.push({
        code: "age_ineligible",
        message: `Macondo is for students under ${SHIP_MAX_AGE_EXCLUSIVE}. Per the birthday on your Hack Club Auth profile you're ${userAge}, and this project has no logged work from before you turned ${SHIP_MAX_AGE_EXCLUSIVE}, so you can't ship it. If that birthday is wrong, update your DOB at auth.hackclub.com and sign back in.`,
      });
    } else {
      reasons.push({
        code: "ysws_ineligible",
        message: "Hack Club Auth reports your account isn't eligible for YSWS programs, so you can't ship on Macondo. If you think that's wrong, check your details at auth.hackclub.com, then sign back in and try again.",
      });
    }
    // Skip network probes and unactionable demo-URL errors for a rejected user.
    return { ok: false, reasons };
  }

  const verificationAction = verificationStatus
    ? HCA_SHIP_BLOCKED_STATUS_ACTIONS[verificationStatus]
    : undefined;
  if (verificationAction) {
    reasons.push({
      code: "identity_verification_required",
      message: `Your identity isn't verified on Hack Club Auth yet, so you can't ship. Go to auth.hackclub.com to ${verificationAction}, then try again once you're verified.`,
    });
    return { ok: false, reasons };
  }

  // Hardware design and in-progress ships have no build to demo yet.
  // Must mirror demoUrlRequired in app/pages/projects/[id].vue.
  const projectIsHardware = project.type === "hardware";
  const grantHistory = projectIsHardware
    ? await getProjectGrantHistory(project.id)
    : null;
  const projectHasReceivedFunding =
    projectIsHardware && grantHistory?.latestActiveGrant != null;
  const isBuildCompleteShip =
    projectIsHardware && project.next_ship_is_build_complete === true;
  const demoUrlRequired =
    !projectIsHardware || isBuildCompleteShip || projectHasReceivedFunding;

  if (project.demo_url == null) {
    if (demoUrlRequired) {
      reasons.push({ code: "missing_demo", message: "Please add a demo URL so people can try your project." });
    }
  } else {
    // Warn-severity verdicts surface as nudges and reviewer chips, not blocks.
    const demoVerdict = await validatePlayableUrl(project.demo_url, {
      projectType: projectIsHardware ? "hardware" : "software",
      hardwareBuildProofRequired: projectIsHardware && demoUrlRequired,
      repositoryUrl: project.repository_url,
      skipNetwork: options.probePlayableUrl !== true,
    });
    if (demoVerdict && demoVerdict.severity === "block") {
      reasons.push({ code: demoVerdict.code, message: demoVerdict.message });
    }
  }

  if (project.description == null) {
    reasons.push({
      code: "missing_description",
      message: "Please add a short description so people understand what your project does.",
    });
  } else {
    if (project.description.length < 20) {
      reasons.push({ code: "short_description", message: "Your project description is too short (at least 20 characters)." });
    }
    if (project.description.length > 1000) {
      reasons.push({ code: "long_description", message: "Your project description is too long (max 1000 characters)." });
    }
  }

  if (project.repository_url == null) {
    reasons.push({ code: "missing_repository", message: "Please provide a repository URL so others can view the source." });
  } else {
    try {
      const url = new URL(project.repository_url);
      const urlError = validateOutboundUrl(url);
      const repoHostnameLower = url.hostname.toLowerCase();
      const isOnshapeRepo = project.type === "hardware" && (repoHostnameLower === "cad.onshape.com" || repoHostnameLower === "onshape.com" || repoHostnameLower.endsWith(".onshape.com"));

      if (urlError) {
        reasons.push({ code: "invalid_repository", message: urlError });
      } else if (isOnshapeRepo) {
        // Onshape docs aren't git; trust them once validateOutboundUrl clears SSRF.
      } else {
        const checkRepository = async (baseUrl: string) => {
          try {
            // Git hosts redirect to separate backends; every hop is re-validated against SSRF.
            let discoveryUrl = new URL(`${baseUrl.replace(/\/$/, "")}/info/refs?service=git-upload-pack`);
            for (let hop = 0; hop < 5; hop++) { // max redirects to follow
              if (validateOutboundUrl(discoveryUrl)) return false;

              const response = await safeRequest(discoveryUrl, { method: "GET" });
              if (response.status >= 300 && response.status < 400) {
                const location = response.headers.location;
                if (!location) return false;
                discoveryUrl = new URL(String(location), discoveryUrl);
                continue;
              }
              if (response.status < 200 || response.status >= 300) return false;
              return response.body.startsWith("001e# service=git-upload-pack");
            }
            return false;
          } catch (error) {
            const message = (error as { message?: string })?.message;
            console.error("Repository discovery fetch failed for", baseUrl, (error as { code?: string })?.code ?? message ?? "unknown error");
            return false;
          }
        };

        let isValid = await checkRepository(project.repository_url);
        if (!isValid && !project.repository_url.endsWith(".git")) {
          isValid = await checkRepository(`${project.repository_url}.git`);
        }

        if (!isValid) {
          reasons.push({ code: "invalid_repository", message: "The repository URL provided does not seem to be a valid public Git repository." });
        }
      }
    } catch {
      reasons.push({ code: "invalid_repository_url", message: "Your repository URL is invalid, please provide a valid public URL (e.g. https://github.com/user/repo or an Onshape document link)" });
    }
  }

  // Both exist to justify a grant amount, so only funding ships need them.
  if (project.type === "hardware" && project.next_ship_needs_funding === true) {
    if ((project.cart_screenshots ?? []).length === 0) {
      reasons.push({
        code: "missing_cart_screenshots",
        message: "Add at least one screenshot of your cart or parts list so reviewers can see what you bought.",
      });
    }
    if (project.build_cost_cents == null || project.build_cost_cents <= 0) {
      reasons.push({
        code: "missing_build_cost",
        message: "Add the total cost to build your project so reviewers know how much it cost.",
      });
    }
  }

  // html is exempt: the guide ship was auto-approved with a canned 1h credit.
  if (
    isKnownGuide(project.guide)
    && project.guide !== "html"
    && project.type === "software"
    && (project.hackatime_projects?.length ?? 0) === 0
  ) {
    reasons.push({
      code: "missing_hackatime_for_guide",
      message: "Add a Hackatime project to this tutorial before submitting for review.",
    });
  }

  // Aged-out users cleared a pre-19 floor above; their live totals include post-19 time.
  if (!isKnownGuide(project.guide) && project.id > 0 && !agedOutWithEligibleWork) {
    const totalJournalHours = (
      await db
        .select({
          archived: journalsTable.archived,
          hours: journalsTable.hours,
        })
        .from(journalsTable)
        .where(eq(journalsTable.project_id, project.id))
    ).reduce((sum, journal) => {
      if (journal.archived) return sum;
      return sum + Math.max(0, journal.hours ?? 0);
    }, 0);

    let hackatimeHoursRaw = 0;
    let hackatimeHours = 0;
    if ((project.hackatime_projects?.length ?? 0) > 0 && hackatimeOAuthToken) {
      const projectTotals = await getAuthenticatedProjects(hackatimeOAuthToken);
      if (projectTotals?.projects?.length) {
        const selectedProjects = new Set(project.hackatime_projects ?? []);
        const totalSeconds = projectTotals.projects.reduce((sum, projectEntry) => {
          if (!selectedProjects.has(projectEntry.name)) return sum;
          return sum + (projectEntry.total_seconds ?? 0);
        }, 0);

        hackatimeHoursRaw = totalSeconds / 3600; // seconds to hours
        hackatimeHours = Math.round(hackatimeHoursRaw);
      }
    }

    if (hackatimeHours + totalJournalHours < 1) {
      reasons.push({
        code: "insufficient_logged_hours",
        message: formatInsufficientHoursMessage(hackatimeHoursRaw + totalJournalHours),
      });
    }
  }

  return { ok: reasons.length === 0, reasons };
}

// Enforced in code so changing it needs no migration.
export const MAX_COLLABORATORS = 4; // excludes the owner

export async function isActiveCollaborator(
  userId: string,
  projectId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projectCollaboratorTable.id })
    .from(projectCollaboratorTable)
    .where(
      and(
        eq(projectCollaboratorTable.project_id, projectId),
        eq(projectCollaboratorTable.user_id, userId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    )
    .limit(1);
  return !!row;
}

// Deliberately ignores collaborators: management actions are owner-only.
export function canManageProject(
  userId: string,
  project: Pick<InferSelectModel<typeof projectTable>, "user_id">,
): boolean {
  return project.user_id === userId;
}
