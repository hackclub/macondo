// Reminder DMs fire at local hour (24 - N) in the user's own timezone, once per day.
// Reminder timers stay off after Macondo ends; the reconcile still settles history.

import {
  reconcileAllActiveUsers,
  reconcileOpenReviewProtection,
  reconcileStrandedPendingFreezes,
} from "../lib/streak-reconcile";
import { sendDueReminders } from "../lib/streak-reminders";
import { sendDueZeroStreakReminders } from "../lib/zero-streak-reminders";
import { sendDueHackatimeReconnectNudges } from "../lib/hackatime-reconnect-nudge";
import { macondoHasEnded } from "../lib/macondo-end";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let dailyTimer: ReturnType<typeof setInterval> | null = null;
  let hourlyTimer: ReturnType<typeof setInterval> | null = null;
  let zeroStreakTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectNudgeTimer: ReturnType<typeof setInterval> | null = null;

  async function reconcileTick(source: "startup" | "scheduled") {
    try {
      const report = await reconcileAllActiveUsers();
      console.info(
        `[cron-streak-reconcile] ${source} run: scanned ${report.scanned}, reconciled ${report.reconciled}, broken ${report.broken}, freezes consumed ${report.freezes_consumed}, freezes refunded ${report.freezes_refunded}`,
      );
    } catch (err) {
      console.error(`[cron-streak-reconcile] ${source} run failed`, err);
    }

    // Own try/catch so it can never break the burn pass.
    try {
      const report = await reconcileOpenReviewProtection();
      if (report.users_healed > 0) {
        console.info(
          `[cron-streak-review-protect] ${source} run: scanned ${report.scanned}, users healed ${report.users_healed}, days protected ${report.days_protected}, freezes refunded ${report.freezes_refunded}`,
        );
      }
    } catch (err) {
      console.error(`[cron-streak-review-protect] ${source} run failed`, err);
    }

    // Must run last, after the passes above settle pending days. The short lookback
    // only heals fresh strandings so a deploy never mass-burns freezes on the backlog.
    try {
      const report = await reconcileStrandedPendingFreezes({ lookbackDays: 7 });
      if (report.users_healed > 0) {
        console.info(
          `[cron-streak-stranded-pending] ${source} run: scanned ${report.scanned}, users healed ${report.users_healed}, days frozen ${report.days_frozen}, freezes consumed ${report.freezes_consumed}, unresolved (no freeze) ${report.unresolved_no_freeze}`,
        );
      }
    } catch (err) {
      console.error(`[cron-streak-stranded-pending] ${source} run failed`, err);
    }
  }

  async function reminderTick() {
    try {
      const report = await sendDueReminders();
      if (report.candidates > 0 || report.sent > 0) {
        console.info(
          `[cron-streak-reminder] scanned ${report.scanned}, candidates ${report.candidates}, sent ${report.sent}, skipped (qualified) ${report.skipped_already_qualified}, skipped (audit) ${report.skipped_existing_audit}, skipped (in review) ${report.skipped_all_streaks_in_review}`,
        );
      }
    } catch (err) {
      console.error(`[cron-streak-reminder] tick failed`, err);
    }
  }

  async function reconnectNudgeTick() {
    try {
      const report = await sendDueHackatimeReconnectNudges();
      if (report.invalid > 0 || report.sent > 0) {
        console.info(
          `[cron-hackatime-reconnect] scanned ${report.scanned}, probed ${report.probed}, invalid tokens ${report.invalid}, nudges sent ${report.sent}`,
        );
      }
    } catch (err) {
      console.error(`[cron-hackatime-reconnect] tick failed`, err);
    }
  }

  async function zeroStreakTick() {
    try {
      const report = await sendDueZeroStreakReminders();
      if (report.candidates > 0 || report.sent > 0) {
        console.info(
          `[cron-streak-zero-reminder] scanned ${report.scanned}, candidates ${report.candidates}, sent ${report.sent}, skipped (no zero projects) ${report.skipped_no_zero_projects}, skipped (audit) ${report.skipped_existing_audit}, skipped (in review) ${report.skipped_all_zero_projects_in_review}`,
        );
      }
    } catch (err) {
      console.error(`[cron-streak-zero-reminder] tick failed`, err);
    }
  }

  const guardedReconcileTick = guarded("cron-streak-reconcile", reconcileTick);
  const guardedReminderTick = guarded("cron-streak-reminder", reminderTick);
  const guardedZeroStreakTick = guarded("cron-streak-zero-reminder", zeroStreakTick);
  const guardedReconnectNudgeTick = guarded("cron-hackatime-reconnect", reconnectNudgeTick);
  const remindersOver = macondoHasEnded();
  if (remindersOver) {
    console.info(
      "[cron-streak-reminder] Macondo has ended; streak reminder, zero-streak and Hackatime reconnect DMs are disabled (reconcile still runs)",
    );
  }

  startupTimer = setTimeout(() => {
    void guardedReconcileTick("startup");
    dailyTimer = setInterval(() => void guardedReconcileTick("scheduled"), 24 * 60 * 60 * 1000);
    if (remindersOver) return;
    void guardedReminderTick();
    void guardedZeroStreakTick();
    void guardedReconnectNudgeTick();
    hourlyTimer = setInterval(() => void guardedReminderTick(), HOURLY_INTERVAL_MS);
    zeroStreakTimer = setInterval(() => void guardedZeroStreakTick(), HOURLY_INTERVAL_MS);
    reconnectNudgeTimer = setInterval(() => void guardedReconnectNudgeTick(), HOURLY_INTERVAL_MS);
  }, 45_000); // startup delay, 45 seconds

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (dailyTimer) clearInterval(dailyTimer);
    if (hourlyTimer) clearInterval(hourlyTimer);
    if (zeroStreakTimer) clearInterval(zeroStreakTimer);
    if (reconnectNudgeTimer) clearInterval(reconnectNudgeTimer);
  });
});
