// Shared so the navbar coin counter updates right after a transaction, not on refresh.
export const useGoldBalance = () => {
  const balance = useState<number>("gold_balance", () => 0);
  const initialized = useState<boolean>("gold_balance_initialized", () => false);

  async function refresh(): Promise<void> {
    try {
      balance.value = Number((await $fetch<{ balance: number }>("/api/users/balance")).balance ?? 0);
      initialized.value = true;
    } catch {
      // Keep last known balance on a transient network error.
    }
  }

  function setBalance(value: number | null | undefined): void {
    if (value == null || !Number.isFinite(value)) return;
    balance.value = Number(value);
    initialized.value = true;
  }

  return { balance, initialized, refresh, setBalance };
};
