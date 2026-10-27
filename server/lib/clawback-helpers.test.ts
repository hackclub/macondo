import { describe, expect, test } from "bun:test";

import { planClawBackOps, type ClawBackTx } from "./clawback-helpers";

const APPROVAL = new Date("2026-05-01T00:00:00Z");
const BEFORE = new Date("2026-04-15T00:00:00Z");
const AFTER1 = new Date("2026-05-02T00:00:00Z");
const AFTER2 = new Date("2026-05-03T00:00:00Z");
const AFTER3 = new Date("2026-05-04T00:00:00Z");

function tx(overrides: Partial<ClawBackTx> & Pick<ClawBackTx, "id">): ClawBackTx {
  return {
    amount: 0,
    type: "increase",
    source: "system",
    fruit_type: null,
    memo: null,
    shop_order_id: null,
    unlocked_at: overrides.created_at ?? APPROVAL,
    counts: true,
    created_at: APPROVAL,
    ...overrides,
  };
}

describe("planClawBackOps", () => {
  test("all-positive balance: no changes", () => {
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: BEFORE,
        unlocked_at: BEFORE,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds).toEqual([]);
    expect(plan.cancelledShopOrderIds).toEqual([]);
  });

  test("simple fruit overdraw: disables conversion pair", () => {
    // Disabling both conversion rows brings fruit and gold back to 0.
    const convMemo = "Convert 50 Apple → 250 gold @ 5/fruit";
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false, // pre-disabled by the revert flow
      }),
      tx({
        id: 2,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 3,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds.sort((a, b) => a - b)).toEqual([2, 3]);
    expect(plan.cancelledShopOrderIds).toEqual([]);
  });

  test("cascade: conversion + shop purchase from the resulting gold", () => {
    // After ship_reward disable, fruit = -50, gold = +50.
    const convMemo = "Convert 50 Apple → 250 gold @ 5/fruit";
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
      tx({
        id: 2,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 3,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 4,
        amount: 200,
        type: "decrease",
        source: "shop_purchase",
        fruit_type: null,
        memo: "Bought widget",
        shop_order_id: 99,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds.sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(plan.cancelledShopOrderIds).toEqual([99]);
  });

  test("mixed earnings: another ship_reward in the window is not touched", () => {
    // The +30 reward is from a different ship and must never be flipped; Apple is 30 - 50 = -20.
    const convMemo = "Convert 50 Apple → 250 gold @ 5/fruit";
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
      tx({
        id: 10,
        amount: 30,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 2,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: convMemo,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
      tx({
        id: 3,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: convMemo,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds.sort((a, b) => a - b)).toEqual([2, 3]);
    expect(plan.disabledIds).not.toContain(10);
  });

  test("pre-approval activity is not touched even when balance is negative", () => {
    // The -80 debit predates reviewed_at, so it's legitimate and must not be touched.
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: BEFORE,
        unlocked_at: BEFORE,
      }),
      tx({
        id: 2,
        amount: 80,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: "Convert 80 Apple → 400 gold @ 5/fruit",
        created_at: BEFORE,
        unlocked_at: BEFORE,
      }),
      tx({
        id: 3,
        amount: 400,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: "Convert 80 Apple → 400 gold @ 5/fruit",
        created_at: BEFORE,
        unlocked_at: BEFORE,
      }),
      tx({
        id: 100,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
      tx({
        id: 101,
        amount: 200,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: "Convert 200 Apple → 1000 gold @ 5/fruit",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 102,
        amount: 1000,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: "Convert 200 Apple → 1000 gold @ 5/fruit",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds).not.toContain(1);
    expect(plan.disabledIds).not.toContain(2);
    expect(plan.disabledIds).not.toContain(3);
    expect(plan.disabledIds.sort((a, b) => a - b)).toEqual([101, 102]);
  });

  test("manual_adjustment decreases are not silently undone", () => {
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
      tx({
        id: 2,
        amount: 10,
        type: "decrease",
        source: "manual_adjustment",
        fruit_type: "Apple",
        memo: "Admin penalty",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds).toEqual([]);
    expect(plan.cancelledShopOrderIds).toEqual([]);
  });

  test("locked rows (unlocked_at null) do not contribute to balance", () => {
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: null,
      }),
    ];
    expect(planClawBackOps(rows, APPROVAL).disabledIds).toEqual([]);
  });

  test("most recent eligible candidate wins on ties via id", () => {
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
      tx({
        id: 2,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: "conv-50",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 3,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: "conv-50",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      // Same created_at, so the higher id is the "most recent" tiebreak.
      tx({
        id: 4,
        amount: 100,
        type: "decrease",
        source: "shop_purchase",
        shop_order_id: 41,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
      tx({
        id: 5,
        amount: 100,
        type: "decrease",
        source: "shop_purchase",
        shop_order_id: 51,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    // Undoing the conversion pushes gold negative; 5 is undone first, and gold is still -100 so 4 follows.
    expect(plan.disabledIds).toContain(2);
    expect(plan.disabledIds).toContain(3);
    expect(plan.disabledIds).toContain(5);
    expect(plan.disabledIds).toContain(4);
    expect(plan.cancelledShopOrderIds.sort((a, b) => a - b)).toEqual([41, 51]);
  });

  test("stops gracefully when no in-window candidates exist", () => {
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: "Convert 50",
        created_at: BEFORE,
        unlocked_at: BEFORE,
      }),
      tx({
        id: 2,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
        counts: false,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds).toEqual([]);
    expect(plan.cancelledShopOrderIds).toEqual([]);
  });

  test("does not pick increases as standalone candidates", () => {
    // Only decreases of allowed sources are eligible.
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        counts: false,
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
      }),
      tx({
        id: 2,
        amount: 50,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: "Strange standalone gold credit",
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
    ];
    expect(planClawBackOps(rows, APPROVAL).disabledIds).toEqual([]);
  });

  test("multiple iterations: cascade pushes gold negative which needs another pass", () => {
    // Iter 1 undoes the conversion (Apple 0, gold -300); iter 2 undoes the purchase.
    const convMemo = "Convert 100 Apple → 500 gold @ 5/fruit";
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 100,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        counts: false,
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
      }),
      tx({
        id: 2,
        amount: 100,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 3,
        amount: 500,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo: convMemo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 4,
        amount: 300,
        type: "decrease",
        source: "shop_purchase",
        shop_order_id: 77,
        created_at: AFTER2,
        unlocked_at: AFTER2,
      }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds.sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(plan.cancelledShopOrderIds).toEqual([77]);
  });

  test("conversion debit picks paired credit by memo + matching created_at", () => {
    // Same memo twice: only the pair with matching created_at is disabled together.
    const memo = "Convert 50 Apple → 250 gold @ 5/fruit";
    const rows: ClawBackTx[] = [
      tx({
        id: 1,
        amount: 200,
        type: "increase",
        source: "ship_reward",
        fruit_type: "Apple",
        counts: false,
        created_at: APPROVAL,
        unlocked_at: APPROVAL,
      }),
      tx({
        id: 2,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 3,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo,
        created_at: AFTER1,
        unlocked_at: AFTER1,
      }),
      tx({
        id: 4,
        amount: 50,
        type: "decrease",
        source: "system",
        fruit_type: "Apple",
        memo,
        created_at: AFTER3,
        unlocked_at: AFTER3,
      }),
      tx({
        id: 5,
        amount: 250,
        type: "increase",
        source: "system",
        fruit_type: null,
        memo,
        created_at: AFTER3,
        unlocked_at: AFTER3,
      }),
    ];
    expect(
      planClawBackOps(rows, APPROVAL).disabledIds.sort((a, b) => a - b),
    ).toEqual([2, 3, 4, 5]);
  });
  test("an order already cancelled and refunded is skipped, not refunded again", () => {
    // Bought, cancelled with a refund, then bought again: only the live order can pay the debt back.
    const rows: ClawBackTx[] = [
      tx({ id: 1, amount: 100, source: "ship_reward", created_at: APPROVAL }),
      tx({ id: 2, amount: 400, type: "decrease", source: "shop_purchase", shop_order_id: 10, created_at: AFTER1 }),
      tx({ id: 3, amount: 400, source: "shop_refund", shop_order_id: 10, created_at: AFTER2 }),
      tx({ id: 4, amount: 400, type: "decrease", source: "shop_purchase", shop_order_id: 11, created_at: AFTER3 }),
      tx({ id: 5, amount: 200, type: "decrease", source: "shop_purchase", shop_order_id: 12, created_at: BEFORE, unlocked_at: BEFORE }),
    ];
    const plan = planClawBackOps(rows, APPROVAL);
    expect(plan.disabledIds).toEqual([4]);
    expect(plan.cancelledShopOrderIds).toEqual([11]);
  });
  test("minimal: keeps the small orders a later big one made unnecessary", () => {
    // Owes 2474: the two newest orders don't cover it, the 4000 one alone does.
    const rows: ClawBackTx[] = [
      tx({ id: 1, amount: 1526, source: "ship_reward", created_at: APPROVAL }),
      tx({ id: 2, amount: 4000, type: "decrease", source: "shop_purchase", shop_order_id: 10, created_at: AFTER1 }),
      tx({ id: 3, amount: 180, type: "decrease", source: "shop_purchase", shop_order_id: 11, created_at: AFTER2 }),
      tx({ id: 4, amount: 200, type: "decrease", source: "shop_purchase", shop_order_id: 12, created_at: AFTER3 }),
    ];
    const greedy = planClawBackOps(rows, APPROVAL);
    expect(greedy.cancelledShopOrderIds.sort()).toEqual([10, 11, 12]);

    const plan = planClawBackOps(rows, APPROVAL, { minimal: true });
    expect(plan.disabledIds).toEqual([2]);
    expect(plan.cancelledShopOrderIds).toEqual([10]);
  });

  test("minimal: changes nothing when every voided order is needed", () => {
    const rows: ClawBackTx[] = [
      tx({ id: 1, amount: 100, source: "ship_reward", created_at: APPROVAL }),
      tx({ id: 2, amount: 300, type: "decrease", source: "shop_purchase", shop_order_id: 10, created_at: AFTER1 }),
      tx({ id: 3, amount: 500, type: "decrease", source: "shop_purchase", shop_order_id: 11, created_at: AFTER2 }),
    ];
    const plan = planClawBackOps(rows, APPROVAL, { minimal: true });
    expect(plan.disabledIds.sort()).toEqual([2, 3]);
    expect(plan.cancelledShopOrderIds.sort()).toEqual([10, 11]);
  });
});
