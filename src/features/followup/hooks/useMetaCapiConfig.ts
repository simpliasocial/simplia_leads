import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    metaCapiClient,
    type MetaCapiConfigInput,
} from "@/infrastructure/supabase/MetaCapiClient";

export const useMetaCapiConfig = (enabled: boolean, accountId = 0) => {
    const queryClient = useQueryClient();
    const queryKey = ["meta-capi-config", accountId];

    const configQuery = useQuery({
        queryKey,
        enabled,
        staleTime: 60 * 1000,
        queryFn: () => metaCapiClient.getConfig(accountId),
    });

    const saveConfigMutation = useMutation({
        mutationFn: (config: MetaCapiConfigInput) => metaCapiClient.saveConfig(config),
        onSuccess: (config) => {
            queryClient.setQueryData(queryKey, config);
            toast.success("Configuracion Meta CAPI guardada");
        },
        onError: (error) => {
            console.error("Meta CAPI config save failed:", error);
            toast.error(error instanceof Error ? error.message : "No se pudo guardar Meta CAPI");
        },
    });

    const testEventMutation = useMutation({
        mutationFn: () => metaCapiClient.testEvent(accountId),
        onSuccess: () => {
            toast.success("Evento de prueba enviado a Meta CAPI");
        },
        onError: (error) => {
            console.error("Meta CAPI test event failed:", error);
            toast.error(error instanceof Error ? error.message : "No se pudo enviar la prueba Meta CAPI");
        },
    });

    return {
        config: configQuery.data,
        loadingConfig: configQuery.isLoading,
        configError: configQuery.error,
        refetchConfig: configQuery.refetch,
        saveConfig: saveConfigMutation.mutateAsync,
        savingConfig: saveConfigMutation.isPending,
        testEvent: testEventMutation.mutateAsync,
        testingEvent: testEventMutation.isPending,
    };
};
