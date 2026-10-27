// Shared so the chip updates right after a ship approval or shop unlock, not on refresh.
export const useStarfruitBalance = () => {
  const balance = useState<number>("starfruit_balance", () => 0);
  const initialized = useState<boolean>(
    "starfruit_balance_initialized",
    () => false,
  );

  async function refresh(): Promise<void> {
    try {
      balance.value = Number((await $fetch<{ balance: number }>("/api/users/starfruit")).balance ?? 0);
      initialized.value = true;
    } catch {
      // Keep last known balance on transient errors.
    }
  }

  function setBalance(value: number | null | undefined): void {
    if (value == null || !Number.isFinite(value)) return;
    balance.value = Number(value);
    initialized.value = true;
  }

  return { balance, initialized, refresh, setBalance };
};
