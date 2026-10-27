// Audit rows must tell system actions from user actions to serve as fraud evidence.
// These are real is_system `users` rows (drizzle/0168_system_actors.sql) so the actor_id FK holds.

export const SYSTEM_ACTORS = {
  // dispatching a fraud check is done *to* the submission, not by the student
  checkDispatcher: "system-check-dispatcher",
  redOrderGuard: "system-red-order-guard",
} as const;
