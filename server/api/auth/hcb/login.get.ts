export default defineEventHandler((event) => {
  return sendRedirect(event, "/api/internal/hcb/login");
});
