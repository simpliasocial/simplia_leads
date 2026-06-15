import type { MetaCampaignInsightsResponse } from "@/features/meta-ads/model/metaAdsInsightsModel";
import { invokeAuthenticatedFunction } from "./EdgeFunctionClient";

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

export const metaAdsInsightsClient = {
    async getConfig(accountId = 0): Promise<MetaAdsConfig> {
        const payload = await invokeAuthenticatedFunction<MetaAdsConfigResponse>("meta-campaign-insights", {
            action: "get_config",
            accountId,
        });
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo cargar la configuracion de Meta Ads.");
        }

        return payload;
    },

    async saveConfig(config: MetaAdsConfigInput): Promise<MetaAdsConfig> {
        const payload = await invokeAuthenticatedFunction<MetaAdsConfigResponse>("meta-campaign-insights", {
            action: "save_config",
            config,
        });
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo guardar la configuracion de Meta Ads.");
        }

        return payload;
    },

    async fetchCampaignInsights(params: FetchMetaCampaignInsightsParams): Promise<MetaCampaignInsightsResponse> {
        const payload = await invokeAuthenticatedFunction<MetaCampaignInsightsResponse & { error?: string }>("meta-campaign-insights", {
            since: params.since,
            until: params.until,
            forceRefresh: params.forceRefresh === true,
        });
        if (!payload?.ok) {
            throw new Error(payload?.error || "No se pudo cargar Meta Ads.");
        }

        return payload;
    },
};
