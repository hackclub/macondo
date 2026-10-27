export interface AuthUserAddress {
  id?: string | null;
  line_1?: string | null;
  line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  primary?: boolean | null;
}

export interface AuthUserDevDebugFlags {
  ignoreAddressChecks: boolean;
  ignoreShipPolicies: boolean;
  ignoreEditPolicies: boolean;
  ignoreReviewerOwnershipPolicies: boolean;
  fakeHackatime: boolean;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  created_at?: string | null;
  username?: string | null;
  slack_id?: string | null;
  locale?: string | null;
  timezone?: string | null;
  roles?: string[] | null;
  onboarding_step?: string | null;
  // Guide slugs (e.g. "html"), set server-side when the guide's tutorial is shipped
  completed_guides?: string[] | null;
  is_temp?: boolean | null;
  has_hackclub?: boolean | null;
  has_github?: boolean | null;
  has_hackatime?: boolean | null;
  // Stored Hackatime token was revoked upstream; reconnecting fixes it
  hackatime_token_invalid?: boolean | null;
  streak_freezes_remaining?: number;
  worked_today?: boolean;
  longest_current_streak?: number;
  reminder_hours_before_day_end?: number;
  reminder_local_hours?: number[] | null;
  streak_slack_notifications?: boolean;
  auto_use_streak_freezes?: boolean;
  has_address?: boolean | null;
  // Stricter than has_address: the primary address and the name pass the completeness checks
  has_valid_address?: boolean | null;
  has_valid_name?: boolean | null;
  addresses?: AuthUserAddress[] | null;
  dev_debug_flags?: AuthUserDevDebugFlags | null;
  // verified | pending | needs_submission | basic_info_required | document_required | null;
  // ineligible users never get a session. Refreshed on every OAuth callback.
  hca_verification_status?: string | null;
  hca_ysws_eligible?: boolean | null;
  // Epoch ms when shipping closes for this user (the extension cohort gets the later deadline)
  ship_deadline_ms?: number | null;
  // True while the user's one post-deadline grace submission is unspent
  ship_grace_submit_available?: boolean | null;
  // The dashboard uses it to decide whether to re-run OAuth to refresh hca_verification_status
  last_login_at?: string | null;
  impersonation?: {
    actor: {
      id: string;
      name: string;
      username?: string | null;
      email?: string | null;
      image?: string | null;
    };
  } | null;
}

export const useAuth = () => {
  const user = useState<AuthUser | null>(
    "auth_user",
    () => null,
  );
  const loading = useState<boolean>("auth_loading", () => true);
  // Set on a 401 { banned: true }; the auth middleware redirects to this fraud URL
  const bannedRedirect = useState<string | null>(
    "auth_banned_redirect",
    () => null,
  );
  // Set on a 401 { banned: true, scope: "macondo" }; drives the /banned redirect and page
  const macondoBan = useState<{ reason: string; until: string | null } | null>(
    "auth_macondo_ban",
    () => null,
  );
  const isLoggedIn = computed(() => !!user.value);
  const isImpersonating = computed(() => !!user.value?.impersonation);

  async function fetchSession() {
    // Only a first load (no user yet) may block: the auth middleware waits on `loading`, so a
    // background refresh flipping it would stall every navigation until /api/auth/me returned.
    if (!user.value) loading.value = true;
    try {
      user.value = await $fetch<AuthUser>("/api/auth/me");
      bannedRedirect.value = null;
      macondoBan.value = null;
    } catch (err: unknown) {
      user.value = null;
      const data = (err as {
        data?: {
          banned?: boolean;
          redirect?: string;
          scope?: string;
          reason?: string;
          until?: string | null;
        };
      } | undefined)?.data;
      if (data?.banned && data.scope === "macondo") {
        macondoBan.value = {
          reason: data.reason ?? "",
          until: data.until ?? null,
        };
        bannedRedirect.value = null;
      } else if (data?.banned && typeof data.redirect === "string") {
        bannedRedirect.value = data.redirect;
        macondoBan.value = null;
      } else {
        bannedRedirect.value = null;
        macondoBan.value = null;
      }
    } finally {
      loading.value = false;
    }
  }

  function signIn() {
    window.location.href = "/api/auth/login";
  }

  async function signOut() {
    user.value = null;
    try {
      await $fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // If logout fails, still navigate home so the user is visually signed out.
    }
    window.location.href = "/";
  }

  async function stopImpersonating() {
    const response = await $fetch<{ redirectTo?: string }>(
      "/api/auth/impersonation/stop",
      { method: "POST" },
    );
    user.value = null;
    window.location.href = response.redirectTo ?? "/internal/users";
  }

  const greeting = computed(() => {
    if (!user.value) return "";
    return `Hi, ${user.value.username || user.value.email || "there"}`;
  });

  if (import.meta.client) {
    if (user.value) {
      // The server render already loaded the session into the payload (the dashboard does), so
      // hydration must not wait on a second /api/auth/me; session-live-refresh keeps it fresh.
      loading.value = false;
    } else {
      callOnce("auth:fetchSession", fetchSession);
    }
  } else {
    loading.value = false;
  }

  return {
    user,
    isLoggedIn,
    isImpersonating,
    loading,
    bannedRedirect,
    macondoBan,
    greeting,
    signIn,
    signOut,
    stopImpersonating,
    fetchSession,
  };
};
