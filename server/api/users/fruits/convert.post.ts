// Kept so stale clients get a clear 410 instead of a 404 now that the ledger is gold-only.

export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    statusMessage:
      "Fruit was converted to gold. There is no longer anything to exchange.",
  });
});
