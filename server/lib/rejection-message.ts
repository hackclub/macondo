
// Legacy Fraud Squad rejections; the project page keys off the prefix to show the
// "@Fraud Squad" highlight instead of a reviewer's own message.
export const FRAUD_SQUAD_REJECTION_PREFIX =
  "This project was permanently rejected by the Fraud Squad";

// Reviewer messages never match: buildRejectionUserMessage wraps them differently.
export function isFraudSquadRejectionMessage(
  message: string | null | undefined,
): boolean {
  return typeof message === "string" && message.startsWith(FRAUD_SQUAD_REJECTION_PREFIX);
}

export function buildRejectionUserMessage(opts: {
  reviewerMessage?: string | null;
  fraudJustification?: string | null;
  upstreamReason?: string | null;
  trustScore?: number | null;
}): string {
  const reason =
    opts.reviewerMessage?.trim() ||
    opts.upstreamReason?.trim() ||
    opts.fraudJustification?.trim() ||
    (opts.trustScore != null ? `Trust score ${opts.trustScore}/10` : null) ||
    "No additional details available.";
  return `This project cannot be submitted to Macondo for this reason: ${reason}`;
}
