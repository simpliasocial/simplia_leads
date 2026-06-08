import { supabase } from "@/lib/supabase";
import type { MetaCampaignInsightsResponse } from "@/features/meta-ads/model/metaAdsInsightsModel";

export interface FetchMetaCampaignInsightsParams {
    since: string;
    until: string;
    forceRefresh?: boolean;
}

export interface MetaAdsConfig {
    configured: boolean;
    accountId: number;
    adAccountId: string;
    tokenLastFour: string;
    hasAccessToken: boolean;
    graphApiVersion: string;
    enabled: boolean;
    configuredAt: string | null;
    updatedAt: string | null;
}

export interface MetaAdsConfigInput {
    accountId?: number;
    adAccountId: string;
    accessToken?: string;
    graphApiVersion: string;
    enabled: boolean;
}

type MetaAdsConfigResponse = MetaAdsConfig & {
    ok: boolean;
    error?: string;
};

const errorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    const record = error && typeof error === "object" ? error as { message?: unknown } : {};
    return String(record.message || "No se pudo cargar Meta Ads.");
};

export const metaAdsInsightsClient = {
    async getConfig(accountId = 0): Promise<MetaAdsConfig> {
        const { data, error } = await supabase.functions.invoke("meta-campaign-insights", {
            body: {
                action: "get_config",
                accountId,
            },
        });

        if (error) throw new Error(errorMessage(error));

        const payload = data as MetaAdsConfigResponse;
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo cargar la configuracion de Meta Ads.");
        }

        return payload;
    },

    async saveConfig(config: MetaAdsConfigInput): Promise<MetaAdsConfig> {
        const { data, error } = await supabase.functions.invoke("meta-campaign-insights", {
            body: {
                action: "save_config",
                config,
            },
        });

        if (error) throw new Error(errorMessage(error));

        const payload = data as MetaAdsConfigResponse;
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo guardar la configuracion de Meta Ads.");
        }

        return payload;
    },

    async fetchCampaignInsights(params: FetchMetaCampaignInsightsParams): Promise<MetaCampaignInsightsResponse> {
        const { data, error } = await supabase.functions.invoke("meta-campaign-insights", {
            body: {
                since: params.since,
                until: params.until,
                forceRefresh: params.forceRefresh === true,
            },
        });

        if (error) throw new Error(errorMessage(error));

        const payload = data as MetaCampaignInsightsResponse & { error?: string };
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo cargar Meta Ads.");
        }

        return payload;
    },
};
