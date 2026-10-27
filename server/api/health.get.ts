// Dockerfile HEALTHCHECK: must answer fast, so no DB, Redis or external calls.
export default defineEventHandler((event) => {
  setResponseStatus(event, 200);
  return { status: "ok" };
});
