import { useEffect, useState } from "react";
import { Loader2, Save, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    type MetaCapiConfig,
    type MetaCapiConfigInput,
} from "@/infrastructure/supabase/MetaCapiClient";
import { useMetaCapiConfig } from "@/features/followup/hooks/useMetaCapiConfig";

const DEFAULT_FORM: MetaCapiConfigInput = {
    accountId: 0,
    graphVersion: "v20.0",
    datasetId: "",
    accessToken: "",
    eventSourceUrl: "",
    eventName: "Schedule",
    source: "chatwoot",
    systemName: "Simplia Leads",
    appointmentStatus: "scheduled",
    actionSource: "website",
    defaultChannel: "whatsapp",
    clientUserAgent: "Mozilla/5.0",
    testEventCode: "",
    enabled: true,
};

const formFromConfig = (config?: MetaCapiConfig): MetaCapiConfigInput => ({
    ...DEFAULT_FORM,
    accountId: config?.accountId ?? DEFAULT_FORM.accountId,
    graphVersion: config?.graphVersion || DEFAULT_FORM.graphVersion,
    datasetId: config?.datasetId || "",
    accessToken: "",
    eventSourceUrl: config?.eventSourceUrl || "",
    eventName: config?.eventName || DEFAULT_FORM.eventName,
    source: config?.source || DEFAULT_FORM.source,
    systemName: config?.systemName || DEFAULT_FORM.systemName,
    appointmentStatus: config?.appointmentStatus || DEFAULT_FORM.appointmentStatus,
    actionSource: config?.actionSource || DEFAULT_FORM.actionSource,
    defaultChannel: config?.defaultChannel || DEFAULT_FORM.defaultChannel,
    clientUserAgent: config?.clientUserAgent || DEFAULT_FORM.clientUserAgent,
    testEventCode: config?.testEventCode || "",
    enabled: config?.enabled ?? DEFAULT_FORM.enabled,
});

type TextFieldKey = Exclude<keyof MetaCapiConfigInput, "enabled" | "accountId">;

type MetaCapiConfigSectionProps = {
    canConfigure: boolean;
};

export const MetaCapiConfigSection = ({ canConfigure }: MetaCapiConfigSectionProps) => {
    const {
        config,
        loadingConfig,
        configError,
        saveConfig,
        savingConfig,
        testEvent,
        testingEvent,
    } = useMetaCapiConfig(canConfigure);
    const [form, setForm] = useState<MetaCapiConfigInput>(DEFAULT_FORM);

    useEffect(() => {
        setForm(formFromConfig(config));
    }, [config]);

    if (!canConfigure) return null;

    const updateTextField = (key: TextFieldKey, value: string) => {
        setForm((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const handleSave = async () => {
        await saveConfig({
            ...form,
            accessToken: form.accessToken?.trim() || undefined,
        });
    };

    const handleTestEvent = async () => {
        await testEvent();
    };

    const disabled = loadingConfig || savingConfig || testingEvent;

    return (
        <section className="rounded-xl border bg-muted/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">Configurar API CAPI</h3>
                        <Badge variant={form.enabled ? "default" : "secondary"}>
                            {form.enabled ? "Activa" : "Inactiva"}
                        </Badge>
                        {config?.hasAccessToken && (
                            <Badge variant="outline">Token termina en {config.tokenLastFour || "****"}</Badge>
                        )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Meta Conversions API para cita agendada, venta exitosa y pruebas con test_event_code.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {loadingConfig && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
            </div>

            {configError && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {configError instanceof Error ? configError.message : "No se pudo cargar Meta CAPI"}
                </div>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-graph-version">Graph version</Label>
                    <Input
                        id="meta-capi-graph-version"
                        value={form.graphVersion}
                        onChange={(event) => updateTextField("graphVersion", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-dataset-id">Dataset / Pixel ID</Label>
                    <Input
                        id="meta-capi-dataset-id"
                        value={form.datasetId}
                        onChange={(event) => updateTextField("datasetId", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-access-token">Access token</Label>
                    <Input
                        id="meta-capi-access-token"
                        type="password"
                        value={form.accessToken}
                        placeholder={config?.hasAccessToken ? "Dejar vacío para conservar" : "Pegar token CAPI"}
                        onChange={(event) => updateTextField("accessToken", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="meta-capi-source-url">Event source URL</Label>
                    <Input
                        id="meta-capi-source-url"
                        value={form.eventSourceUrl}
                        onChange={(event) => updateTextField("eventSourceUrl", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-test-code">test_event_code</Label>
                    <Input
                        id="meta-capi-test-code"
                        value={form.testEventCode}
                        onChange={(event) => updateTextField("testEventCode", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-event-name">Evento cita</Label>
                    <Input
                        id="meta-capi-event-name"
                        value={form.eventName}
                        onChange={(event) => updateTextField("eventName", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-source">Source</Label>
                    <Input
                        id="meta-capi-source"
                        value={form.source}
                        onChange={(event) => updateTextField("source", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-system-name">System name</Label>
                    <Input
                        id="meta-capi-system-name"
                        value={form.systemName}
                        onChange={(event) => updateTextField("systemName", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-appointment-status">Appointment status</Label>
                    <Input
                        id="meta-capi-appointment-status"
                        value={form.appointmentStatus}
                        onChange={(event) => updateTextField("appointmentStatus", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-action-source">Action source</Label>
                    <Input
                        id="meta-capi-action-source"
                        value={form.actionSource}
                        onChange={(event) => updateTextField("actionSource", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="meta-capi-default-channel">Canal fallback</Label>
                    <Input
                        id="meta-capi-default-channel"
                        value={form.defaultChannel}
                        onChange={(event) => updateTextField("defaultChannel", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="meta-capi-user-agent">Client user agent fallback</Label>
                    <Input
                        id="meta-capi-user-agent"
                        value={form.clientUserAgent}
                        onChange={(event) => updateTextField("clientUserAgent", event.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
                    <Label htmlFor="meta-capi-enabled">Envios CAPI</Label>
                    <Switch
                        id="meta-capi-enabled"
                        checked={form.enabled}
                        onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                    El payload auditado queda en Supabase con user_data hasheado y sin access_token.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleTestEvent}
                        disabled={disabled || !form.testEventCode.trim()}
                    >
                        {testingEvent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Probar test
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={disabled}
                    >
                        {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Guardar CAPI
                    </Button>
                </div>
            </div>
        </section>
    );
};
