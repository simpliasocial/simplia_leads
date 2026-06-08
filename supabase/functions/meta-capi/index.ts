/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SupabaseClient = ReturnType<typeof createClient>;
type UnknownRecord = Record<string, any>;

type AuthContext = {
    userId: string;
    role: string;
};

type MetaCapiConfigRow = {
    id: string;
    account_id: number;
    graph_version: string;
    dataset_id: string;
    access_token: string;
    token_last_four: string;
    event_source_url: string;
    event_name: string;
    source: string;
    system_name: string;
    appointment_status: string;
    action_source: string;
    default_channel: string;
    client_user_agent: string;
    test_event_code: string;
    enabled: boolean;
    configured_by?: string | null;
    configured_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

type MetaEventInput = {
    accountId: number;
    eventKind: "appointment" | "sale" | "test";
    conversationId: string;
    meetingId: string;
    eventName?: string;
    eventId?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    channel?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    value?: number;
    currency?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
    fbc?: string;
    fbp?: string;
    eventTime?: number;
};

const DEFAULT_PUBLIC_CONFIG = {
    accountId: 0,
    graphVersion: "v20.0",
    datasetId: "",
    tokenLastFour: "",
    hasAccessToken: false,
    eventSourceUrl: "",
    eventName: "Schedule",
    source: "chatwoot",
    systemName: "Simplia Leads",
    appointmentStatus: "scheduled",
    actionSource: "website",
    defaultChannel: "whatsapp",
    clientUserAgent: "Mozilla/5.0",
    testEventCode: "",
    enabled: true,
    configuredAt: null,
    updatedAt: null,
};

const cleanText = (value: unknown) => String(value ?? "").trim();

const asObject = (value: unknown): UnknownRecord =>
    value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};

const errorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const jsonResponse = (payload: Record<string, unknown>, init?: ResponseInit) =>
    new Response(JSON.stringify(payload), {
        ...init,
        headers: { ...corsHeaders, "Content-Type": "application/json", ...(init?.headers || {}) },
    });

const normalize = (value: unknown) =>
    cleanText(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

const normalizeVersion = (value: unknown) => {
    const raw = cleanText(value || "v20.0");
    return raw.startsWith("v") ? raw : `v${raw}`;
};

const parseAccountId = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseEventTime = (value: unknown) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed < 10000000000 ? Math.floor(parsed) : Math.floor(parsed / 1000);
    }
    return Math.floor(Date.now() / 1000);
};

const parseNumber = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    const parsed = Number.parseFloat(cleanText(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
};

const getServiceRoleKey = () => {
    const explicit = cleanText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (explicit) return explicit;

    const secretKeys = cleanText(Deno.env.get("SUPABASE_SECRET_KEYS"));
    if (!secretKeys) return "";

    try {
        const parsed = JSON.parse(secretKeys);
        return cleanText(parsed.default || Object.values(parsed)[0]);
    } catch {
        return "";
    }
};

const getAuthContext = async (supabase: SupabaseClient, authHeader: string | null): Promise<AuthContext | null> => {
    const jwt = cleanText(authHeader).replace(/^Bearer\s+/i, "");
    if (!jwt) return null;

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return null;

    const { data, error } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

    if (error) return null;
    const role = cleanText((data as { role?: unknown } | null)?.role);
    return role ? { userId: userData.user.id, role } : null;
};

const canConfigure = (role: string) => role === "platform_admin";

const canSendEvent = (role: string) =>
    role === "platform_admin" || role === "company_admin" || role === "operator";

const toPublicConfig = (row?: MetaCapiConfigRow | null) => {
    if (!row) return { ...DEFAULT_PUBLIC_CONFIG };

    return {
        accountId: parseAccountId(row.account_id),
        graphVersion: row.graph_version,
        datasetId: row.dataset_id,
        tokenLastFour: row.token_last_four,
        hasAccessToken: Boolean(row.access_token),
        eventSourceUrl: row.event_source_url,
        eventName: row.event_name,
        source: row.source,
        systemName: row.system_name,
        appointmentStatus: row.appointment_status,
        actionSource: row.action_source,
        defaultChannel: row.default_channel,
        clientUserAgent: row.client_user_agent,
        testEventCode: row.test_event_code,
        enabled: row.enabled,
        configuredAt: row.configured_at || null,
        updatedAt: row.updated_at || null,
    };
};

const loadConfig = async (supabase: SupabaseClient, accountId: number) => {
    const queryConfig = async (targetAccountId: number) => {
        const { data, error } = await supabase
            .schema("cw")
            .from("meta_capi_configs")
            .select("*")
            .eq("account_id", targetAccountId)
            .maybeSingle();

        if (error) throw error;
        return data as MetaCapiConfigRow | null;
    };

    const accountConfig = await queryConfig(accountId);
    if (accountConfig || accountId === 0) return accountConfig;
    return queryConfig(0);
};

const saveConfig = async (
    supabase: SupabaseClient,
    auth: AuthContext,
    body: UnknownRecord,
) => {
    if (!canConfigure(auth.role)) {
        return jsonResponse({ ok: false, error: "No tienes permiso para configurar Meta CAPI." }, { status: 403 });
    }

    const input = asObject(body.config || body);
    const accountId = parseAccountId(input.accountId ?? input.account_id);
    const existing = await loadConfig(supabase, accountId);
    const accessTokenInput = cleanText(input.accessToken ?? input.access_token);
    const accessToken = accessTokenInput || existing?.access_token || "";

    const datasetId = cleanText(input.datasetId ?? input.dataset_id ?? existing?.dataset_id);
    const eventSourceUrl = cleanText(input.eventSourceUrl ?? input.event_source_url ?? existing?.event_source_url);

    if (!datasetId) {
        return jsonResponse({ ok: false, error: "Completa el dataset_id de Meta." }, { status: 400 });
    }
    if (!accessToken) {
        return jsonResponse({ ok: false, error: "Completa el access_token de Meta CAPI." }, { status: 400 });
    }
    if (!eventSourceUrl) {
        return jsonResponse({ ok: false, error: "Completa event_source_url." }, { status: 400 });
    }

    const row = {
        account_id: accountId,
        graph_version: normalizeVersion(input.graphVersion ?? input.graph_version ?? existing?.graph_version),
        dataset_id: datasetId,
        access_token: accessToken,
        token_last_four: accessToken.slice(-4),
        event_source_url: eventSourceUrl,
        event_name: cleanText(input.eventName ?? input.event_name ?? existing?.event_name ?? "Schedule"),
        source: cleanText(input.source ?? existing?.source ?? "chatwoot"),
        system_name: cleanText(input.systemName ?? input.system_name ?? existing?.system_name ?? "Simplia Leads"),
        appointment_status: cleanText(input.appointmentStatus ?? input.appointment_status ?? existing?.appointment_status ?? "scheduled"),
        action_source: cleanText(input.actionSource ?? input.action_source ?? existing?.action_source ?? "website"),
        default_channel: cleanText(input.defaultChannel ?? input.default_channel ?? existing?.default_channel ?? "whatsapp"),
        client_user_agent: cleanText(input.clientUserAgent ?? input.client_user_agent ?? existing?.client_user_agent ?? "Mozilla/5.0"),
        test_event_code: cleanText(input.testEventCode ?? input.test_event_code ?? existing?.test_event_code),
        enabled: input.enabled !== false,
        configured_by: auth.userId,
        configured_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .schema("cw")
        .from("meta_capi_configs")
        .upsert(row, { onConflict: "account_id" })
        .select("*")
        .single();

    if (error) throw error;
    return jsonResponse({ ok: true, config: toPublicConfig(data as MetaCapiConfigRow) });
};

const getConfig = async (
    supabase: SupabaseClient,
    auth: AuthContext,
    body: UnknownRecord,
) => {
    if (!canConfigure(auth.role)) {
        return jsonResponse({ ok: false, error: "No tienes permiso para configurar Meta CAPI." }, { status: 403 });
    }

    const accountId = parseAccountId(body.accountId ?? body.account_id);
    const config = await loadConfig(supabase, accountId);
    return jsonResponse({ ok: true, configured: Boolean(config), config: toPublicConfig(config) });
};

const removePunctuation = (value: string) =>
    normalize(value).replace(/[^a-z0-9]+/g, "");

const normalizeEmail = (value: unknown) => normalize(value);
const normalizePhone = (value: unknown) => cleanText(value).replace(/\D/g, "");
const normalizeName = (value: unknown) => removePunctuation(cleanText(value));
const normalizeExternalId = (value: unknown) => normalize(value);

const sha256Hex = async (value: string) => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

const addHashArray = async (
    target: UnknownRecord,
    key: string,
    value: string,
) => {
    if (!value) return;
    target[key] = [await sha256Hex(value)];
};

const splitName = (input: MetaEventInput) => {
    const explicitFirst = cleanText(input.firstName);
    const explicitLast = cleanText(input.lastName);
    if (explicitFirst || explicitLast) {
        return { firstName: explicitFirst, lastName: explicitLast };
    }

    const fullName = cleanText(input.name);
    if (!fullName || normalize(fullName) === "sin nombre") {
        return { firstName: "", lastName: "" };
    }

    const parts = fullName.split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" "),
    };
};

const buildUserData = async (input: MetaEventInput, config: MetaCapiConfigRow) => {
    const userData: UnknownRecord = {};
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const { firstName, lastName } = splitName(input);
    const normalizedFirstName = normalizeName(firstName);
    const normalizedLastName = normalizeName(lastName);
    const externalId = normalizeExternalId(input.conversationId);

    await addHashArray(userData, "em", email);
    await addHashArray(userData, "ph", phone);
    await addHashArray(userData, "fn", normalizedFirstName);
    await addHashArray(userData, "ln", normalizedLastName);
    await addHashArray(userData, "external_id", externalId);

    const clientIpAddress = cleanText(input.clientIpAddress);
    const clientUserAgent = cleanText(input.clientUserAgent || config.client_user_agent);
    const fbc = cleanText(input.fbc);
    const fbp = cleanText(input.fbp);

    if (clientIpAddress) userData.client_ip_address = clientIpAddress;
    if (clientUserAgent) userData.client_user_agent = clientUserAgent;
    if (fbc) userData.fbc = fbc;
    if (fbp) userData.fbp = fbp;

    return {
        userData,
        hasMatchData: Boolean(email || phone || normalizedFirstName || normalizedLastName),
    };
};

const normalizeEventIdPart = (value: unknown) =>
    normalize(value).replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "na";

const resolveEventName = (input: MetaEventInput, config: MetaCapiConfigRow) => {
    const explicit = cleanText(input.eventName);
    if (explicit) return explicit;
    if (input.eventKind === "sale") return "Purchase";
    return cleanText(config.event_name) || "Schedule";
};

const resolveEventId = (input: MetaEventInput, config: MetaCapiConfigRow, eventName: string, eventTime: number) => {
    const explicit = cleanText(input.eventId);
    if (explicit) return explicit;

    return [
        config.system_name,
        eventName,
        input.eventKind,
        input.conversationId,
        input.meetingId,
        input.appointmentDate,
        input.appointmentTime,
        eventTime,
    ]
        .map(normalizeEventIdPart)
        .join(":");
};

const buildMetaPayload = async (
    config: MetaCapiConfigRow,
    input: MetaEventInput,
) => {
    const eventName = resolveEventName(input, config);
    const eventTime = parseEventTime(input.eventTime);
    const eventId = resolveEventId(input, config, eventName, eventTime);
    const channel = cleanText(input.channel || config.default_channel);
    const currency = cleanText(input.currency || "USD") || "USD";
    const value = parseNumber(input.value);
    const { userData, hasMatchData } = await buildUserData(input, config);
    const testEventCode = cleanText(config.test_event_code);

    const customData: UnknownRecord = {
        source: cleanText(config.source),
        system: cleanText(config.system_name),
        appointment_status: cleanText(config.appointment_status),
        channel,
        appointment_date: cleanText(input.appointmentDate),
        appointment_time: cleanText(input.appointmentTime),
        conversation_id: cleanText(input.conversationId),
        meeting_id: cleanText(input.meetingId),
        event_kind: input.eventKind,
    };

    if (input.eventKind === "sale" && value !== undefined) {
        customData.value = value;
        customData.currency = currency;
    }

    const payload: UnknownRecord = {
        data: [
            {
                event_name: eventName,
                event_time: eventTime,
                action_source: cleanText(config.action_source) || "website",
                event_source_url: cleanText(config.event_source_url),
                event_id: eventId,
                user_data: userData,
                custom_data: customData,
            },
        ],
    };

    if (testEventCode) payload.test_event_code = testEventCode;

    return {
        payload,
        eventName,
        eventId,
        testMode: Boolean(testEventCode),
        hasMatchData,
    };
};

const insertAuditEvent = async (
    supabase: SupabaseClient,
    input: MetaEventInput,
    params: {
        eventName?: string;
        eventId?: string;
        status: "pending" | "success" | "error" | "skipped";
        testMode: boolean;
        requestPayload?: UnknownRecord;
        responsePayload?: UnknownRecord;
        errorMessage?: string;
        sentAt?: string | null;
    },
) => {
    const { data, error } = await supabase
        .schema("cw")
        .from("meta_capi_events")
        .insert({
            account_id: input.accountId,
            event_kind: input.eventKind,
            conversation_id: cleanText(input.conversationId) || null,
            meeting_id: cleanText(input.meetingId) || null,
            event_name: cleanText(params.eventName) || null,
            event_id: cleanText(params.eventId) || null,
            status: params.status,
            test_mode: params.testMode,
            request_payload: params.requestPayload || {},
            response_payload: params.responsePayload || {},
            error_message: params.errorMessage || null,
            sent_at: params.sentAt || null,
        })
        .select("id")
        .single();

    if (error) throw error;
    return cleanText(data?.id);
};

const updateAuditEvent = async (
    supabase: SupabaseClient,
    auditId: string,
    params: {
        status: "success" | "error";
        responsePayload?: UnknownRecord;
        errorMessage?: string;
        sentAt?: string;
    },
) => {
    const { error } = await supabase
        .schema("cw")
        .from("meta_capi_events")
        .update({
            status: params.status,
            response_payload: params.responsePayload || {},
            error_message: params.errorMessage || null,
            sent_at: params.sentAt || new Date().toISOString(),
        })
        .eq("id", auditId);

    if (error) throw error;
};

const extractEventInput = (body: UnknownRecord): MetaEventInput => {
    const rawInput = asObject(body.event || body.payload || body);
    const userData = asObject(rawInput.userData || rawInput.user_data);
    const eventKindValue = cleanText(rawInput.eventKind ?? rawInput.event_kind);
    const eventKind = eventKindValue === "sale" || eventKindValue === "test" ? eventKindValue : "appointment";

    return {
        accountId: parseAccountId(rawInput.accountId ?? rawInput.account_id),
        eventKind,
        conversationId: cleanText(rawInput.conversationId ?? rawInput.conversation_id),
        meetingId: cleanText(rawInput.meetingId ?? rawInput.meeting_id),
        eventName: cleanText(rawInput.eventName ?? rawInput.event_name),
        eventId: cleanText(rawInput.eventId ?? rawInput.event_id),
        name: cleanText(rawInput.name ?? rawInput.fullName ?? rawInput.full_name ?? userData.name),
        firstName: cleanText(rawInput.firstName ?? rawInput.first_name ?? userData.firstName ?? userData.first_name),
        lastName: cleanText(rawInput.lastName ?? rawInput.last_name ?? userData.lastName ?? userData.last_name),
        email: cleanText(rawInput.email ?? userData.email),
        phone: cleanText(rawInput.phone ?? rawInput.celular ?? userData.phone),
        channel: cleanText(rawInput.channel),
        appointmentDate: cleanText(rawInput.appointmentDate ?? rawInput.appointment_date),
        appointmentTime: cleanText(rawInput.appointmentTime ?? rawInput.appointment_time),
        value: parseNumber(rawInput.value),
        currency: cleanText(rawInput.currency || "USD"),
        clientIpAddress: cleanText(rawInput.clientIpAddress ?? rawInput.client_ip_address ?? userData.client_ip_address),
        clientUserAgent: cleanText(rawInput.clientUserAgent ?? rawInput.client_user_agent ?? userData.client_user_agent),
        fbc: cleanText(rawInput.fbc ?? userData.fbc),
        fbp: cleanText(rawInput.fbp ?? userData.fbp),
        eventTime: parseNumber(rawInput.eventTime ?? rawInput.event_time),
    };
};

const buildTestInput = (body: UnknownRecord): MetaEventInput => {
    const rawInput = asObject(body.event || body.payload || body);
    const timestamp = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    return {
        accountId: parseAccountId(rawInput.accountId ?? rawInput.account_id),
        eventKind: "test",
        conversationId: cleanText(rawInput.conversationId ?? rawInput.conversation_id) || `test-${timestamp}`,
        meetingId: cleanText(rawInput.meetingId ?? rawInput.meeting_id) || `test-${timestamp}`,
        eventName: cleanText(rawInput.eventName ?? rawInput.event_name),
        eventId: cleanText(rawInput.eventId ?? rawInput.event_id) || `test-${timestamp}`,
        name: cleanText(rawInput.name) || "Cliente Test Simplia",
        email: cleanText(rawInput.email) || "test@simplia.local",
        phone: cleanText(rawInput.phone) || "593999999999",
        channel: cleanText(rawInput.channel) || "whatsapp",
        appointmentDate: cleanText(rawInput.appointmentDate ?? rawInput.appointment_date) || today,
        appointmentTime: cleanText(rawInput.appointmentTime ?? rawInput.appointment_time) || "10:00",
        eventTime: Math.floor(timestamp / 1000),
    };
};

const markSkipped = async (
    supabase: SupabaseClient,
    input: MetaEventInput,
    message: string,
    params?: {
        eventName?: string;
        eventId?: string;
        testMode?: boolean;
        requestPayload?: UnknownRecord;
    },
) => {
    const auditId = await insertAuditEvent(supabase, input, {
        eventName: params?.eventName,
        eventId: params?.eventId,
        status: "skipped",
        testMode: params?.testMode === true,
        requestPayload: params?.requestPayload || {},
        errorMessage: message.slice(0, 700),
    });

    return jsonResponse({
        ok: true,
        status: "skipped",
        auditId,
        message,
    });
};

const sendEvent = async (
    supabase: SupabaseClient,
    auth: AuthContext,
    body: UnknownRecord,
    forceTest = false,
) => {
    if (forceTest && !canConfigure(auth.role)) {
        return jsonResponse({ ok: false, error: "No tienes permiso para probar Meta CAPI." }, { status: 403 });
    }

    if (!canSendEvent(auth.role)) {
        return jsonResponse({ ok: false, error: "No tienes permiso para enviar eventos Meta CAPI." }, { status: 403 });
    }

    const input = forceTest ? buildTestInput(body) : extractEventInput(body);
    const config = await loadConfig(supabase, input.accountId);
    if (!config) {
        return markSkipped(supabase, input, "Meta CAPI no esta configurado para esta cuenta.");
    }
    input.accountId = parseAccountId(config.account_id);

    if (!config.enabled) {
        return markSkipped(supabase, input, "Meta CAPI esta desactivado.", { testMode: Boolean(config.test_event_code) });
    }

    if (forceTest && !cleanText(config.test_event_code)) {
        return markSkipped(supabase, input, "Configura test_event_code antes de enviar una prueba CAPI.");
    }

    const built = await buildMetaPayload(config, input);
    if (!built.hasMatchData) {
        return markSkipped(supabase, input, "No se envio Meta CAPI porque el lead no tiene email, telefono o nombre suficiente.", {
            eventName: built.eventName,
            eventId: built.eventId,
            testMode: built.testMode,
            requestPayload: built.payload,
        });
    }

    const auditId = await insertAuditEvent(supabase, input, {
        eventName: built.eventName,
        eventId: built.eventId,
        status: "pending",
        testMode: built.testMode,
        requestPayload: built.payload,
    });

    const graphVersion = normalizeVersion(config.graph_version);
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(config.dataset_id)}/events`);
    url.searchParams.set("access_token", config.access_token);

    try {
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(built.payload),
        });

        const responseText = await response.text();
        let responsePayload: UnknownRecord = {};
        try {
            responsePayload = responseText ? JSON.parse(responseText) : {};
        } catch {
            responsePayload = { raw: responseText };
        }

        if (!response.ok) {
            const message = `Meta CAPI fallo: ${response.status} ${responseText.slice(0, 700)}`;
            await updateAuditEvent(supabase, auditId, {
                status: "error",
                responsePayload,
                errorMessage: message,
            });
            return jsonResponse({
                ok: false,
                status: "error",
                auditId,
                error: message,
            });
        }

        await updateAuditEvent(supabase, auditId, {
            status: "success",
            responsePayload,
        });

        return jsonResponse({
            ok: true,
            status: "success",
            auditId,
            eventId: built.eventId,
            eventName: built.eventName,
            testMode: built.testMode,
            response: responsePayload,
        });
    } catch (sendError) {
        const message = errorMessage(sendError).slice(0, 700);
        await updateAuditEvent(supabase, auditId, {
            status: "error",
            responsePayload: {},
            errorMessage: message,
        });
        return jsonResponse({
            ok: false,
            status: "error",
            auditId,
            error: message,
        });
    }
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceRoleKey = getServiceRoleKey();
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error("Missing Supabase service role environment variables.");
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
        const auth = await getAuthContext(supabase, req.headers.get("Authorization"));
        if (!auth) return jsonResponse({ ok: false, error: "No autenticado." }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const action = cleanText(body.action || "send_event");

        if (action === "get_config") return getConfig(supabase, auth, body);
        if (action === "save_config") return saveConfig(supabase, auth, body);
        if (action === "test_event") return sendEvent(supabase, auth, body, true);
        if (action === "send_event") return sendEvent(supabase, auth, body);

        return jsonResponse({ ok: false, error: `Accion Meta CAPI no soportada: ${action}` }, { status: 400 });
    } catch (error) {
        return jsonResponse({
            ok: false,
            error: errorMessage(error),
        }, { status: 500 });
    }
});
