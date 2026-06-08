/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-chatwoot-webhook-signature, x-webhook-secret",
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
            raw_payload: { source: "chatwoot-label-webhook", title },
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

const toIso = (value: unknown) => {
    if (!value) return null;
    const n = Number(value);
    const date = Number.isNaN(n)
        ? new Date(String(value))
        : new Date(n < 10000000000 ? n * 1000 : n);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toIsoOrNow = (value: unknown) => toIso(value) || new Date().toISOString();

const firstArray = (...values: unknown[]) =>
    values.find((value) => Array.isArray(value)) as unknown[] | undefined;

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
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const configuredSecret = Deno.env.get("CHATWOOT_WEBHOOK_SECRET");
        if (configuredSecret) {
            const receivedSecret =
                req.headers.get("x-webhook-secret") ||
                req.headers.get("x-chatwoot-webhook-signature") ||
                new URL(req.url).searchParams.get("secret");

            if (receivedSecret !== configuredSecret) {
                return new Response(JSON.stringify({ success: false, error: "Unauthorized webhook" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                    status: 401,
                });
            }
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error("Missing Supabase environment variables.");
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const body = await req.json();
        const dashboardAccountId = parseDashboardAccountId(body);
        const eventName = body.event || body.name || body.event_name || "conversation_label_change";

        let conversation =
            body.conversation ||
            body.current_conversation ||
            body.data?.conversation;

        // If it's a contact_updated event, we might not have a conversation object directly
        if (!conversation && (eventName === "contact_updated" || body.contact)) {
            const contact = body.contact || body.data?.contact || body;
            const contactId = contact.id;

            if (contactId) {
                // Try to find the most recent conversation for this contact to update its attributes
                const { data: latestConv } = await supabase
                    .schema("cw")
                    .from("conversations_current")
                    .select("chatwoot_conversation_id, raw_payload")
                    .eq("chatwoot_contact_id", contactId)
                    .order("last_activity_at_chatwoot", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (latestConv) {
                    conversation = {
                        ...(latestConv.raw_payload as Record<string, any>),
                        id: latestConv.chatwoot_conversation_id,
                        meta: {
                            ...(latestConv.raw_payload as Record<string, any>)?.meta,
                            sender: contact
                        }
                    };
                }
            }
        }

        const conversationId = conversation ? Number(conversation.id || body.conversation_id || body.chatwoot_conversation_id) : null;

        await supabase
            .schema("cw")
            .from("raw_ingest")
            .insert({
                source_type: "webhook",
                endpoint_name: "chatwoot-label-webhook",
                event_name: eventName,
                entity_type: conversationId ? "conversation" : "other",
                chatwoot_entity_id: conversationId,
                payload: body,
            });

        if (!conversationId) {
            return new Response(JSON.stringify({ success: true, message: "No conversation context found for this event" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }

        const { data: existingRow, error: existingError } = await supabase
            .schema("cw")
            .from("conversations_current")
            .select("labels, custom_attributes, conversation_custom_attributes, contact_custom_attributes")
            .eq("chatwoot_conversation_id", conversationId)
            .maybeSingle();

        if (existingError) throw existingError;

        const payloadPreviousLabels = firstArray(
            body.previous_labels,
            body.previous?.labels,
            body.changed_attributes?.labels?.previous_value,
            body.changed_attributes?.labels?.previous,
            body.changes?.labels?.previous,
            body.labels_before,
        );
        const payloadNextLabels = firstArray(
            conversation.labels,
            body.labels,
            body.current_labels,
            body.changed_attributes?.labels?.current_value,
            body.changed_attributes?.labels?.current,
            body.changes?.labels?.current,
            body.labels_after,
        );

        const previousLabels = payloadPreviousLabels || existingRow?.labels || [];
        const nextLabels = payloadNextLabels || (conversation ? normalizeLabels(conversation.labels) : []);
        const delta = labelDelta(previousLabels, nextLabels);

        if (delta.added.length > 0 || delta.removed.length > 0) {
            const occurredAt = toIsoOrNow(body.event_created_at || body.created_at || body.updated_at || conversation?.updated_at || conversation?.timestamp);
            const eventKey = [
                "webhook",
                conversationId,
                occurredAt,
                delta.previous.join("|"),
                delta.next.join("|"),
            ].join(":");

            const { error: eventError } = await supabase
                .schema("cw")
                .from("conversation_label_events")
                .upsert({
                    chatwoot_conversation_id: conversationId,
                    previous_labels: delta.previous,
                    next_labels: delta.next,
                    added_labels: delta.added,
                    removed_labels: delta.removed,
                    event_source: "webhook",
                    occurred_at: occurredAt,
                    detected_at: new Date().toISOString(),
                    raw_payload: body,
                    event_key: eventKey,
                }, { onConflict: "event_key", ignoreDuplicates: true });

            if (eventError) throw eventError;
        }

        let inboxForConversation: Record<string, any> | null = null;
        const inboxId = Number(conversation?.inbox_id);
        if (Number.isFinite(inboxId) && inboxId > 0) {
            const { data: inboxRow, error: inboxError } = await supabase
                .schema("cw")
                .from("inboxes")
                .select("*")
                .eq("chatwoot_inbox_id", inboxId)
                .maybeSingle();

            if (inboxError) {
                console.warn("Could not load inbox metadata for webhook channel resolution:", inboxError);
            } else {
                inboxForConversation = inboxRow;
            }
        }

        const conversationUpsertRow = buildConversationUpsertRow(conversation, inboxForConversation);

        if (conversationUpsertRow) {
            if (existingRow) {
                const occurredAt = toIsoOrNow(body.event_created_at || body.created_at || body.updated_at || conversation?.updated_at || conversation?.timestamp);
                const previousAttrs = {
                    ...asObject(existingRow.contact_custom_attributes),
                    ...asObject(existingRow.conversation_custom_attributes),
                    ...asObject(existingRow.custom_attributes),
                };
                const historyRows = buildAttributeHistoryRows(
                    conversationId,
                    previousAttrs,
                    asObject(conversationUpsertRow.custom_attributes),
                    occurredAt,
                    "webhook",
                );

                if (historyRows.length > 0) {
                    const { error: attributeHistoryError } = await supabase
                        .schema("cw")
                        .from("conversation_attribute_history")
                        .upsert(historyRows, { onConflict: "event_key", ignoreDuplicates: true });

                    if (attributeHistoryError) throw attributeHistoryError;
                }
            }

            const { error: conversationError } = await supabase
                .schema("cw")
                .from("conversations_current")
                .upsert(conversationUpsertRow, { onConflict: "chatwoot_conversation_id" });

            if (conversationError) throw conversationError;
        }

        let dashboardDiscovery: unknown = null;
        try {
            await upsertLabelTitles(
                supabase,
                [
                    ...delta.previous,
                    ...delta.next,
                    ...delta.added,
                    ...delta.removed,
                    ...normalizeLabels(conversation?.labels || body.labels || []),
                ],
                dashboardAccountId,
                conversation?.account_id || body.account_id,
            );
            const discovery = await refreshDashboardDiscovery(supabase, dashboardAccountId);
            dashboardDiscovery = {
                discovery,
                pruning: await pruneDashboardLabels(supabase, dashboardAccountId),
            };
        } catch (discoveryError) {
            console.warn("Dashboard discovery refresh failed after webhook:", discoveryError);
        }

        return new Response(JSON.stringify({
            success: true,
            conversation_id: conversationId,
            event: eventName,
            added_labels: delta.added,
            removed_labels: delta.removed,
            dashboard_discovery: dashboardDiscovery,
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
