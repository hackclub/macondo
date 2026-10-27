<script setup lang="ts">
import { useAlertDialog } from "~/composables/useAlertDialog";

definePageMeta({ layout: "internal" });

type CertRow = {
  id: string;
  code: string;
  user_id: string;
  username: string | null;
  recipient_name: string;
  hours_at_issue: number | string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  issuer_id: string | null;
};

const { showAlert, showPrompt } = useAlertDialog();

const { data, pending, refresh, error } = await useFetch<{
  certificates: CertRow[];
}>("/api/internal/certificates");
const certs = computed(() => data.value?.certificates ?? []);

const issueUserId = ref("");
const issueName = ref("");
const issuing = ref(false);
const actionMessage = ref<string | null>(null);
const revokingId = ref<string | null>(null);

function getErrorMessage(e: unknown, fallback: string): string {
  const err = e as { data?: { statusMessage?: string }; message?: string };
  return err?.data?.statusMessage || err?.message || fallback;
}
function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleString() : "—";
}

async function issueCert() {
  const uid = issueUserId.value.trim();
  if (!uid || issuing.value) return;
  issuing.value = true;
  actionMessage.value = null;
  try {
    const res = await $fetch<{
      ok: boolean;
      already: boolean;
      certificate: { code: string };
    }>("/api/internal/certificates/issue", {
      method: "POST",
      body: { user_id: uid, recipient_name: issueName.value.trim() || undefined },
    });
    actionMessage.value = res.already
      ? `User already has an active certificate (${res.certificate.code}).`
      : `Issued certificate ${res.certificate.code}.`;
    issueUserId.value = "";
    issueName.value = "";
    await refresh();
  } catch (e) {
    await showAlert({
      title: "Failed to issue",
      message: getErrorMessage(e, "Failed to issue certificate."),
      tone: "error",
    });
  } finally {
    issuing.value = false;
  }
}

async function revokeCert(row: CertRow) {
  if (revokingId.value) return;
  const reason = await showPrompt({
    title: "Revoke certificate?",
    message: `This invalidates certificate ${row.code} for ${row.username ?? row.user_id}. Anyone verifying it will see it as revoked. The maker can be re-issued one later. Write the reason for the audit log.`,
    placeholder: "e.g. Issued in error / fraud",
    required: true,
    confirmLabel: "Revoke",
    tone: "warning",
    destructive: true,
  });
  const trimmed = reason?.trim();
  if (!trimmed) return;
  revokingId.value = row.id;
  actionMessage.value = null;
  try {
    await $fetch(`/api/internal/certificates/${row.id}/revoke`, {
      method: "POST",
      body: { reason: trimmed },
    });
    actionMessage.value = `Revoked certificate ${row.code}.`;
    await refresh();
  } catch (e) {
    await showAlert({
      title: "Failed to revoke",
      message: getErrorMessage(e, "Failed to revoke certificate."),
      tone: "error",
    });
  } finally {
    revokingId.value = null;
  }
}
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-7xl mx-auto flex flex-col gap-6">
      <div class="flex flex-col gap-1">
        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Certificates</p>
        <h1 class="text-3xl font-bold text-white tracking-tight">Certificate management</h1>
        <p class="text-sm text-zinc-400">
          Supaadmin-only. Issue or revoke Macondo certificates. Most recent first.
        </p>
      </div>

      <div
        v-if="actionMessage"
        class="border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm"
      >
        {{ actionMessage }}
      </div>

      <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Issue manually</p>
        <div class="flex flex-col sm:flex-row gap-3">
          <input
            v-model="issueUserId"
            type="text"
            placeholder="User ID"
            class="flex-1 bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          >
          <input
            v-model="issueName"
            type="text"
            placeholder="Name on certificate (optional)"
            class="flex-1 bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          >
          <button
            type="button"
            :disabled="issuing || !issueUserId.trim()"
            class="bg-white hover:bg-zinc-200 disabled:opacity-50 text-black text-sm font-medium px-4 py-2 transition-colors"
            @click="issueCert"
          >
            {{ issuing ? "Issuing…" : "Issue" }}
          </button>
        </div>
        <p class="text-xs text-zinc-500">
          Bypasses the event-invite gate. Leave the name blank to use the maker's name on file.
        </p>
      </div>

      <div
        v-if="error"
        class="border border-rose-500/30 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm"
      >
        Failed to load certificates.
      </div>

      <div class="border border-zinc-800 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-zinc-500 text-xs uppercase tracking-widest">
              <th class="px-3 py-2 font-bold">Code</th>
              <th class="px-3 py-2 font-bold">Recipient</th>
              <th class="px-3 py-2 font-bold">User</th>
              <th class="px-3 py-2 font-bold">Hours</th>
              <th class="px-3 py-2 font-bold">Issued</th>
              <th class="px-3 py-2 font-bold">Status</th>
              <th class="px-3 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="pending">
              <td colspan="7" class="px-3 py-6 text-center text-zinc-500">Loading…</td>
            </tr>
            <tr v-else-if="certs.length === 0">
              <td colspan="7" class="px-3 py-6 text-center text-zinc-500">
                No certificates issued yet.
              </td>
            </tr>
            <tr
              v-for="row in certs"
              :key="row.id"
              class="border-t border-zinc-800 hover:bg-black/20"
            >
              <td class="px-3 py-2 font-mono text-zinc-200">{{ row.code }}</td>
              <td class="px-3 py-2 text-white">{{ row.recipient_name }}</td>
              <td class="px-3 py-2 text-zinc-400">{{ row.username ?? row.user_id }}</td>
              <td class="px-3 py-2 text-zinc-300 tabular-nums">{{ row.hours_at_issue }}</td>
              <td class="px-3 py-2 text-zinc-400">{{ fmtDate(row.issued_at) }}</td>
              <td class="px-3 py-2">
                <span
                  v-if="row.revoked_at"
                  class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-rose-500/30 bg-rose-500/10 text-rose-300"
                >Revoked</span>
                <span
                  v-else
                  class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                >Valid</span>
              </td>
              <td class="px-3 py-2 text-right whitespace-nowrap">
                <a
                  :href="`/certificate/${row.code}`"
                  target="_blank"
                  class="text-xs text-zinc-400 hover:text-white underline mr-3"
                >View</a>
                <button
                  v-if="!row.revoked_at"
                  type="button"
                  :disabled="revokingId === row.id"
                  class="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
                  @click="revokeCert(row)"
                >
                  {{ revokingId === row.id ? "Revoking…" : "Revoke" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
