import { eq } from "drizzle-orm"

import db from "../db"
import { internalOAuthConnectionTable } from "../db/schema"
import { getRedis } from "./redis"
import { HCB_URL } from "./api-urls"

const HCB_API_BASE_URL = `${HCB_URL}/api/v4`
const HCB_GRANTS_CONNECTION_PROVIDER = "hcb_grants"

type HcbScalar = boolean | number | string
type HcbQueryValue = HcbScalar | HcbScalar[] | null | undefined

export type HcbExpand = string | string[]
export type HcbJsonObject = Record<string, unknown>
export type HcbMultipartValue =
  | HcbScalar
  | Blob
  | HcbMultipartValue[]
  | { [key: string]: HcbMultipartValue }
  | null
  | undefined

export interface HcbErrorResponse {
  error?: string
  messages?: string[]
  [key: string]: unknown
}

interface HcbOAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  created_at?: number
}

export interface HcbPaginatedResponse<T> {
  total_count: number
  has_more: boolean
  data: T[]
}

export interface HcbUser extends HcbJsonObject {
  id: string
  avatar?: string | null
  admin?: boolean
  auditor?: boolean
  name?: string
  email?: string | null
}

export interface HcbOrganization extends HcbJsonObject {
  id: string
  name?: string
  slug?: string
  icon?: string | null
}

export interface HcbTransaction extends HcbJsonObject {
  id: string
  date?: string
  amount_cents?: number
  memo?: string
  pending?: boolean
  missing_receipt?: boolean
  code?: string
}

export interface HcbCardGrant extends HcbJsonObject {
  id: string
  amount_cents?: number
  balance_cents?: number
  purpose?: string
  status?: string
  email?: string | null
  expires_on?: string | null
  card_id?: string | null
  // Required on every Macondo grant card; re-verified after each send/topup/reissue, drift is refused and audited.
  pre_authorization_required?: boolean
}

// API ids are prefixed (`cdg_<hashid>`) but the web route takes the bare hashid, so the prefixed id 404s.
export function hcbCardGrantWebUrl(cardGrantId: string): string {
  const underscore = cardGrantId.indexOf("_")
  const hashid =
    underscore === -1 ? cardGrantId : cardGrantId.slice(underscore + 1)
  return `${HCB_URL}/grants/${hashid}`
}

export interface HcbReceipt extends HcbJsonObject {
  id: string
  url?: string
}

export interface HcbComment extends HcbJsonObject {
  id: string
  content?: string
  admin_only?: boolean
}

export interface HcbBalancePoint {
  date: string
  amount: number
}

export interface HcbTransactionFilters {
  search?: string
  tagId?: string
  expenses?: boolean
  revenue?: boolean
  minimumAmount?: number
  maximumAmount?: number
  startDate?: string
  endDate?: string
  userId?: string
  missingReceipts?: boolean
  category?: string
  merchant?: string
  orderBy?: string
}

export interface HcbListTransactionsOptions {
  limit?: number
  after?: string
  type?: string
  expand?: HcbExpand
  filters?: HcbTransactionFilters
}

export interface HcbListCursorOptions {
  limit?: number
  after?: string
  expand?: HcbExpand
}

export interface HcbUpdateTransactionInput {
  memo: string
}

export interface HcbUpdateCardGrantInput {
  merchant_lock?: string | null
  category_lock?: string | null
  keyword_lock?: string | null
  purpose?: string
  one_time_use?: boolean
  instructions?: string
  expiration_at?: string
}

export interface HcbCreateCardGrantInput {
  amount_cents: number
  email: string
  invite_message?: string
  merchant_lock?: string | null
  category_lock?: string | null
  keyword_lock?: string | null
  purpose?: string
  one_time_use?: boolean
  pre_authorization_required?: boolean
  instructions?: string
  expiration_at?: string
  sent_by_email?: boolean
}

export interface HcbCreateDonationInput {
  amount_cents: number
  name: string
  email?: string
  anonymous?: boolean
  tax_deductible?: boolean
  fee_covered?: boolean
}

export interface HcbCreateCommentInput {
  content: string
  admin_only?: boolean
  file?: Blob
}

export interface HcbClientOptions {
  token?: string
  baseUrl?: string
}

interface HcbRequestOptions {
  method?: "DELETE" | "GET" | "PATCH" | "POST"
  query?: object
  body?: BodyInit | FormData | object | null
  token?: string
  baseUrl?: string
  forceFormData?: boolean
}

export class HcbApiError extends Error {
  status: number
  code?: string
  details?: HcbErrorResponse | string | null

  constructor(
    message: string,
    options: {
      status: number
      code?: string
      details?: HcbErrorResponse | string | null
    },
  ) {
    super(message)
    this.name = "HcbApiError"
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

let cachedOauthToken: {
  token: string
  expiresAt: number
} | null = null

type HcbOAuthConnectionInput = {
  accessToken: string
  refreshToken?: string | null
  tokenType?: string | null
  scope?: string | null
  expiresIn?: number | null
  connectedByUserId: string
  hcbUser?: HcbUser | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]"
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  )
}

function normalizeExpand(expand?: HcbExpand): string | undefined {
  if (!expand) return undefined
  return Array.isArray(expand) ? expand.join(",") : expand
}

function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: HcbQueryValue,
) {
  if (value == null) return

  if (Array.isArray(value)) {
    for (const item of value) {
      params.append(key, String(item))
    }

    return
  }

  params.append(key, String(value))
}

function buildQueryString(query?: object) {
  if (!query) return ""

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query as Record<string, HcbQueryValue>)) {
    appendQueryValue(params, key, value)
  }

  const suffix = params.toString()
  return suffix ? `?${suffix}` : ""
}

function containsBinary(value: unknown): boolean {
  if (value instanceof Blob) return true
  if (Array.isArray(value)) return value.some(containsBinary)
  if (isPlainObject(value)) {
    return Object.values(value).some(containsBinary)
  }

  return false
}

function appendFormData(
  formData: FormData,
  key: string,
  value: HcbMultipartValue,
) {
  if (value == null) return

  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormData(formData, `${key}[]`, item)
    }

    return
  }

  if (value instanceof Blob) {
    formData.append(key, value)
    return
  }

  if (isPlainObject(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      appendFormData(formData, `${key}[${nestedKey}]`, nestedValue)
    }

    return
  }

  formData.append(key, String(value))
}

function toFormData(value: HcbMultipartValue | FormData): FormData {
  if (value instanceof FormData) return value

  const formData = new FormData()

  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      appendFormData(formData, key, nestedValue as HcbMultipartValue)
    }
  }

  return formData
}

function runtimeConfigString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function tokenExpiresAt(expiresIn?: number | null) {
  return new Date(Date.now() + (expiresIn ?? 7200) * 1000) // default to a 2 hour expiry
}

async function requestHcbOAuthToken(
  baseUrl: string,
  body: URLSearchParams,
): Promise<HcbOAuthTokenResponse & { access_token: string }> {
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })
  const responseBody = await readResponseBody(response)

  if (!response.ok) {
    throw new HcbApiError(
      typeof responseBody === "string"
        ? responseBody
        : `HCB OAuth token request failed with status ${response.status}`,
      {
        status: response.status,
        details: responseBody as HcbErrorResponse | string | null,
      },
    )
  }

  const tokenResponse = responseBody as HcbOAuthTokenResponse
  if (!tokenResponse.access_token) {
    throw new Error("[hcb] HCB OAuth token response did not include an access token")
  }

  return {
    ...tokenResponse,
    access_token: tokenResponse.access_token,
  }
}

async function fetchClientCredentialsToken(baseUrl: string) {
  const runtimeConfig = useRuntimeConfig()
  const hcbApi = runtimeConfigString(runtimeConfig.hcbApi)
  const clientId = runtimeConfigString(runtimeConfig.hcbOauthUid)
  const clientSecret =
    runtimeConfigString(runtimeConfig.hcbOauthSecret) ||
    (hcbApi.startsWith("hcb_") ? "" : hcbApi)
  const scope = runtimeConfigString(runtimeConfig.hcbOauthScope)

  if (!clientId || !clientSecret) {
    throw new Error("[hcb] HCB_API_TOKEN or HCB_UID/HCB_SECRET is not configured in private runtimeConfig")
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  })

  if (scope) {
    body.set("scope", scope)
  }

  const tokenResponse = await requestHcbOAuthToken(baseUrl, body)
  const accessToken = tokenResponse.access_token
  cachedOauthToken = {
    token: accessToken,
    expiresAt: Date.now() + Math.max((tokenResponse.expires_in ?? 7200) - 60, 60) * 1000, // default 2h expiry, refresh a minute early, at least 60s
  }

  return accessToken
}

async function refreshStoredHcbOAuthConnection(refreshToken: string, baseUrl: string) {
  const runtimeConfig = useRuntimeConfig()
  const hcbApi = runtimeConfigString(runtimeConfig.hcbApi)
  const clientId = runtimeConfigString(runtimeConfig.hcbOauthUid)
  const clientSecret =
    runtimeConfigString(runtimeConfig.hcbOauthSecret) ||
    (hcbApi.startsWith("hcb_") ? "" : hcbApi)

  if (!clientId || !clientSecret) {
    throw new Error("[hcb] HCB_UID/HCB_SECRET is required to refresh the stored HCB OAuth token")
  }

  const tokenResponse = await requestHcbOAuthToken(
    baseUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  )
  await db
    .update(internalOAuthConnectionTable)
    .set({
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? refreshToken,
      token_type: tokenResponse.token_type ?? null,
      scope: tokenResponse.scope ?? null,
      expires_at: tokenExpiresAt(tokenResponse.expires_in),
      updated_at: new Date(),
    })
    .where(eq(internalOAuthConnectionTable.provider, HCB_GRANTS_CONNECTION_PROVIDER))

  return tokenResponse.access_token
}

async function resolveStoredHcbOAuthToken(baseUrl: string) {
  const [connection] = await db
    .select()
    .from(internalOAuthConnectionTable)
    .where(eq(internalOAuthConnectionTable.provider, HCB_GRANTS_CONNECTION_PROVIDER))
    .limit(1)

  if (!connection) return null

  const expiresAt = connection.expires_at?.getTime() ?? 0
  const needsRefresh = expiresAt > 0 && expiresAt - 60_000 <= Date.now() // refresh a minute before expiry

  if (!needsRefresh) {
    return connection.access_token
  }

  if (!connection.refresh_token) {
    throw new Error("[hcb] Stored HCB OAuth token is expired and does not have a refresh token. Reconnect HCB in /internal/hcb.")
  }

  return await refreshStoredHcbOAuthConnection(connection.refresh_token, baseUrl)
}

async function resolveHcbToken(token?: string, baseUrl = HCB_API_BASE_URL) {
  if (token) return token

  const storedToken = await resolveStoredHcbOAuthToken(baseUrl)
  if (storedToken) {
    return storedToken
  }

  const runtimeConfig = useRuntimeConfig()
  const hcbApi = runtimeConfigString(runtimeConfig.hcbApi)
  const runtimeToken =
    runtimeConfigString(runtimeConfig.hcbApiToken) ||
    (hcbApi.startsWith("hcb_") ? hcbApi : "")

  if (runtimeToken) {
    return runtimeToken
  }

  if (cachedOauthToken && cachedOauthToken.expiresAt > Date.now()) {
    return cachedOauthToken.token
  }

  return await fetchClientCredentialsToken(baseUrl)
}

export async function saveHcbOAuthConnection(input: HcbOAuthConnectionInput) {
  const now = new Date()
  const hcbUser = input.hcbUser ?? null

  await db
    .insert(internalOAuthConnectionTable)
    .values({
      provider: HCB_GRANTS_CONNECTION_PROVIDER,
      access_token: input.accessToken,
      refresh_token: input.refreshToken ?? null,
      token_type: input.tokenType ?? null,
      scope: input.scope ?? null,
      expires_at: tokenExpiresAt(input.expiresIn),
      connected_by_user_id: input.connectedByUserId,
      external_user_id: hcbUser?.id ?? null,
      external_user_email: hcbUser?.email ?? null,
      metadata: hcbUser ? { hcbUser } : {},
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: internalOAuthConnectionTable.provider,
      set: {
        access_token: input.accessToken,
        refresh_token: input.refreshToken ?? null,
        token_type: input.tokenType ?? null,
        scope: input.scope ?? null,
        expires_at: tokenExpiresAt(input.expiresIn),
        connected_by_user_id: input.connectedByUserId,
        external_user_id: hcbUser?.id ?? null,
        external_user_email: hcbUser?.email ?? null,
        metadata: hcbUser ? { hcbUser } : {},
        updated_at: now,
      },
    })
}

export async function deleteHcbOAuthConnection() {
  await db
    .delete(internalOAuthConnectionTable)
    .where(eq(internalOAuthConnectionTable.provider, HCB_GRANTS_CONNECTION_PROVIDER))
}

function buildTransactionQuery(
  options?: HcbListTransactionsOptions,
): Record<string, HcbQueryValue> {
  return {
    limit: options?.limit,
    after: options?.after,
    type: options?.type,
    expand: normalizeExpand(options?.expand),
    "filters[search]": options?.filters?.search,
    "filters[tag_id]": options?.filters?.tagId,
    "filters[expenses]": options?.filters?.expenses,
    "filters[revenue]": options?.filters?.revenue,
    "filters[minimum_amount]": options?.filters?.minimumAmount,
    "filters[maximum_amount]": options?.filters?.maximumAmount,
    "filters[start_date]": options?.filters?.startDate,
    "filters[end_date]": options?.filters?.endDate,
    "filters[user_id]": options?.filters?.userId,
    "filters[missing_receipts]": options?.filters?.missingReceipts,
    "filters[category]": options?.filters?.category,
    "filters[merchant]": options?.filters?.merchant,
    "filters[order_by]": options?.filters?.orderBy,
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null

  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    return await response.json()
  }

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function hcbRequest<T>(
  path: string,
  options: HcbRequestOptions = {},
): Promise<T> {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${await resolveHcbToken(options.token, options.baseUrl ?? HCB_API_BASE_URL)}`,
  })

  let body: BodyInit | undefined

  if (options.body != null) {
    if (options.body instanceof FormData) {
      body = options.body
    } else if (options.forceFormData || containsBinary(options.body)) {
      body = toFormData(options.body as HcbMultipartValue)
    } else if (isBodyInit(options.body)) {
      body = options.body
    } else {
      headers.set("Content-Type", "application/json")
      body = JSON.stringify(options.body)
    }
  }

  const response = await fetch(`${options.baseUrl ?? HCB_API_BASE_URL}${path}${buildQueryString(options.query)}`, {
    method: options.method ?? "GET",
    headers,
    body,
  })

  const responseBody = await readResponseBody(response)

  if (!response.ok) {
    const errorBody =
      typeof responseBody === "string" || responseBody == null
        ? responseBody
        : (responseBody as HcbErrorResponse)

    const code =
      typeof errorBody === "string" || errorBody == null
        ? undefined
        : errorBody.error
    const message =
      typeof errorBody === "string"
        ? errorBody
        : [
            code,
            ...(errorBody?.messages ?? []),
          ].filter(Boolean).join(": ") ||
          `HCB request failed with status ${response.status}`

    throw new HcbApiError(message, {
      status: response.status,
      code,
      details: errorBody,
    })
  }

  return responseBody as T
}

// Lives here, not in shop.ts, so the client can invalidate it without a circular import.
export function hcbGrantInfoCacheKey(cardGrantId: string): string {
  return `hcb:grant-info:${cardGrantId}`
}

// Best-effort: a Redis outage must never fail an HCB mutation that already succeeded.
export async function invalidateHcbGrantInfoCache(
  cardGrantId: string,
): Promise<void> {
  try {
    const redis = await getRedis()
    if (redis) await redis.del(hcbGrantInfoCacheKey(cardGrantId))
  } catch (error) {
    console.warn("[hcb] grant-info cache invalidation failed", error)
  }
}

export function createHcbClient(options: HcbClientOptions = {}) {
  const request = <T>(
    path: string,
    requestOptions: Omit<HcbRequestOptions, "baseUrl" | "token"> = {},
  ) =>
    hcbRequest<T>(path, {
      ...requestOptions,
      baseUrl: options.baseUrl,
      token: options.token,
    })

  // Drops the cached grant-info snapshot so internal pages don't show pre-mutation state.
  const mutateCardGrant = async (
    cardGrantId: string,
    path: string,
    requestOptions: Omit<HcbRequestOptions, "baseUrl" | "token"> = {},
  ) => {
    const grant = await request<HcbCardGrant>(path, requestOptions)
    await invalidateHcbGrantInfoCache(cardGrantId)
    return grant
  }

  return {
    request,

    getCurrentUser: (expand?: HcbExpand) =>
      request<HcbUser>("/user", {
        query: { expand: normalizeExpand(expand) },
      }),

    getUser: (userId: string, expand?: HcbExpand) =>
      request<HcbUser>(`/users/${userId}`, {
        query: { expand: normalizeExpand(expand) },
      }),

    getUserByEmail: (email: string, expand?: HcbExpand) =>
      request<HcbUser>(`/users/by_email/${encodeURIComponent(email)}`, {
        query: { expand: normalizeExpand(expand) },
      }),

    getOrganization: (organizationId: string, expand?: HcbExpand) =>
      request<HcbOrganization>(`/organizations/${organizationId}`, {
        query: { expand: normalizeExpand(expand) },
      }),

    getBalanceByDate: (organizationId: string) =>
      request<HcbBalancePoint[]>(`/organizations/${organizationId}/balance_by_date`),

    listOrganizationTransactions: (
      organizationId: string,
      options?: HcbListTransactionsOptions,
    ) =>
      request<HcbPaginatedResponse<HcbTransaction>>(
        `/organizations/${organizationId}/transactions`,
        {
          query: buildTransactionQuery(options),
        },
      ),

    getOrganizationTransaction: (
      organizationId: string,
      transactionId: string,
      expand?: HcbExpand,
    ) =>
      request<HcbTransaction>(
        `/organizations/${organizationId}/transactions/${transactionId}`,
        {
          query: { expand: normalizeExpand(expand) },
        },
      ),

    updateOrganizationTransaction: (
      organizationId: string,
      transactionId: string,
      body: HcbUpdateTransactionInput,
    ) =>
      request<HcbTransaction>(
        `/organizations/${organizationId}/transactions/${transactionId}`,
        {
          method: "PATCH",
          body,
        },
      ),

    listTransactionReceipts: (
      organizationId: string,
      transactionId: string,
    ) =>
      request<HcbReceipt[]>(
        `/organizations/${organizationId}/transactions/${transactionId}/receipts`,
      ),

    createTransactionComment: (
      organizationId: string,
      transactionId: string,
      body: FormData | HcbCreateCommentInput,
    ) =>
      request<HcbComment>(
        `/organizations/${organizationId}/transactions/${transactionId}/comments`,
        {
          method: "POST",
          body,
          forceFormData: true,
        },
      ),
    
    getCardGrant: (cardGrantId: string, expand?: HcbExpand) =>
      request<HcbCardGrant>(`/card_grants/${cardGrantId}`, {
        query: { expand: normalizeExpand(expand) },
      }),

    updateCardGrant: (cardGrantId: string, body: HcbUpdateCardGrantInput) =>
      mutateCardGrant(cardGrantId, `/card_grants/${cardGrantId}`, {
        method: "PATCH",
        body,
      }),

    activateCardGrant: (cardGrantId: string) =>
      mutateCardGrant(cardGrantId, `/card_grants/${cardGrantId}/activate`, {
        method: "POST",
      }),

    topUpCardGrant: (cardGrantId: string, amountCents: number) =>
      mutateCardGrant(cardGrantId, `/card_grants/${cardGrantId}/topup`, {
        method: "POST",
        body: { amount_cents: amountCents },
      }),

    withdrawCardGrant: (cardGrantId: string, amountCents: number) =>
      mutateCardGrant(cardGrantId, `/card_grants/${cardGrantId}/withdraw`, {
        method: "POST",
        body: { amount_cents: amountCents },
      }),

    cancelCardGrant: (cardGrantId: string) =>
      mutateCardGrant(cardGrantId, `/card_grants/${cardGrantId}/cancel`, {
        method: "POST",
      }),

    listCardGrantTransactions: (
      cardGrantId: string,
      options?: HcbListCursorOptions,
    ) =>
      request<HcbPaginatedResponse<HcbTransaction>>(
        `/card_grants/${cardGrantId}/transactions`,
        {
          query: {
            limit: options?.limit,
            after: options?.after,
            expand: normalizeExpand(options?.expand),
          },
        },
      ),

    listOrganizationCardGrants: (organizationId: string, expand?: HcbExpand) =>
      request<HcbCardGrant[]>(`/organizations/${organizationId}/card_grants`, {
        query: { expand: normalizeExpand(expand) },
      }),

    createOrganizationCardGrant: (
      organizationId: string,
      body: HcbCreateCardGrantInput,
    ) =>
      request<HcbCardGrant[]>(`/organizations/${organizationId}/card_grants`, {
        method: "POST",
        body,
      }),

    createDonation: (
      organizationId: string,
      body: HcbCreateDonationInput,
    ) =>
      request<HcbJsonObject>(`/organizations/${organizationId}/donations`, {
        method: "POST",
        body,
      }),
  }
}
