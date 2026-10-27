// Template IDs come from NUXT_LOOPS_TEMPLATE_* env vars via runtimeConfig; an
// unset one makes sendMail() skip the email instead of failing.

import { useRuntimeConfig } from "#imports";

export type TransactionalMail =
  | {
      template: "ship_approved";
      data: {
        project_name: string;
        hours: number;
        reward_summary: string;
        project_url: string;
      };
    }
  | {
      template: "ship_rejected";
      data: {
        project_name: string;
        feedback: string;
        project_url: string;
      };
    }
  | {
      template: "ship_needs_changes";
      data: {
        project_name: string;
        feedback: string;
        resubmit_url: string;
      };
    }
  | {
      template: "ship_decision_reversed";
      data: {
        project_name: string;
        // "rejected" or "needs_changes": the status before the reversal.
        previous_status: string;
        reason: string;
        project_url: string;
      };
    }
  | {
      template: "hardware_grant_sent";
      data: {
        project_name: string;
        amount_usd: string;
        hcb_grant_url: string;
      };
    }
  | {
      template: "shop_grant_sent";
      data: {
        item_name: string;
        amount_usd: string;
        hcb_grant_url: string;
      };
    }
  | {
      template: "shop_grant_fallback_sent";
      data: {
        item_name: string;
        amount_usd: string;
        hcb_grant_url: string;
      };
    }
  | {
      template: "grant_cancelled";
      data: {
        project_name: string;
        reason: string;
        project_url: string;
      };
    }
  | {
      template: "ticket_reply";
      data: {
        ticket_subject: string;
        staff_name: string;
        reply_body: string;
        ticket_url: string;
      };
    }
  | {
      template: "ticket_resolved";
      data: {
        ticket_subject: string;
        ticket_url: string;
      };
    }
  | {
      template: "ticket_reopened";
      data: {
        ticket_subject: string;
        ticket_url: string;
      };
    }
  | {
      template: "event_qualified";
      data: {
        hours: number;
      };
    };

export type TransactionalTemplateKey = TransactionalMail["template"];

export function resolveTemplateId(
  template: TransactionalTemplateKey,
): string | undefined {
  const config = useRuntimeConfig();
  const map: Record<TransactionalTemplateKey, string> = {
    ship_approved: config.loopsTemplateShipApproved as string,
    ship_rejected: config.loopsTemplateShipRejected as string,
    ship_needs_changes: config.loopsTemplateShipNeedsChanges as string,
    ship_decision_reversed: config.loopsTemplateShipDecisionReversed as string,
    hardware_grant_sent: config.loopsTemplateHardwareGrantSent as string,
    shop_grant_sent: config.loopsTemplateShopGrantSent as string,
    shop_grant_fallback_sent: config.loopsTemplateShopGrantFallbackSent as string,
    grant_cancelled: config.loopsTemplateGrantCancelled as string,
    ticket_reply: config.loopsTemplateTicketReply as string,
    ticket_resolved: config.loopsTemplateTicketResolved as string,
    ticket_reopened: config.loopsTemplateTicketReopened as string,
    event_qualified: config.loopsTemplateEventQualified as string,
  };
  const id = map[template];
  return id && id.length > 0 ? id : undefined;
}
