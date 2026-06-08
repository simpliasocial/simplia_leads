import { useEffect, useState } from "react";
import { Loader2, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type {
    MetaAdsConfig,
    MetaAdsConfigInput,
} from "@/infrastructure/supabase/MetaAdsInsightsClient";

const DEFAULT_FORM: MetaAdsConfigInput = {
    accountId: 0,
    adAccountId: "",
    accessToken: "",
    graphApiVersion: "v20.0",
    enabled: true,
};

const formFromConfig = (config?: MetaAdsConfig): MetaAdsConfigInput => ({
    ...DEFAULT_FORM,
    accountId: config?.accountId ?? DEFAULT_FORM.accountId,
    adAccountId: config?.adAccountId || "",
    accessToken: "",
    graphApiVersion: config?.graphApiVersion || DEFAULT_FORM.graphApiVersion,
    enabled: config?.enabled ?? DEFAULT_FORM.enabled,
});

type MetaAdsConfigDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config?: MetaAdsConfig;
    loadingConfig: boolean;
    savingConfig: boolean;
    onSave: (config: MetaAdsConfigInput) => Promise<unknown>;
};

export const MetaAdsConfigDialog = ({
    open,
    onOpenChange,
    config,
    loadingConfig,
    savingConfig,
    onSave,
}: MetaAdsConfigDialogProps) => {
    const [form, setForm] = useState<MetaAdsConfigInput>(DEFAULT_FORM);

    useEffect(() => {
        if (open) setForm(formFromConfig(config));
    }, [config, open]);

    const disabled = loadingConfig || savingConfig;

    const handleSave = async () => {
        await onSave({
            ...form,
            accessToken: form.accessToken?.trim() || undefined,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <SlidersHorizontal className="h-5 w-5 text-sky-600" />
                        Configurar campañas de Meta Ads
                    </DialogTitle>
                    <DialogDescription>
                        Guarda la cuenta publicitaria y el token de acceso que usará Supabase para traer campañas e insights.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-emerald-600" />
                            <p className="text-sm font-semibold">Token protegido en Supabase</p>
                            {config?.hasAccessToken && (
                                <Badge variant="outline">Termina en {config.tokenLastFour || "****"}</Badge>
                            )}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                            El dashboard solo mostrará los últimos caracteres del token guardado. El valor completo no se devuelve al navegador.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="meta-ads-account-id">ID de cuenta publicitaria</Label>
                        <Input
                            id="meta-ads-account-id"
                            value={form.adAccountId}
                            onChange={(event) => setForm((prev) => ({ ...prev, adAccountId: event.target.value }))}
                            placeholder="1418347812854191"
                            disabled={disabled}
                        />
                        <p className="text-xs text-muted-foreground">
                            Puedes pegarlo con o sin el prefijo act_. Se usará para consultar campañas e insights.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="meta-ads-token">Bearer Token</Label>
                        <Input
                            id="meta-ads-token"
                            type="password"
                            value={form.accessToken}
                            onChange={(event) => setForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                            placeholder={config?.hasAccessToken ? "Dejar vacío para conservar el token guardado" : "Pegar Bearer Token"}
                            disabled={disabled}
                        />
                        <p className="text-xs text-muted-foreground">
                            Si ya existe un token guardado, solo llena este campo cuando quieras rotarlo.
                        </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-2">
                            <Label htmlFor="meta-ads-graph-version">Versión Graph API</Label>
                            <Input
                                id="meta-ads-graph-version"
                                value={form.graphApiVersion}
                                onChange={(event) => setForm((prev) => ({ ...prev, graphApiVersion: event.target.value }))}
                                placeholder="v20.0"
                                disabled={disabled}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                            <Label htmlFor="meta-ads-enabled">Activa</Label>
                            <Switch
                                id="meta-ads-enabled"
                                checked={form.enabled}
                                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={disabled}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={disabled || !form.adAccountId.trim()}>
                        {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Guardar configuración
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
