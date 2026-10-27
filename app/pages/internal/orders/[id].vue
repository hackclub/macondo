<script setup lang="ts">
import type { OrderListItem } from "~/utils/internalOrders";

definePageMeta({ layout: "internal" });

const route = useRoute();
const orderId = computed(() => route.params.id as string);

const {
  data: orderData,
  pending,
  error,
} = useFetch<OrderListItem>(
  () => `/api/internal/shop/orders/${orderId.value}`,
  { server: false },
);

const { data: meData } = useFetch<{
  permissions: {
    canSeePii: boolean;
    canAccessShopAdmin: boolean;
  };
}>("/api/internal/me", { server: false });

const canSeePii = computed(() => meData.value?.permissions?.canSeePii ?? false);
const canAccessShopAdmin = computed(
  () => meData.value?.permissions?.canAccessShopAdmin ?? false,
);

watch(error, (newError) => {
  if (newError?.statusCode === 401) {
    navigateTo("/?login=required");
  }
});

const actionError = ref("");
const actionSuccess = ref("");

function onUpdated(fresh: OrderListItem) {
  orderData.value = fresh;
}

function onSuccess(message: string) {
  actionSuccess.value = message;
  actionError.value = "";
}

function onError(message: string) {
  actionError.value = message;
  actionSuccess.value = "";
}
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-4xl mx-auto flex flex-col gap-6">
      <NuxtLink
        to="/internal/orders"
        class="text-sm text-zinc-400 hover:text-amber-200 transition-colors w-fit"
      >
        ← All orders
      </NuxtLink>

      <div v-if="pending" class="text-sm text-zinc-500">Loading order...</div>

      <div
        v-else-if="error"
        class="border border-red-800 bg-red-900/20 p-6 text-sm text-red-300"
      >
        {{ error?.statusCode === 404 ? `Order #${orderId} not found.` : "Failed to load order." }}
      </div>

      <template v-else-if="orderData">
        <h1 class="text-3xl font-bold text-white tracking-tight">
          Order #{{ orderData.order.id }}
        </h1>

        <p v-if="actionError" class="text-sm text-red-300">
          <InternalLinkifyText :text="actionError" />
        </p>
        <p v-if="actionSuccess" class="text-sm text-emerald-300">
          <InternalLinkifyText :text="actionSuccess" />
        </p>

        <InternalOrderCard
          :row="orderData"
          :can-see-pii="canSeePii"
          :can-access-shop-admin="canAccessShopAdmin"
          :heading-link="false"
          @updated="onUpdated"
          @success="onSuccess"
          @error="onError"
        />
      </template>
    </div>
  </div>
</template>
