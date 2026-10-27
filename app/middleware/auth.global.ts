export default defineNuxtRouteMiddleware(async (to) => {
  const needsAuth = ["/internal", "/dashboard", "/onboarding", "/guides", "/ideas"].some((p) => to.path.startsWith(p));
  const redirectsLoggedIn = to.path === "/";

  if (!needsAuth && !redirectsLoggedIn) return;
  if (import.meta.server) return;

  const { isLoggedIn, loading, user, bannedRedirect, macondoBan } = useAuth();

  if (loading.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(loading, (val) => {
        if (!val) {
          stop();
          resolve();
        }
      });
    });
  }

  // replace so the back button doesn't loop.
  if (bannedRedirect.value) {
    return navigateTo(bannedRedirect.value, { external: true, replace: true });
  }

  // In-app navigation so the SPA state carrying the ban reason survives the hop.
  if (macondoBan.value) {
    return navigateTo("/banned", { replace: true });
  }

  if (redirectsLoggedIn && isLoggedIn.value) {
    return navigateTo("/dashboard", { replace: true });
  }

  if (!needsAuth) return;

  if (!isLoggedIn.value) {
    return navigateTo("/?login=required", { replace: true });
  }

  const step = user.value?.onboarding_step;
  const onboardingIncomplete = step && step !== "complete";

  // Mid-tutorial users can escape via "Back to farm"; their progress stays saved.
  const canExitToDashboard =
    step === "tutorial" && to.path.startsWith("/dashboard");

  const canExitToGuide = step === "tutorial" && to.path.startsWith("/guides");

  const canExitToIdeas = step === "tutorial" && to.path.startsWith("/ideas");

  // Staff mid-onboarding must still reach /internal; the role checks below still apply.
  const canExitToInternal = to.path.startsWith("/internal");

  if (
    onboardingIncomplete &&
    !to.path.startsWith("/onboarding") &&
    !canExitToDashboard &&
    !canExitToGuide &&
    !canExitToIdeas &&
    !canExitToInternal
  ) {
    return navigateTo("/onboarding", { replace: true });
  }

  if (!onboardingIncomplete && to.path.startsWith("/onboarding")) {
    return navigateTo("/dashboard", { replace: true });
  }

  if (to.path.startsWith("/internal")) {
    type InternalMe = {
      permissions: {
        canAccessReview: boolean;
        canAccessOrders: boolean;
        canAccessShopAdmin: boolean;
        canAccessStats: boolean;
        canAccessUsers: boolean;
        canAccessBackups: boolean;
        canAccessSupport: boolean;
        canAccessShippedProjects: boolean;
        isSupportOnly: boolean;
      };
    };
    // Fetched together so each internal navigation waits one round trip, not two;
    // me is only used once reauth is verified.
    const [reauth, prefetchedMe] = await Promise.all([
      $fetch<{ verified: boolean }>("/api/internal/reauth/status").catch(() => null),
      to.path === "/internal/verify"
        ? Promise.resolve(null)
        : $fetch<InternalMe>("/api/internal/me").catch(() => null),
    ]);

    if (!reauth) {
      if (to.path === "/internal/verify") {
        return navigateTo("/", { replace: true });
      }

      return navigateTo(`/internal/verify?return_to=${encodeURIComponent(to.fullPath)}`, {
        replace: true,
      });
    }

    if (to.path === "/internal/verify") {
      return;
    }

    if (!reauth.verified) {
      return navigateTo(`/internal/verify?return_to=${encodeURIComponent(to.fullPath)}`, {
        replace: true,
      });
    }

    const me = prefetchedMe ?? await $fetch<InternalMe>("/api/internal/me");

    const canAccessReview = me.permissions.canAccessReview;
    const canAccessOrders = me.permissions.canAccessOrders;
    const canAccessShopAdmin = me.permissions.canAccessShopAdmin;
    const canAccessStats = me.permissions.canAccessStats;
    const canAccessUsers = me.permissions.canAccessUsers;
    const canAccessBackups = me.permissions.canAccessBackups;
    const canAccessShippedProjects = me.permissions.canAccessShippedProjects;
    const isSupportOnly = me.permissions.isSupportOnly;

    // Support-only users have no dashboard to bounce back to.
    const denyTarget = isSupportOnly ? "/internal/support" : "/internal/dashboard";

    if (isSupportOnly && !to.path.startsWith("/internal/support")) {
      return navigateTo("/internal/support", { replace: true });
    }

    const isReviewPath = [
      "/internal/users",
      "/internal/projects",
    ].some((path) => to.path.startsWith(path));

    // Before the users gate, since /internal/users/backups starts with /internal/users.
    if (to.path.startsWith("/internal/users/backups") && !canAccessBackups) {
      return navigateTo("/internal/users", { replace: true });
    }

    if (to.path.startsWith("/internal/users") && !canAccessUsers) {
      return navigateTo(denyTarget, { replace: true });
    }

    if (to.path.startsWith("/internal/orders") && !canAccessOrders) {
      return navigateTo(denyTarget, { replace: true });
    }

    if (
      (to.path.startsWith("/internal/shop") || to.path.startsWith("/internal/hcb")) &&
      !canAccessShopAdmin
    ) {
      return navigateTo(denyTarget, { replace: true });
    }

    if (to.path.startsWith("/internal/stats") && !canAccessStats) {
      return navigateTo(denyTarget, { replace: true });
    }

    if (to.path.startsWith("/internal/shipped") && !canAccessShippedProjects) {
      return navigateTo(denyTarget, { replace: true });
    }

    if (isReviewPath && !canAccessReview) {
      return navigateTo(denyTarget, { replace: true });
    }
  }
});
