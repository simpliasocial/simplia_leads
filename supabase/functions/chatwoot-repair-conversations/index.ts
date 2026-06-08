/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMIT = 250;
const DEFAULT_BATCH_SIZE = 5;

const toIso = (value: unknown) => {
    if (!value) return null;
    const numeric = Number(value);
    const date = Number.isNaN(numeric)
        ? new Date(String(value))
        : new Date(numeric < 10000000000 ? numeric * 1000 : numeric);
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

const channelLabelFromType = (type?: unknown, fallback?: unknown) =>
    resolveKnownChannelLabel(type) || resolveKnownChannelLabel(fallback) || "";

const resolveConversationChannel = (
    conversation: Record<string, any>,
    attrs: Record<string, any>,
    inbox?: Record<string, any> | null,
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
    const sender = conversation.meta?.sender || conversation.contact || {};
    const contactAttrs = asObject(sender.custom_attributes);
    const conversationAttrs = asObject(conversation.custom_attributes);

    return {
        contactAttrs,
        conversationAttrs,
        resolvedAttrs: { ...contactAttrs, ...conversationAttrs },
    };
};

const compactObject = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ""));

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

const parseDashboardAccountId = (body: Record<string, any>) => {
    const configured = body.dashboard_account_id ?? Deno.env.get("DASHBOARD_ACCOUNT_ID") ?? 0;
    const parsed = Number(configured);
    return Number.isFinite(parsed) ? parsed : 0;
};

const optionalNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const upsertLabelTitles = async (
    supabase: ReturnType<typeof createClient>,
    labels: string[],
    dashboardAccountId: number,
    chatwootAccountId: unknown,
) => {
    const rows = normalizeLabels(labels)
        .map((title) => ({
            account_id: dashboardAccountId,
            chatwoot_account_id: optionalNumber(chatwootAccountId),
            title,
            raw_payload: { source: "chatwoot-repair-conversations", title },
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }));

    if (rows.length === 0) return;

    const { error } = await supabase
        .schema("cw")
        .from("label_catalog")
        .upsert(rows, { onConflict: "account_id,normalized_title" });

    if (error) throw error;
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

const uniqueIds = (values: unknown[]) =>
    Array.from(new Set(
        values
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0),
    ));

const buildConversationUpsertRow = (conversation: Record<string, any>, inbox?: Record<string, any> | null) => {
    if (!conversation?.id) return null;

    const sender = conversation.meta?.sender || conversation.contact || {};
    const {
        contactAttrs,
        conversationAttrs,
        resolvedAttrs: attrs,
    } = resolveAttributeSnapshots(conversation);
    const lastNonActivity = conversation.last_non_activity_message || {};
    const canal = resolveConversationChannel(conversation, attrs, inbox);
    const resolvedAttrs = canal ? { ...attrs, canal } : attrs;

    return {
        chatwoot_conversation_id: Number(conversation.id),
        chatwoot_contact_id: sender.id || conversation.contact_id || null,
        chatwoot_account_id: conversation.account_id || null,
        chatwoot_inbox_id: conversation.inbox_id || null,
        chatwoot_team_id: conversation.team_id || null,
        assignee_id: conversation.assignee_id || null,
        uuid: conversation.uuid || null,
        status: conversation.status || null,
        priority: conversation.priority || null,
        can_reply: conversation.can_reply ?? null,
        muted: conversation.muted ?? null,
        snoozed_until: toIso(conversation.snoozed_until),
        unread_count: conversation.unread_count ?? null,
        labels: normalizeLabels(conversation.labels || []),
        business_stage_current: attrs.business_stage || null,
        additional_attributes: conversation.additional_attributes || {},
        contact_custom_attributes: contactAttrs,
        conversation_custom_attributes: conversationAttrs,
        custom_attributes: resolvedAttrs,
        meta: conversation.meta || {},
        applied_sla: conversation.applied_sla || {},
        sla_events: conversation.sla_events || [],
        first_reply_created_at_chatwoot: toIso(conversation.first_reply_created_at),
        waiting_since_chatwoot: toIso(conversation.waiting_since),
        last_activity_at_chatwoot: toIso(conversation.last_activity_at || conversation.timestamp || conversation.updated_at),
        created_at_chatwoot: toIso(conversation.created_at || conversation.timestamp),
        updated_at_chatwoot: toIso(conversation.updated_at || conversation.last_activity_at || conversation.timestamp),
        last_non_activity_message_id: lastNonActivity.id || null,
        last_non_activity_message_preview: lastNonActivity.content || null,
        last_message_at: toIso(lastNonActivity.created_at || conversation.last_activity_at || conversation.timestamp),
        raw_payload: conversation,
        ...compactObject({
            nombre_completo: attrs.nombre_completo,
            fecha_visita: attrs.fecha_visita,
            hora_visita: attrs.hora_visita,
            agencia: attrs.agencia,
            celular: attrs.celular,
            correo: attrs.correo,
            campana: attrs.campana,
            ciudad: attrs.ciudad,
            edad: attrs.edad,
            canal,
            agente: attrs.agente === true || attrs.agente === "true",
            score_interes: parseNumber(attrs.score_interes),
            monto_operacion: attrs.monto_operacion,
            fecha_monto_operacion: toIso(attrs.fecha_monto_operacion),
        }),
        updated_at: new Date().toISOString(),
    };
};

const chunk = <T,>(items: T[], size: number) => {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const chatwootBaseUrl = Deno.env.get("CHATWOOT_BASE_URL") ?? Deno.env.get("VITE_CHATWOOT_BASE_URL") ?? "";
        const chatwootAccountId = Deno.env.get("CHATWOOT_ACCOUNT_ID") ?? Deno.env.get("VITE_CHATWOOT_ACCOUNT_ID") ?? "";
        const chatwootApiToken = Deno.env.get("CHATWOOT_API_TOKEN") ?? Deno.env.get("VITE_CHATWOOT_API_TOKEN") ?? "";

        if (!supabaseUrl || !serviceRoleKey || !chatwootBaseUrl || !chatwootAccountId || !chatwootApiToken) {
            throw new Error("Missing Supabase or Chatwoot environment variables.");
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const body = await req.json().catch(() => ({}));
        const dashboardAccountId = parseDashboardAccountId(body);
        const requestedIds = uniqueIds(Array.isArray(body.ids) ? body.ids : []);
        const limit = Math.max(1, Number(body.limit) || DEFAULT_LIMIT);
        const batchSize = Math.max(1, Number(body.batch_size) || DEFAULT_BATCH_SIZE);

        const idsToRepair = requestedIds.length > 0
            ? requestedIds.slice(0, limit)
            : [];

        if (requestedIds.length === 0) {
            const { data, error } = await supabase
                .schema("cw")
                .from("conversations_current")
                .select("chatwoot_conversation_id")
                .order("chatwoot_conversation_id", { ascending: true })
                .limit(limit);

            if (error) throw error;
            idsToRepair.splice(0, idsToRepair.length, ...uniqueIds((data || []).map((row: any) => row.chatwoot_conversation_id)));
        }

        if (idsToRepair.length === 0) {
            return new Response(JSON.stringify({ success: true, stats: { repaired: 0, label_events: 0 } }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }

        const { data: existingRows, error: existingError } = await supabase
            .schema("cw")
            .from("conversations_current")
            .select("chatwoot_conversation_id, labels")
            .in("chatwoot_conversation_id", idsToRepair);

        if (existingError) throw existingError;

        const existingLabelsById = new Map<number, string[]>();
        (existingRows || []).forEach((row: any) => {
            existingLabelsById.set(Number(row.chatwoot_conversation_id), normalizeLabels(row.labels));
        });

        const apiGetConversation = async (conversationId: number) => {
            const response = await fetch(`${chatwootBaseUrl}/api/v1/accounts/${chatwootAccountId}/conversations/${conversationId}`, {
                headers: {
                    api_access_token: chatwootApiToken,
                },
            });

            if (!response.ok) {
                throw new Error(`Chatwoot conversation ${conversationId} failed: ${response.status} ${await response.text()}`);
            }

            const json = await response.json();
            const rawBody = json.data || json;
            return Array.isArray(rawBody) ? rawBody[0] : (rawBody.payload || rawBody);
        };

        const conversationRows: Record<string, any>[] = [];
        const labelEventRows: Record<string, any>[] = [];

        for (const idBatch of chunk(idsToRepair, batchSize)) {
            const batchResults = await Promise.all(idBatch.map(async (conversationId) => {
                try {
                    const conversation = await apiGetConversation(conversationId);
                    return { conversationId, conversation, error: null };
                } catch (error) {
                    return { conversationId, conversation: null, error };
                }
            }));

            const inboxIds = uniqueIds(batchResults.map(({ conversation }) => conversation?.inbox_id));
            const inboxById = new Map<number, Record<string, any>>();
            if (inboxIds.length > 0) {
                const { data: inboxRows, error: inboxError } = await supabase
                    .schema("cw")
                    .from("inboxes")
                    .select("*")
                    .in("chatwoot_inbox_id", inboxIds);

                if (inboxError) {
                    console.warn("Could not load inbox metadata for repair channel resolution:", inboxError);
                } else {
                    (inboxRows || []).forEach((inbox: any) => {
                        inboxById.set(Number(inbox.chatwoot_inbox_id), inbox);
                    });
                }
            }

            batchResults.forEach(({ conversationId, conversation, error }) => {
                if (error || !conversation) return;

                const conversationRow = buildConversationUpsertRow(
                    conversation,
                    inboxById.get(Number(conversation.inbox_id)),
                );
                if (conversationRow) {
                    conversationRows.push(conversationRow);
                }

                const delta = labelDelta(existingLabelsById.get(conversationId) || [], conversation.labels || []);
                if (delta.added.length === 0 && delta.removed.length === 0) return;

                const occurredAt = toIso(conversation.updated_at || conversation.last_activity_at || conversation.timestamp) || new Date().toISOString();
                labelEventRows.push({
                    chatwoot_conversation_id: conversationId,
                    previous_labels: delta.previous,
                    next_labels: delta.next,
                    added_labels: delta.added,
                    removed_labels: delta.removed,
                    event_source: "repair",
                    occurred_at: occurredAt,
                    detected_at: new Date().toISOString(),
                    raw_payload: {
                        source: "chatwoot-repair-conversations",
                        conversation,
                    },
                    event_key: ["repair", conversationId, occurredAt, delta.previous.join("|"), delta.next.join("|")].join(":"),
                });
            });
        }

        if (conversationRows.length > 0) {
            const { error } = await supabase
                .schema("cw")
                .from("conversations_current")
                .upsert(conversationRows, { onConflict: "chatwoot_conversation_id" });

            if (error) throw error;
        }

        if (labelEventRows.length > 0) {
            const { error } = await supabase
                .schema("cw")
                .from("conversation_label_events")
                .upsert(labelEventRows, { onConflict: "event_key", ignoreDuplicates: true });

            if (error) throw error;
        }

        let dashboardDiscovery: unknown = null;
        try {
            await upsertLabelTitles(
                supabase,
                conversationRows.flatMap((row) => Array.isArray(row.labels) ? row.labels : []),
                dashboardAccountId,
                conversationRows.find((row) => row.chatwoot_account_id)?.chatwoot_account_id,
            );
            const discovery = await refreshDashboardDiscovery(supabase, dashboardAccountId);
            dashboardDiscovery = {
                discovery,
                pruning: await pruneDashboardLabels(supabase, dashboardAccountId),
            };
        } catch (discoveryError) {
            console.warn("Dashboard discovery refresh failed after repair:", discoveryError);
        }

        return new Response(JSON.stringify({
            success: true,
            stats: {
                requested: idsToRepair.length,
                repaired: conversationRows.length,
                label_events: labelEventRows.length,
                dashboard_discovery: dashboardDiscovery,
            },
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });
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
