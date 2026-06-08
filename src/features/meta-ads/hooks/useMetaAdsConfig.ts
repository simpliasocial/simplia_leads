import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    metaAdsInsightsClient,
    type MetaAdsConfigInput,
} from "@/infrastructure/supabase/MetaAdsInsightsClient";

export const useMetaAdsConfig = (enabled: boolean, accountId = 0) => {
    const queryClient = useQueryClient();
    const queryKey = ["meta-ads-config", accountId];

    const configQuery = useQuery({
        queryKey,
        enabled,
        staleTime: 60 * 1000,
        queryFn: () => metaAdsInsightsClient.getConfig(accountId),
    });

    const saveConfigMutation = useMutation({
        mutationFn: (config: MetaAdsConfigInput) => metaAdsInsightsClient.saveConfig(config),
        onSuccess: (config) => {
            queryClient.setQueryData(queryKey, config);
            void queryClient.invalidateQueries({ queryKey: ["meta-campaign-insights"] });
            toast.success("Configuracion de Meta Ads guardada");
        },
        onError: (error) => {
            console.error("Meta Ads config save failed:", error);
            toast.error(error instanceof Error ? error.message : "No se pudo guardar Meta Ads");
        },
    });

    return {
        config: configQuery.data,
        loadingConfig: configQuery.isLoading,
        configError: configQuery.error,
        refetchConfig: configQuery.refetch,
        saveConfig: saveConfigMutation.mutateAsync,
        savingConfig: saveConfigMutation.isPending,
    };
};
