/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CHATWOOT_PAGES = 200;

const toIso = (value: unknown) => {
    if (!value) return null;
    const n = Number(value);
    const date = Number.isNaN(n)
        ? new Date(String(value))
        : new Date(n < 10000000000 ? n * 1000 : n);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseNumber = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isNaN(value) ? null : value;
    const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
};

const errorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const asObject = (value: unknown): Record<string, any> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, any>
        : {};

const normalizeText = (value: unknown) =>
    String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

const CHANNEL_ALIAS_LABELS: Array<{ label: string; tokens: string[] }> = [
    { label: "WhatsApp", tokens: ["whatsapp", "whats app", "wa.me"] },
    { label: "Instagram", tokens: ["instagram"] },
    { label: "Facebook", tokens: ["facebook", "messenger"] },
    { label: "Telegram", tokens: ["telegram", "t.me", "tg://", "cwcloudbot_bot"] },
    { label: "TikTok", tokens: ["tiktok", "tik tok", "douyin", "simplia.social"] },
    { label: "Sitio web", tokens: ["webwidget", "web_widget", "web widget", "website", "web site", "sitio web", "pagina web", "livechat", "live chat", "widget"] },
];

const resolveKnownChannelLabel = (value: unknown) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) return "";

    const matched = CHANNEL_ALIAS_LABELS.find(({ tokens }) =>
        tokens.some((token) => normalizedValue.includes(token))
    );

    return matched?.label || "";
};

const cleanStoredChannel = (value: unknown) => {
    const text = String(value || "").trim();
    const normalized = normalizeText(text);
    return normalized && !["otro", "other", "unknown", "sin canal", "n/a", "na"].includes(normalized)
        ? text
        : "";
};

const channelLabelFromType = (type?: unknown, fallback?: unknown) => {
    const resolvedFromType = resolveKnownChannelLabel(type);
    if (resolvedFromType) return resolvedFromType;

    const resolvedFromFallback = resolveKnownChannelLabel(fallback);
    if (resolvedFromFallback) return resolvedFromFallback;

    return "";
};

const resolveConversationChannel = (
    conversation: Record<string, any>,
    attrs: Record<string, any>,
    inbox?: Record<string, any>,
) => {
    const embeddedInbox = asObject(conversation.inbox || conversation.channel);
    const senderAdditional = asObject(conversation.meta?.sender?.additional_attributes);
    const fallbackHints = [
        attrs.canal,
        conversation.canal,
        conversation.channel_name,
        conversation.source,
        conversation.provider,
        conversation.additional_attributes?.channel,
        conversation.additional_attributes?.social_channel,
        senderAdditional.channel,
        senderAdditional.social_channel,
        senderAdditional.provider,
        senderAdditional.platform,
        senderAdditional.source,
        embeddedInbox.name,
        embeddedInbox.website_url,
        embeddedInbox.website_token,
        embeddedInbox.channel_type,
        embeddedInbox.provider,
        embeddedInbox.slug,
        inbox?.name,
        inbox?.website_url,
        inbox?.website_token,
        inbox?.channel_type,
        inbox?.provider,
        inbox?.slug,
    ].filter(Boolean).join(" ");

    return channelLabelFromType(
        conversation.channel_type || embeddedInbox.channel_type || embeddedInbox.type || inbox?.channel_type,
        fallbackHints,
    ) || cleanStoredChannel(attrs.canal) || null;
};

const resolveAttributeSnapshots = (conversation: Record<string, any>) => {
    const contactAttrs = asObject(conversation.meta?.sender?.custom_attributes);
    const conversationAttrs = asObject(conversation.custom_attributes);
    const resolvedAttrs = { ...contactAttrs, ...conversationAttrs };

    return {
        contactAttrs,
        conversationAttrs,
        resolvedAttrs,
    };
};

const toUnixSeconds = (value: unknown) => {
    if (!value) return 0;
    const n = Number(value);
    if (!Number.isNaN(n)) return n < 10000000000 ? Math.floor(n) : Math.floor(n / 1000);
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
};

const conversationTouchedAt = (conversation: Record<string, any>) =>
    Math.max(
        toUnixSeconds(conversation.updated_at),
        toUnixSeconds(conversation.last_activity_at),
        toUnixSeconds(conversation.timestamp),
        toUnixSeconds(conversation.created_at),
    );

const uniqueBy = <T extends Record<string, unknown>>(rows: T[], key: keyof T) => {
    const map = new Map<unknown, T>();
    rows.forEach((row) => {
        if (row[key] !== undefined && row[key] !== null) map.set(row[key], row);
    });
    return Array.from(map.values());
};

const normalizeLabels = (labels: unknown): string[] => {
    if (!Array.isArray(labels)) return [];
    return Array.from(new Set(
        labels
            .map((label) => String(label || "").trim())
            .filter(Boolean),
    )).sort();
};

const labelDelta = (previousLabels: unknown, nextLabels: unknown) => {
    const previous = normalizeLabels(previousLabels);
    const next = normalizeLabels(nextLabels);
    const previousSet = new Set(previous);
    const nextSet = new Set(next);

    return {
        previous,
        next,
        added: next.filter((label) => !previousSet.has(label)),
        removed: previous.filter((label) => !nextSet.has(label)),
    };
};

const TRACKED_COMMERCIAL_ATTRIBUTE_KEYS = [
    "monto_operacion",
    "fecha_monto_operacion",
    "score_interes",
    "score",
    "lead_score",
    "puntaje",
    "responsable",
    "campana",
    "utm_campaign",
    "business_stage",
];

const emptyToNull = (value: unknown) =>
    value === undefined || value === null || value === "" ? null : value;

const stableJson = (value: unknown) => JSON.stringify(value ?? null);

const parseDashboardAccountId = (body: Record<string, any>) => {
    const configured = body.dashboard_account_id ?? Deno.env.get("DASHBOARD_ACCOUNT_ID") ?? 0;
    const parsed = Number(configured);
    return Number.isFinite(parsed) ? parsed : 0;
};

const labelTitle = (label: unknown) => {
    if (typeof label === "string") return label.trim();
    const record = asObject(label);
    return String(record.title || record.name || record.label || "").trim();
};

const optionalNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const upsertLabelCatalog = async (
    supabase: ReturnType<typeof createClient>,
    labels: unknown[],
    dashboardAccountId: number,
    chatwootAccountId: string,
) => {
    const rows = labels
        .map((label) => {
            const record = typeof label === "string" ? { title: label } : asObject(label);
            const title = labelTitle(label);
            if (!title) return null;

            return {
                account_id: dashboardAccountId,
                chatwoot_account_id: optionalNumber(chatwootAccountId),
                chatwoot_label_id: optionalNumber(record.id),
                title,
                color: emptyToNull(record.color),
                description: emptyToNull(record.description),
                show_on_sidebar: typeof record.show_on_sidebar === "boolean" ? record.show_on_sidebar : null,
                raw_payload: record,
                last_seen_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
        })
        .filter(Boolean);

    if (rows.length === 0) return 0;

    const { error } = await supabase
        .schema("cw")
        .from("label_catalog")
        .upsert(rows, { onConflict: "account_id,normalized_title" });

    if (error) throw error;
    return rows.length;
};

const parseAttributeScope = (definition: Record<string, any>) => {
    const model = definition.attribute_model ?? definition.attribute_model_type ?? definition.attribute_scope ?? definition.model;
    const modelText = normalizeText(model);

    if (model === 0 || modelText.includes("conversation")) return "conversation";
    if (model === 1 || modelText.includes("contact")) return "contact";
    return "unknown";
};

const fetchAttributeDefinitions = async (
    apiGet: (endpoint: string, params?: Record<string, string | number>) => Promise<any>,
) => {
    const variants: Array<Record<string, string | number> | undefined> = [
        undefined,
        { attribute_model: 0 },
        { attribute_model: 1 },
        { attribute_model: "contact" },
        { attribute_model: "conversation" },
        { attribute_scope: "contact" },
        { attribute_scope: "conversation" },
    ];

    const results = await Promise.allSettled(variants.map((params) => apiGet("/custom_attribute_definitions", params)));
    const byScopeAndKey = new Map<string, Record<string, any>>();

    results.forEach((result) => {
        if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;

        result.value.forEach((definition: unknown) => {
            const record = asObject(definition);
            const attributeKey = String(record.attribute_key || record.key || "").trim();
            const attributeId = optionalNumber(record.id ?? record.chatwoot_attribute_id);
            if (!attributeKey || attributeId === null) return;

            const attributeScope = parseAttributeScope(record);
            byScopeAndKey.set(`${attributeScope}:${attributeKey}`, {
                ...record,
                id: attributeId,
                attribute_key: attributeKey,
                attribute_scope: attributeScope,
            });
        });
    });

    return Array.from(byScopeAndKey.values());
};

const upsertAttributeDefinitions = async (
    supabase: ReturnType<typeof createClient>,
    definitions: Record<string, any>[],
) => {
    const rows = definitions.map((definition) => ({
        chatwoot_attribute_id: Number(definition.id),
        attribute_scope: definition.attribute_scope || parseAttributeScope(definition),
        attribute_key: String(definition.attribute_key || definition.key || "").trim(),
        attribute_display_name: emptyToNull(definition.attribute_display_name || definition.name),
        attribute_display_type: emptyToNull(definition.attribute_display_type || definition.display_type),
        attribute_description: emptyToNull(definition.attribute_description || definition.description),
        regex_pattern: emptyToNull(definition.regex_pattern),
        regex_cue: emptyToNull(definition.regex_cue),
        attribute_values: definition.attribute_values ?? null,
        attribute_model: emptyToNull(definition.attribute_model_type ?? definition.attribute_model ?? definition.attribute_scope),
        default_value: definition.default_value ?? null,
        created_at_chatwoot: toIso(definition.created_at),
        updated_at_chatwoot: toIso(definition.updated_at),
        raw_payload: definition,
        updated_at: new Date().toISOString(),
    })).filter((row) => row.chatwoot_attribute_id && row.attribute_key);

    if (rows.length === 0) return 0;

    const { error } = await supabase
        .schema("cw")
        .from("attribute_definitions")
        .upsert(rows, { onConflict: "attribute_scope,attribute_key" });

    if (error) throw error;
    return rows.length;
};

const refreshDashboardDiscovery = async (
    supabase: ReturnType<typeof createClient>,
    dashboardAccountId: number,
) => {
    const { data, error } = await supabase
        .schema("cw")
        .rpc("refresh_dashboard_discovery", { target_account_id: dashboardAccountId });

    if (error) throw error;
    return data;
};

const pruneDashboardLabels = async (
    supabase: ReturnType<typeof createClient>,
    dashboardAccountId: number,
) => {
    const { data: settings, error: settingsError } = await supabase
        .schema("cw")
        .rpc("prune_dashboard_settings_labels", { target_account_id: dashboardAccountId });

    if (settingsError) throw settingsError;

    const { data: references, error: referencesError } = await supabase
        .schema("cw")
        .rpc("prune_deleted_label_references", { target_account_id: dashboardAccountId });

    if (referencesError) throw referencesError;

    return {
        settings,
        references,
    };
};

const buildAttributeHistoryRows = (
    conversationId: number,
    previousAttrs: Record<string, any>,
    nextAttrs: Record<string, any>,
    changedAt: string,
    changeSource: "sync" | "webhook" | "repair" | "manual",
) => TRACKED_COMMERCIAL_ATTRIBUTE_KEYS
    .map((attributeKey) => {
        const oldValue = emptyToNull(previousAttrs?.[attributeKey]);
        const newValue = emptyToNull(nextAttrs?.[attributeKey]);
        if (stableJson(oldValue) === stableJson(newValue)) return null;

        return {
            chatwoot_conversation_id: conversationId,
            attribute_key: attributeKey,
            old_value: oldValue,
            new_value: newValue,
            changed_at: changedAt,
            change_source: changeSource,
            event_key: [
                changeSource,
                conversationId,
                attributeKey,
                changedAt,
                stableJson(oldValue),
                stableJson(newValue),
            ].join(":"),
        };
    })
    .filter(Boolean);

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const chatwootBase = Deno.env.get("VITE_CHATWOOT_BASE_URL");
        const accountId = Deno.env.get("VITE_CHATWOOT_ACCOUNT_ID");
        const apiToken = Deno.env.get("VITE_CHATWOOT_API_TOKEN");

        if (!supabaseUrl || !serviceRoleKey || !chatwootBase || !accountId || !apiToken) {
            throw new Error("Missing required Supabase or Chatwoot environment variables.");
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const chatwootUrl = `${chatwootBase}/api/v1/accounts/${accountId}`;
        const body = await req.json().catch(() => ({}));
        const dashboardAccountId = parseDashboardAccountId(body);
        const windowHours = Number(body.window_hours || 48);
        const mode = body.mode === "full" ? "full" : "delta";
        const syncMessages = ["none", "recent", "all"].includes(body.sync_messages)
            ? body.sync_messages
            : "recent";
        const maxPages = Math.max(1, Math.min(Number(body.max_pages || MAX_CHATWOOT_PAGES), MAX_CHATWOOT_PAGES));
        const untilUnix = Math.floor(Date.now() / 1000);
        const sinceUnix = untilUnix - windowHours * 60 * 60;

        const apiGet = async (endpoint: string, params: Record<string, string | number> = {}) => {
            const url = new URL(`${chatwootUrl}${endpoint}`);
            Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

            const response = await fetch(url.toString(), {
                headers: { api_access_token: apiToken },
            });

            if (!response.ok) {
                throw new Error(`Chatwoot ${endpoint} failed: ${response.status} ${await response.text()}`);
            }

            const json = await response.json();
            const rawBody = json.data || json;
            return Array.isArray(rawBody) ? rawBody : (rawBody.payload || rawBody);
        };

        const { data: run, error: runError } = await supabase
            .schema("cw")
            .from("sync_runs")
            .insert({
                sync_type: mode === "full" ? "daily_full" : "daily_delta",
                status: "running",
                stats: { mode, window_hours: windowHours, sync_messages: syncMessages, max_pages: maxPages },
            })
            .select("id")
            .single();

        if (runError) throw runError;

        const runId = run.id;
        const stats = {
            window_hours: windowHours,
            mode,
            sync_messages: syncMessages,
            max_pages: maxPages,
            inboxes: 0,
            labels: 0,
            attribute_definitions: 0,
            contacts: 0,
            conversations: 0,
            label_events: 0,
            attribute_events: 0,
            messages: 0,
            pages: 0,
            dashboard_discovery: null as unknown,
        };

        try {
            const inboxById = new Map<number, Record<string, any>>();
            const inboxes = await apiGet("/inboxes");
            if (Array.isArray(inboxes) && inboxes.length > 0) {
                inboxes.forEach((inbox: any) => {
                    const inboxId = Number(inbox?.id);
                    if (Number.isFinite(inboxId)) inboxById.set(inboxId, inbox);
                });

                const inboxRows = inboxes.map((inbox: any) => ({
                    chatwoot_inbox_id: inbox.id,
                    name: inbox.name,
                    website_url: inbox.website_url,
                    channel_type: inbox.channel_type,
                    avatar_url: inbox.avatar_url,
                    widget_color: inbox.widget_color,
                    website_token: inbox.website_token,
                    enable_auto_assignment: inbox.enable_auto_assignment,
                    web_widget_script: inbox.web_widget_script,
                    welcome_title: inbox.welcome_title,
                    welcome_tagline: inbox.welcome_tagline,
                    greeting_enabled: inbox.greeting_enabled,
                    raw_payload: inbox,
                    updated_at: new Date().toISOString(),
                }));

                const { error } = await supabase
                    .schema("cw")
                    .from("inboxes")
                    .upsert(inboxRows, { onConflict: "chatwoot_inbox_id" });
                if (error) throw error;
                stats.inboxes = inboxRows.length;
            }

            const labels = await apiGet("/labels");
            if (Array.isArray(labels)) {
                stats.labels = await upsertLabelCatalog(supabase, labels, dashboardAccountId, accountId);
            }

            const attributeDefinitions = await fetchAttributeDefinitions(apiGet);
            stats.attribute_definitions = await upsertAttributeDefinitions(supabase, attributeDefinitions);

            let page = 1;
            const seenConversationIds = new Set<number>();
            while (page <= maxPages) {
                const conversations = await apiGet("/conversations", {
                    page,
                    status: "all",
                    assignee_type: "all",
                    sort_by: "last_activity_at_desc",
                    since: sinceUnix,
                    until: untilUnix,
                });

                if (!Array.isArray(conversations) || conversations.length === 0) break;
                stats.pages += 1;

                const conversationIds = conversations.map((conv: any) => Number(conv.id)).filter(Boolean);
                const newConversationIds = conversationIds.filter((conversationId: number) => !seenConversationIds.has(conversationId));
                conversationIds.forEach((conversationId: number) => seenConversationIds.add(conversationId));
                const existingLabels = new Map<number, string[]>();
                const existingRowsById = new Map<number, Record<string, any>>();
                if (conversationIds.length > 0) {
                    const { data: existingRows, error: existingError } = await supabase
                        .schema("cw")
                        .from("conversations_current")
                        .select("chatwoot_conversation_id, labels, custom_attributes, conversation_custom_attributes, contact_custom_attributes")
                        .in("chatwoot_conversation_id", conversationIds);

                    if (existingError) throw existingError;
                    (existingRows || []).forEach((row: any) => {
                        const conversationId = Number(row.chatwoot_conversation_id);
                        existingLabels.set(conversationId, normalizeLabels(row.labels));
                        existingRowsById.set(conversationId, row);
                    });
                }

                const labelEventRows = conversations
                    .map((conv: any) => {
                        const conversationId = Number(conv.id);
                        const delta = labelDelta(existingLabels.get(conversationId) || [], conv.labels || []);
                        if (delta.added.length === 0 && delta.removed.length === 0) return null;

                        const occurredAt = toIso(conv.updated_at || conv.last_activity_at || conv.timestamp || Date.now()) || new Date().toISOString();
                        const eventKey = [
                            "sync_diff",
                            conversationId,
                            occurredAt,
                            delta.previous.join("|"),
                            delta.next.join("|"),
                        ].join(":");

                        return {
                            chatwoot_conversation_id: conversationId,
                            previous_labels: delta.previous,
                            next_labels: delta.next,
                            added_labels: delta.added,
                            removed_labels: delta.removed,
                            event_source: "sync_diff",
                            occurred_at: occurredAt,
                            detected_at: new Date().toISOString(),
                            raw_payload: {
                                source: "chatwoot-sync",
                                page,
                                previous_labels: delta.previous,
                                next_labels: delta.next,
                            },
                            event_key: eventKey,
                        };
                    })
                    .filter(Boolean);

                if (labelEventRows.length > 0) {
                    const { error: labelEventError } = await supabase
                        .schema("cw")
                        .from("conversation_label_events")
                        .upsert(labelEventRows, { onConflict: "event_key", ignoreDuplicates: true });

                    if (labelEventError) throw labelEventError;
                    stats.label_events += labelEventRows.length;
                }

                const contactRows = conversations
                    .filter((conv: any) => conv.meta?.sender?.id)
                    .map((conv: any) => {
                        const sender = conv.meta.sender;
                        const identityKey = sender.phone_number || sender.email || sender.identifier || `cw_${sender.id}`;

                        return {
                            chatwoot_contact_id: sender.id,
                            lead_identity_key: identityKey,
                            identifier: sender.identifier,
                            name: sender.name,
                            phone_number: sender.phone_number,
                            email: sender.email,
                            blocked: sender.blocked,
                            thumbnail: sender.thumbnail,
                            availability_status: sender.availability_status,
                            additional_attributes: sender.additional_attributes || {},
                            custom_attributes: sender.custom_attributes || {},
                            created_at_chatwoot: toIso(sender.created_at),
                            last_activity_at_chatwoot: toIso(sender.last_activity_at),
                            raw_payload: sender,
                            updated_at: new Date().toISOString(),
                        };
                    });

                const uniqueContacts = uniqueBy(contactRows, "chatwoot_contact_id");
                if (uniqueContacts.length > 0) {
                    const { error } = await supabase
                        .schema("cw")
                        .from("contacts_current")
                        .upsert(uniqueContacts, { onConflict: "chatwoot_contact_id" });
                    if (error) throw error;
                    stats.contacts += uniqueContacts.length;
                }

                const conversationRows = conversations.map((conv: any) => {
                    const {
                        contactAttrs,
                        conversationAttrs,
                        resolvedAttrs: attrs,
                    } = resolveAttributeSnapshots(conv);
                    const lastNonActivity = conv.last_non_activity_message || {};
                    const canal = resolveConversationChannel(conv, attrs, inboxById.get(Number(conv.inbox_id)));
                    const resolvedAttrs = canal ? { ...attrs, canal } : attrs;

                    return {
                        chatwoot_conversation_id: conv.id,
                        chatwoot_contact_id: conv.meta?.sender?.id || conv.contact_id,
                        chatwoot_account_id: conv.account_id,
                        chatwoot_inbox_id: conv.inbox_id,
                        chatwoot_team_id: conv.team_id,
                        assignee_id: conv.assignee_id,
                        uuid: conv.uuid,
                        status: conv.status,
                        priority: conv.priority,
                        can_reply: conv.can_reply,
                        muted: conv.muted,
                        snoozed_until: toIso(conv.snoozed_until),
                        unread_count: conv.unread_count,
                        labels: conv.labels || [],
                        business_stage_current: emptyToNull(attrs.business_stage),
                        additional_attributes: conv.additional_attributes || {},
                        contact_custom_attributes: contactAttrs,
                        conversation_custom_attributes: conversationAttrs,
                        custom_attributes: resolvedAttrs,
                        meta: conv.meta || {},
                        applied_sla: conv.applied_sla || {},
                        sla_events: conv.sla_events || [],
                        first_reply_created_at_chatwoot: toIso(conv.first_reply_created_at),
                        waiting_since_chatwoot: toIso(conv.waiting_since),
                        last_activity_at_chatwoot: toIso(conv.last_activity_at || conv.timestamp),
                        created_at_chatwoot: toIso(conv.created_at || conv.timestamp),
                        updated_at_chatwoot: toIso(conv.updated_at || conv.last_activity_at || conv.timestamp),
                        last_non_activity_message_id: lastNonActivity.id,
                        last_non_activity_message_preview: lastNonActivity.content,
                        last_message_at: toIso(lastNonActivity.created_at || conv.timestamp),
                        raw_payload: conv,
                        nombre_completo: emptyToNull(attrs.nombre_completo),
                        fecha_visita: emptyToNull(attrs.fecha_visita),
                        hora_visita: emptyToNull(attrs.hora_visita),
                        agencia: emptyToNull(attrs.agencia),
                        celular: emptyToNull(attrs.celular),
                        correo: emptyToNull(attrs.correo),
                        campana: emptyToNull(attrs.campana),
                        ciudad: emptyToNull(attrs.ciudad),
                        edad: emptyToNull(attrs.edad),
                        canal,
                        agente: emptyToNull(attrs.agente) === null ? null : attrs.agente === true || attrs.agente === "true",
                        score_interes: parseNumber(attrs.score_interes),
                        monto_operacion: emptyToNull(attrs.monto_operacion),
                        fecha_monto_operacion: toIso(attrs.fecha_monto_operacion),
                        updated_at: new Date().toISOString(),
                    };
                });

                const attributeHistoryRows = conversations.flatMap((conv: any) => {
                    const conversationId = Number(conv.id);
                    const existingRow = existingRowsById.get(conversationId);
                    if (!existingRow) return [];

                    const { resolvedAttrs: attrs } = resolveAttributeSnapshots(conv);
                    const canal = resolveConversationChannel(conv, attrs, inboxById.get(Number(conv.inbox_id)));
                    const nextAttrs = canal ? { ...attrs, canal } : attrs;
                    const previousAttrs = {
                        ...asObject(existingRow.contact_custom_attributes),
                        ...asObject(existingRow.conversation_custom_attributes),
                        ...asObject(existingRow.custom_attributes),
                    };
                    const changedAt = toIso(conv.updated_at || conv.last_activity_at || conv.timestamp || Date.now()) || new Date().toISOString();
                    return buildAttributeHistoryRows(conversationId, previousAttrs, nextAttrs, changedAt, "sync");
                });

                if (attributeHistoryRows.length > 0) {
                    const { error: attributeHistoryError } = await supabase
                        .schema("cw")
                        .from("conversation_attribute_history")
                        .upsert(attributeHistoryRows, { onConflict: "event_key", ignoreDuplicates: true });

                    if (attributeHistoryError) throw attributeHistoryError;
                    stats.attribute_events += attributeHistoryRows.length;
                }

                const { error: conversationError } = await supabase
                    .schema("cw")
                    .from("conversations_current")
                    .upsert(conversationRows, { onConflict: "chatwoot_conversation_id" });
                if (conversationError) throw conversationError;
                stats.conversations += conversationRows.length;

                for (const conv of conversations) {
                    if (syncMessages === "none") continue;
                    if (syncMessages === "recent" && conversationTouchedAt(conv) < sinceUnix) continue;

                    const messages = await apiGet(`/conversations/${conv.id}/messages`);
                    if (!Array.isArray(messages) || messages.length === 0) continue;

                    const messageRows = messages.map((msg: any) => {
                        const numericType = Number(msg.message_type);
                        const messageDirection = numericType === 1
                            ? "outgoing"
                            : numericType === 0
                                ? "incoming"
                                : "activity";

                        return {
                            chatwoot_message_id: msg.id,
                            chatwoot_conversation_id: msg.conversation_id,
                            chatwoot_contact_id: msg.sender?.id,
                            chatwoot_account_id: msg.account_id,
                            chatwoot_inbox_id: msg.inbox_id,
                            sender_id: msg.sender?.id,
                            sender_type: msg.sender_type,
                            message_type: String(msg.message_type ?? ""),
                            message_direction: messageDirection,
                            content: msg.content,
                            content_type: msg.content_type,
                            content_attributes: msg.content_attributes || {},
                            additional_attributes: msg.additional_attributes || {},
                            external_source_ids: msg.external_source_ids || {},
                            attachments: msg.attachments || [],
                            sender: msg.sender || {},
                            sentiment: msg.sentiment || {},
                            status: msg.status,
                            is_private: msg.private || false,
                            created_at_chatwoot: toIso(msg.created_at),
                            updated_at_chatwoot: toIso(msg.updated_at),
                            raw_payload: msg,
                        };
                    });

                    const { error: messageError } = await supabase
                        .schema("cw")
                        .from("messages")
                        .upsert(messageRows, { onConflict: "chatwoot_message_id" });
                    if (messageError) throw messageError;
                    stats.messages += messageRows.length;
                }

                const oldestActivity = Math.min(
                    ...conversations
                        .map((conv: any) => Number(conv.last_activity_at || conv.timestamp || conv.created_at || 0))
                        .filter(Boolean)
                );

                if (mode !== "full" && oldestActivity && oldestActivity < sinceUnix) break;
                if (newConversationIds.length === 0) break;
                page += 1;
            }

            await supabase
                .schema("cw")
                .from("sync_cursor")
                .upsert({
                    cursor_name: mode === "full" ? "daily_full" : "daily_delta",
                    last_since_ts: toIso(sinceUnix),
                    last_until_ts: toIso(untilUnix),
                    cursor_payload: { mode, window_hours: windowHours, sync_messages: syncMessages, max_pages: maxPages },
                    updated_at: new Date().toISOString(),
                }, { onConflict: "cursor_name" });

            const dashboardDiscovery = await refreshDashboardDiscovery(supabase, dashboardAccountId);
            stats.dashboard_discovery = {
                discovery: dashboardDiscovery,
                pruning: await pruneDashboardLabels(supabase, dashboardAccountId),
            };

            await supabase
                .schema("cw")
                .from("sync_runs")
                .update({
                    status: "success",
                    finished_at: new Date().toISOString(),
                    stats,
                })
                .eq("id", runId);

            return new Response(JSON.stringify({
                success: true,
                since: toIso(sinceUnix),
                until: toIso(untilUnix),
                stats,
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        } catch (syncError) {
            await supabase
                .schema("cw")
                .from("sync_runs")
                .update({
                    status: "error",
                    finished_at: new Date().toISOString(),
                    stats,
                    error_message: errorMessage(syncError),
                })
                .eq("id", runId);

            throw syncError;
        }
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: errorMessage(error),
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
