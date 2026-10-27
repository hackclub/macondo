export function formatReviewerHandle(
  user: { id: string | number; username: string | null } | null | undefined,
): string {
  if (!user) return "Unassigned";
  if (user.username && user.username.length > 0) return `@${user.username}`;
  return `#${user.id}`;
}
