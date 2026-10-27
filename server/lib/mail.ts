// SCOPE LOCK: the only user of NUXT_LOOPS_API_KEY, and only for
// POST /api/v1/transactional. Don't call other Loops endpoints with this key.

import { useRuntimeConfig } from "#imports";
import {
  resolveTemplateId,
  type TransactionalMail,
} from "./mail-templates";
import { LOOPS_API_URL } from "./api-urls";

export type SendMailInput = TransactionalMail & { to: string };

export type SendMailResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const config = useRuntimeConfig();
  const apiKey = config.loopsApiKey as string | undefined;

  if (!apiKey) {
    return { ok: true, skipped: true, reason: "no loops api key configured" };
  }

  const templateId = resolveTemplateId(input.template);
  if (!templateId) {
    return {
      ok: true,
      skipped: true,
      reason: `no template id configured for '${input.template}'`,
    };
  }

  try {
    const res = await fetch(`${LOOPS_API_URL}/transactional`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.to,
        transactionalId: templateId,
        dataVariables: input.data,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `loops ${res.status}: ${text.slice(0, 500)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
