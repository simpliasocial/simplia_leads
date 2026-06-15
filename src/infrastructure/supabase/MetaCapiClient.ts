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

export type MetaCapiEventInput = {
    accountId?: number;
    eventKind: MetaCapiEventKind;
    conversationId: string;
    meetingId?: string;
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
    return invokeAuthenticatedFunction<MetaCapiActionResponse>("meta-capi", body);
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
            event,
        });
    },
};
