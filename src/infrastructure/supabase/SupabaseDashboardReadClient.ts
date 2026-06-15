import { supabase } from "../../lib/supabase";
import type { IncomingMessageTrafficEvent, MinifiedConversation } from "../../domain/conversation";
import { uniqueConversationsById } from "../../domain/conversation";
import type { ConversationMessage } from "../../domain/lead";
import { mapIncomingMessageEvent } from "../../shared/conversation/messageTraffic";
import { parseTimestampToUnix } from "../../shared/time/timestamps";
import { mapSupabaseConversationRowToMinified } from "../conversation/ConversationMapper";

const SUPABASE_PAGE_SIZE = 1000;

type N8nChatHistoryRow = {
    id?: number;
    session_id?: string | null;
    message?: {
        content?: string;
        type?: string;
        [key: string]: unknown;
    } | null;
    pipeline_stage?: string | null;
    created_at?: string | null;
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    channel?: string | null;
    profile_url?: string | null;
};

export interface SupabaseConversationReadFilters {
    beforeIso?: string;
    sinceIso?: string;
    untilIso?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    importedOnly?: boolean;
}

export interface SupabaseConversationReadResult {
    payload: MinifiedConversation[];
    count: number;
}

export interface SupabaseIncomingTrafficFilters {
    sinceIso: string;
    untilIso: string;
    selectedInboxes?: number[];
}

const isSchemaAccessError = (error: { code?: string; message?: string } | null | undefined) => {
    if (!error) return false;

    return [
        error.code === "42501",
        error.code === "PGRST106",
        error.code === "PGRST205",
        typeof error.message === "string" && error.message.toLowerCase().includes("permission denied for schema cw"),
        typeof error.message === "string" && error.message.toLowerCase().includes("schema cache"),
    ].some(Boolean);
};

const normalizeStageLabel = (value: string | null | undefined) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "sin_etapa";
    return normalized.replace(/\s+/g, "_");
};

const toConversationId = (sessionId: string, fallbackId: number) => {
    const numeric = Number(sessionId);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    return fallbackId;
};

const mapN8nRowsToConversations = (rows: N8nChatHistoryRow[]): MinifiedConversation[] => {
    const bySession = new Map<string, N8nChatHistoryRow[]>();

    rows.forEach((row) => {
        const sessionId = String(row.session_id || "").trim();
        if (!sessionId) return;
        const group = bySession.get(sessionId) || [];
        group.push(row);
        bySession.set(sessionId, group);
    });

    return Array.from(bySession.entries()).map(([sessionId, sessionRows], index) => {
        const orderedRows = [...sessionRows].sort((a, b) =>
            parseTimestampToUnix(b.created_at || 0) - parseTimestampToUnix(a.created_at || 0)
        );
        const latest = orderedRows[0];
        const latestStage = normalizeStageLabel(latest.pipeline_stage);
        const historicalStages = Array.from(new Set(
            orderedRows.map((row) => normalizeStageLabel(row.pipeline_stage)).filter(Boolean)
        ));
        const latestTimestamp = parseTimestampToUnix(latest.created_at || 0);
        const firstTimestamp = parseTimestampToUnix(orderedRows[orderedRows.length - 1]?.created_at || latest.created_at || 0);
        const phone = String(latest.phone || "").trim();
        const email = String(latest.email || "").trim();
        const fullName = String(latest.full_name || "").trim() || "Sin Nombre";
        const channel = String(latest.channel || "").trim().toLowerCase();
        const inferredInboxId = channel === "whatsapp" ? 1 : undefined;
        const content = String(latest.message?.content || "").trim();

        return {
            id: toConversationId(sessionId, 1000000 + index),
            status: "open",
            labels: Array.from(new Set([latestStage, ...historicalStages])),
            timestamp: latestTimestamp,
            created_at: firstTimestamp,
            meta: {
                sender: {
                    id: sessionId,
                    name: fullName,
                    email: email && email !== "null" ? email : "",
                    phone_number: phone && phone !== "null" ? phone : "",
                    custom_attributes: {},
                    additional_attributes: {},
                },
            },
            custom_attributes: {
                session_id: sessionId,
                canal: channel || undefined,
            },
            conversation_custom_attributes: {
                pipeline_stage: latestStage,
                session_id: sessionId,
            },
            contact_custom_attributes: {},
            resolved_custom_attributes: {
                pipeline_stage: latestStage,
                session_id: sessionId,
                canal: channel || undefined,
            },
            messages: [],
            inbox_id: inferredInboxId,
            last_non_activity_message: {
                content: content || `Ultima etapa registrada: ${latestStage}`,
                created_at: latestTimestamp,
            },
            source: "supabase" as const,
            perfil_url: String(latest.profile_url || "").trim() || undefined,
        };
    }).sort((a, b) => b.timestamp - a.timestamp);
};

export const supabaseDashboardReadClient = {
    async fetchConversations(params: SupabaseConversationReadFilters = {}): Promise<SupabaseConversationReadResult> {
        const fetchLegacyHistoryFallback = async (): Promise<SupabaseConversationReadResult> => {
            const pageSize = params.pageSize || SUPABASE_PAGE_SIZE;
            const payloadRows: N8nChatHistoryRow[] = [];
            let page = params.page || 1;

            while (true) {
                const from = (page - 1) * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .from("n8n_chat_histories")
                    .select("*");

                if (params.beforeIso) query = query.lt("created_at", params.beforeIso);
                if (params.sinceIso) query = query.gte("created_at", params.sinceIso);
                if (params.untilIso) query = query.lte("created_at", params.untilIso);
                if (params.search) {
                    query = query.or(
                        `full_name.ilike.%${params.search}%,phone.ilike.%${params.search}%,email.ilike.%${params.search}%,session_id.ilike.%${params.search}%`
                    );
                }

                const { data, error } = await query
                    .order("created_at", { ascending: false })
                    .range(from, to);

                if (error) throw error;

                const rows = (data || []) as N8nChatHistoryRow[];
                payloadRows.push(...rows);

                if (params.page || rows.length < pageSize) break;
                page += 1;
            }

            const grouped = mapN8nRowsToConversations(payloadRows);
            return {
                payload: uniqueConversationsById(grouped),
                count: grouped.length,
            };
        };

        const pageSize = params.pageSize || SUPABASE_PAGE_SIZE;
        const payload: MinifiedConversation[] = [];
        let page = params.page || 1;
        let totalCount = 0;

        try {
            while (true) {
                const from = (page - 1) * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .schema("cw")
                    .from("conversations_current")
                    .select("*", { count: "exact" });

                if (params.beforeIso) query = query.lt("created_at_chatwoot", params.beforeIso);
                if (params.sinceIso) query = query.gte("created_at_chatwoot", params.sinceIso);
                if (params.untilIso) query = query.lte("created_at_chatwoot", params.untilIso);
                if (params.importedOnly) query = query.lt("chatwoot_conversation_id", 0);
                if (params.search) {
                    query = query.or(`nombre_completo.ilike.%${params.search}%,celular.ilike.%${params.search}%,correo.ilike.%${params.search}%,meta->sender->>name.ilike.%${params.search}%`);
                }

                const { data, error, count } = await query
                    .order("created_at_chatwoot", { ascending: false })
                    .range(from, to);

                if (error) throw error;

                totalCount = count || totalCount;
                const rows = data || [];
                payload.push(...rows.map(mapSupabaseConversationRowToMinified));

                if (params.page || rows.length < pageSize) break;
                page += 1;
            }
        } catch (error) {
            if (isSchemaAccessError(error as { code?: string; message?: string })) {
                return fetchLegacyHistoryFallback();
            }
            throw error;
        }

        return { payload: uniqueConversationsById(payload), count: totalCount || payload.length };
    },

    async fetchIncomingMessageEvents(params: SupabaseIncomingTrafficFilters): Promise<IncomingMessageTrafficEvent[]> {
        const payload: IncomingMessageTrafficEvent[] = [];
        let page = 1;

        while (true) {
            const from = (page - 1) * SUPABASE_PAGE_SIZE;
            const to = from + SUPABASE_PAGE_SIZE - 1;

            let query = supabase
                .schema("cw")
                .from("messages")
                .select("chatwoot_message_id, chatwoot_conversation_id, chatwoot_inbox_id, message_direction, message_type, sender_type, is_private, created_at_chatwoot")
                .eq("message_direction", "incoming")
                .eq("is_private", false)
                .gte("created_at_chatwoot", params.sinceIso)
                .lte("created_at_chatwoot", params.untilIso);

            if (params.selectedInboxes && params.selectedInboxes.length > 0) {
                query = query.in("chatwoot_inbox_id", params.selectedInboxes);
            }

            const { data, error } = await query
                .order("created_at_chatwoot", { ascending: true })
                .range(from, to);

            if (error) throw error;

            const rows = (data || []) as ConversationMessage[];
            rows.forEach((message) => {
                const event = mapIncomingMessageEvent(message, "supabase");
                if (event) payload.push(event);
            });

            if (rows.length < SUPABASE_PAGE_SIZE) break;
            page += 1;
        }

        return payload;
    },
};
