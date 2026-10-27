<script setup lang="ts">
const isOpen = ref(false);
const { user } = useAuth();

const internalRoles = ["supaadmin", "admin", "software_reviewer", "hardware_reviewer", "fulfiller", "hq", "fraudster", "support"];
const hasAccess = computed(
    () =>
        (user.value?.roles as string[] | null)?.some((r) =>
            internalRoles.includes(r),
        ) ?? false,
);

// stats is admin-only; sending other roles there just bounces them through the auth middleware
const popupTarget = computed<string>(() => {
    const roles = (user.value?.roles as string[] | null) ?? [];
    if (roles.some((r) => ["supaadmin", "admin"].includes(r))) return "/internal/stats";
    if (roles.includes("fulfiller")) return "/internal/orders";
    if (roles.includes("support")) return "/internal/support";
    return "/internal/dashboard";
});

const buildLabel = import.meta.dev ? "dev" : "prod";
</script>

<template>
    <div
        class="internal-popup fixed bottom-[5rem] md:bottom-[6rem] right-6 z-[100] flex flex-col items-end gap-3 pointer-events-auto"
    >
        <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 translate-y-4 scale-95"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0 scale-100"
            leave-to-class="opacity-0 translate-y-4 scale-95"
        >
            <div
                v-if="isOpen"
                class="bg-zinc-950 border border-white/10 p-5 shadow-2xl min-w-[240px] flex flex-col gap-5 relative"
            >
                <div
                    class="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-white/30"
                />
                <div
                    class="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-white/30"
                />
                <div
                    class="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-white/30"
                />
                <div
                    class="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-white/30"
                />

                <div
                    class="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style="
                        background-image:
                            linear-gradient(
                                to right,
                                #fff 1px,
                                transparent 1px
                            ),
                            linear-gradient(
                                to bottom,
                                #fff 1px,
                                transparent 1px
                            );
                        background-size: 20px 20px;
                    "
                />
                <div
                    class="absolute inset-0 pointer-events-none overflow-hidden"
                >
                    <div
                        class="absolute top-4 left-10 w-5 h-5 bg-white opacity-[0.02]"
                    />
                    <div
                        class="absolute bottom-12 right-4 w-5 h-5 bg-white opacity-[0.03]"
                    />
                    <div
                        class="absolute top-20 right-20 w-5 h-5 bg-white opacity-[0.01]"
                    />
                </div>

                <div class="relative z-10 flex flex-col gap-5">
                    <div
                        class="flex flex-col gap-1 border-b border-white/5 pb-3"
                    >
                        <span
                            class="text-[10px] font-bold text-zinc-500 underline decoration-white/10 underline-offset-4"
                            >Build</span
                        >
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-zinc-100"
                                >{{ buildLabel }}</span
                            >
                            <span class="text-[10px] text-zinc-600">
                                Internal
                            </span>
                        </div>
                    </div>

                    <NuxtLink
                        :to="popupTarget"
                        class="mt-1 bg-white hover:bg-zinc-200 text-black border border-white/10 px-3 py-2 text-[10px] font-bold text-center transition-all"
                    >
                        Open in Internal
                    </NuxtLink>
                </div>
            </div>
        </Transition>

        <button
            v-if="hasAccess"
            class="w-12 h-12 md:w-16 md:h-16 bg-black hover:bg-zinc-950 border border-white/5 flex items-center justify-center font-bold text-white transition-all shadow-xl active:scale-95 relative overflow-hidden"
            @click="isOpen = !isOpen"
        >
            <div
                class="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/40"
            />
            <div
                class="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/40"
            />
            <div
                class="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/40"
            />
            <div
                class="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/40"
            />

            <span class="relative z-10 text-sm md:text-base">{{ isOpen ? "✕" : ":3c" }}</span>
        </button>
    </div>
</template>

<style>
.internal-popup,
.internal-popup *,
.internal-popup *::before,
.internal-popup *::after {
  font-family: 'Inter', sans-serif !important;
}
</style>
