import { dm } from "./slack-bot";

const RECIPIENT_SLACK_ID = "U05EZRFKRV4";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export async function alertHcbGrantNeedsManualReturn(args: {
  shipId: number;
  orderIds: number[];
  reason: string;
}): Promise<void> {
  if (args.orderIds.length === 0) return;
  const text = [
    ":credit_card: *HCB card grant needs a manual return*",
    "",
    `Ship #${args.shipId}: shop ${args.orderIds.length > 1 ? "orders" : "order"} ${args.orderIds.map((id) => `#${id}`).join(", ")} still holds a live HCB card grant the automatic clawback did not return.`,
    `Reason: ${args.reason}`,
    "",
    `Return it via ${publicBaseUrl()}/internal/orders`,
  ].join("\n");

  const res = await dm({ user: RECIPIENT_SLACK_ID, text });
  if (!res.ok) {
    console.error(
      `[hcb-grant-return-alert] dm to ${RECIPIENT_SLACK_ID} failed: ${res.error}`,
    );
  }
}
