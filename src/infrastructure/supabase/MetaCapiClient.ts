import { invokeAuthenticatedFunction } from "./EdgeFunctionClient";

export type MetaCapiConfig = {
    accountId: number;
    graphVersion: string;
    datasetId: string;
    tokenLastFour: string;
    hasAccessToken: boolean;
    eventSourceUrl: string;
    eventName: string;
    source: string;
    systemName: string;
    appointmentStatus: string;
    actionSource: string;
    defaultChannel: string;
    clientUserAgent: string;
    testEventCode: string;
    enabled: boolean;
    configuredAt: string | null;
    updatedAt: string | null;
};

export type MetaCapiConfigInput = Omit<
    MetaCapiConfig,
    "tokenLastFour" | "hasAccessToken" | "configuredAt" | "updatedAt"
> & {
    accessToken?: string;
};

export type MetaCapiEventKind = "appointment" | "sale" | "test";

export type MetaCapiLeadPayload = {
    id?: string | number;
    fullName?: string;
    email?: string;
    phone?: string;
    conversationId?: string;
    meetingId?: string;
};

export type MetaCapiEventInput = {
    accountId?: number;
    eventKind: MetaCapiEventKind;
    conversationId?: string;
    meetingId?: string;
    lead?: MetaCapiLeadPayload;
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

export type MetaCapiActionResponse = {
    ok: boolean;
    status?: "success" | "error" | "skipped";
    skipped?: boolean;
    reason?: string;
    config?: MetaCapiConfig;
    configured?: boolean;
    auditId?: string;
    eventId?: string;
    eventName?: string;
    testMode?: boolean;
    message?: string;
    error?: string;
};

const invokeMetaCapi = async (body: Record<string, unknown>): Promise<MetaCapiActionResponse> => {
    const payload = await invokeAuthenticatedFunction<MetaCapiActionResponse>("meta-capi", body);
    if (payload.status === "skipped") {
        return {
            ...payload,
            skipped: true,
            reason: payload.reason || payload.message || payload.error || "Evento omitido por Meta CAPI.",
        };
    }
    return payload;
};

const normalizeMetaCapiEvent = (event: MetaCapiEventInput): MetaCapiEventInput => {
    const { lead, ...rest } = event;
    if (!lead) return rest;

    return {
        ...rest,
        conversationId: rest.conversationId || lead.conversationId || String(lead.id || ""),
        meetingId: rest.meetingId || lead.meetingId,
        name: rest.name || lead.fullName,
        email: rest.email || lead.email,
        phone: rest.phone || lead.phone,
    };
};

export const metaCapiClient = {
    async getConfig(accountId = 0) {
        const payload = await invokeMetaCapi({
            action: "get_config",
            accountId,
        });

        if (!payload.ok || !payload.config) {
            throw new Error(payload.error || "No se pudo cargar la configuracion Meta CAPI.");
        }

        return payload.config;
    },

    async saveConfig(config: MetaCapiConfigInput) {
        const payload = await invokeMetaCapi({
            action: "save_config",
            config,
        });

        if (!payload.ok || !payload.config) {
            throw new Error(payload.error || "No se pudo guardar la configuracion Meta CAPI.");
        }

        return payload.config;
    },

    async testEvent(accountId = 0) {
        const payload = await invokeMetaCapi({
            action: "test_event",
            accountId,
        });

        if (!payload.ok || payload.status !== "success") {
            throw new Error(payload.error || payload.message || "Meta CAPI no recibio el evento de prueba.");
        }

        return payload;
    },

    async sendEvent(event: MetaCapiEventInput) {
        return invokeMetaCapi({
            action: "send_event",
            event: normalizeMetaCapiEvent(event),
        });
    },
};
