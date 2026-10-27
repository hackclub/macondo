<script setup lang="ts">
import {
  formatOrderDateTime,
  formatUsdCents,
  hcbGrantStatusClass,
  hcbGrantStatusLabel,
  transactionAmountClass,
  type HcbGrantInfo,
} from "~/utils/internalOrders";

defineProps<{ info: HcbGrantInfo }>();
</script>

<template>
  <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">HCB Grant</p>
      <span
        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
        :class="hcbGrantStatusClass(info)"
      >
        {{ hcbGrantStatusLabel(info) }}
      </span>
    </div>

    <p v-if="info.fetch_error" class="text-sm text-red-300">
      Could not fetch live HCB grant details: {{ info.fetch_error }}
    </p>

    <template v-else>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="border border-zinc-800 bg-zinc-950/50 p-3">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Original</p>
          <p class="text-sm text-white mt-1">{{ formatUsdCents(info.amount_cents) }}</p>
        </div>
        <div class="border border-zinc-800 bg-zinc-950/50 p-3">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Balance</p>
          <p class="text-sm text-white mt-1">{{ formatUsdCents(info.balance_cents) }}</p>
        </div>
        <div class="border border-zinc-800 bg-zinc-950/50 p-3">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Spent</p>
          <p class="text-sm text-white mt-1">{{ formatUsdCents(info.spent_cents) }}</p>
        </div>
        <div class="border border-zinc-800 bg-zinc-950/50 p-3">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Transactions</p>
          <p class="text-sm text-white mt-1">{{ info.transactions_total_count }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-1 text-sm text-zinc-400">
        <p v-if="info.purpose">Purpose: {{ info.purpose }}</p>
        <p v-if="info.email">HCB recipient: {{ info.email }}</p>
        <p v-if="info.expires_on">Expires: {{ info.expires_on }}</p>
      </div>

      <div class="border border-zinc-800 divide-y divide-zinc-800">
        <div
          v-if="info.transactions.length === 0"
          class="p-3 text-sm text-zinc-500"
        >
          No HCB card grant transactions yet.
        </div>
        <template v-else>
          <div
            v-for="transaction in info.transactions"
            :key="transaction.id"
            class="p-3 flex items-start justify-between gap-4"
          >
            <div class="flex flex-col gap-1 min-w-0">
              <p class="text-sm text-zinc-200 truncate">
                {{ transaction.memo ?? transaction.code ?? transaction.id }}
              </p>
              <p class="text-xs text-zinc-500">
                {{ formatOrderDateTime(transaction.date) }}
                <span v-if="transaction.pending"> · Pending</span>
                <span v-if="transaction.declined"> · Declined</span>
                <span v-if="transaction.reversed"> · Reversed</span>
                <span v-if="transaction.missing_receipt"> · Missing receipt</span>
              </p>
            </div>
            <p class="text-sm font-bold shrink-0" :class="transactionAmountClass(transaction)">
              {{ formatUsdCents(transaction.amount_cents) }}
            </p>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
