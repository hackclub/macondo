// Dependency-free so scripts/check-hcb-grant-spend.ts can import it without booting Nuxt.

export type HcbGrantTransactionSummary = {
  id: string;
  date: string | null;
  amount_cents: number | null;
  memo: string | null;
  pending: boolean;
  declined: boolean;
  reversed: boolean;
  missing_receipt: boolean;
  code: string | null;
};

// HCB ledger movements ("Topup of grant to <name>", "Returning canceled grant to ...") aren't spend.
// Anchored on purpose: a false positive hides real spend, a false negative only over-reports.
const NON_SPEND_MEMO =
  /^(returning|return of funds from|withdrawal from|topup of)\b.*\bgrant to\b/i;

// Pending charges count: the money is committed even before it settles.
export function hcbGrantSpentCents(
  transactions: HcbGrantTransactionSummary[],
): number {
  return transactions.reduce((total, transaction) => {
    if (
      transaction.amount_cents == null ||
      transaction.amount_cents >= 0 ||
      transaction.declined ||
      transaction.reversed ||
      (transaction.memo != null && NON_SPEND_MEMO.test(transaction.memo))
    ) {
      return total;
    }

    return total + Math.abs(transaction.amount_cents);
  }, 0);
}
