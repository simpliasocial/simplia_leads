import { Fragment, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Loader2,
    Megaphone,
    RefreshCw,
    Search,
    SlidersHorizontal,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { DashboardFilters } from "@/domain/dashboard";
import { canConfigureMetaAds } from "@/domain/auth/permissions";
import { useAuth } from "@/context/useAuth";
import { formatBusinessLabel } from "@/lib/displayCopy";
import { useMetaCampaignInsights } from "../hooks/useMetaCampaignInsights";
import { useMetaAdsConfig } from "../hooks/useMetaAdsConfig";
import { MetaAdsConfigDialog } from "./MetaAdsConfigDialog";
import {
    metaRowMatchesSearch,
    type MetaActionMetric,
    type MetaCampaignInsightRow,
} from "../model/metaAdsInsightsModel";

const PAGE_SIZE = 10;

const currencyFormatter = new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
});

const compactNumberFormatter = new Intl.NumberFormat("es-EC", {
    maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(value || 0);
const formatNumber = (value: number) => compactNumberFormatter.format(value || 0);
const formatPercent = (value: number) => `${compactNumberFormatter.format(value || 0)}%`;

const formatLocalDateTime = (value?: string) => {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("es-EC", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(date);
};

const sourceLabel = (source?: string) => {
    if (source === "fresh") return "Meta actualizado";
    if (source === "cache") return "Caché vigente";
    if (source === "stale") return "Caché anterior";
    return "Meta Ads";
};

const MetricTile = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
);

const ActionList = ({ title, items }: { title: string; items: MetaActionMetric[] }) => (
    <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin valores reportados.</p>
        ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                    <div key={`${title}-${item.action_type}`} className="rounded-md border bg-background p-2">
                        <p className="truncate text-xs text-muted-foreground" title={item.action_type}>
                            {formatBusinessLabel(item.action_type)}
                        </p>
                        <p className="text-sm font-semibold">{formatNumber(item.value)}</p>
                    </div>
                ))}
            </div>
        )}
    </div>
);

const DetailRow = ({ row }: { row: MetaCampaignInsightRow }) => (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
        <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <div>
                <p className="text-xs text-muted-foreground">Campaign ID</p>
                <p className="font-medium">{row.campaignId || "Sin ID"}</p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">Ad set ID</p>
                <p className="font-medium">{row.adsetId || "Sin ID"}</p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">Creada</p>
                <p className="font-medium">{row.campaignCreatedTime || "Sin fecha"}</p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">Rango campaña</p>
                <p className="font-medium">{row.campaignStartTime || "Sin inicio"} - {row.campaignStopTime || "Sin fin"}</p>
            </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
            <ActionList title="Acciones" items={row.actions} />
            <ActionList title="Costo por acción" items={row.costPerActionType} />
            <ActionList title="Valores de acción" items={row.actionValues} />
            <ActionList title="ROAS" items={row.purchaseRoas} />
        </div>

        {row.rawMetrics && (
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payload crudo sin secretos</p>
                <pre className="max-h-52 overflow-auto rounded-md border bg-background p-3 text-xs">
                    {JSON.stringify(row.rawMetrics, null, 2)}
                </pre>
            </div>
        )}
    </div>
);

export const MetaCampaignInsightsTable = ({ filters }: { filters: DashboardFilters }) => {
    const { data, isLoading, isFetching, error, refetch } = useMetaCampaignInsights(filters);
    const { role } = useAuth();
    const canConfigureCampaigns = canConfigureMetaAds(role);
    const {
        config,
        loadingConfig,
        saveConfig,
        savingConfig,
    } = useMetaAdsConfig(canConfigureCampaigns);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [configDialogOpen, setConfigDialogOpen] = useState(false);

    const rows = data?.rows || [];
    const filteredRows = useMemo(
        () => rows.filter((row) => metaRowMatchesSearch(row, search)),
        [rows, search],
    );
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    useEffect(() => {
        setPage(1);
    }, [search, data?.range.since, data?.range.until]);

    const summary = data?.summary;
    const showEmpty = !isLoading && rows.length === 0 && !error;

    return (
        <Card>
            <CardHeader className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Megaphone className="h-5 w-5 text-sky-600" />
                            Meta Ads: campañas e insights
                        </CardTitle>
                        <CardDescription>
                            Combina campañas e insights por conjunto de anuncios en el rango filtrado.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{sourceLabel(data?.source)}</Badge>
                        {(config?.adAccountId || data?.accountId) && (
                            <Badge variant="secondary">Cuenta {config?.adAccountId || data?.accountId}</Badge>
                        )}
                        {data?.fetchedAt && <Badge variant="secondary">Actualizado {formatLocalDateTime(data.fetchedAt)}</Badge>}
                        {canConfigureCampaigns && (
                            <Button
                                variant="default"
                                size="sm"
                                onClick={() => setConfigDialogOpen(true)}
                                className="gap-2"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                Configurar campañas
                            </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
                            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Actualizar
                        </Button>
                    </div>
                </div>

                {data?.warning && (
                    <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{data.warning}</AlertDescription>
                    </Alert>
                )}

                {error && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{error instanceof Error ? error.message : "No se pudo cargar Meta Ads."}</AlertDescription>
                    </Alert>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                    <MetricTile label="Campañas" value={formatNumber(summary?.campaigns || 0)} />
                    <MetricTile label="Ad sets" value={formatNumber(summary?.adsets || 0)} />
                    <MetricTile label="Gasto" value={formatCurrency(summary?.spend || 0)} />
                    <MetricTile label="Impresiones" value={formatNumber(summary?.impressions || 0)} />
                    <MetricTile label="Alcance" value={formatNumber(summary?.reach || 0)} />
                    <MetricTile label="Clics" value={formatNumber(summary?.clicks || 0)} />
                    <MetricTile label="CTR" value={formatPercent(summary?.averageCtr || 0)} />
                    <MetricTile label="CPC" value={formatCurrency(summary?.averageCpc || 0)} />
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative max-w-xl flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar campaña, ad set, estado u objetivo"
                            className="pl-9"
                        />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {filteredRows.length} fila{filteredRows.length === 1 ? "" : "s"} · {data?.range.since || ""} a {data?.range.until || ""}
                    </p>
                </div>

                {isLoading ? (
                    <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Cargando campañas de Meta...
                    </div>
                ) : showEmpty ? (
                    <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        No hay campañas de Meta disponibles para mostrar.
                    </div>
                ) : (
                    <>
                        <div className="rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[44px]" />
                                        <TableHead className="min-w-[280px]">Campaña</TableHead>
                                        <TableHead className="min-w-[150px]">Estado</TableHead>
                                        <TableHead className="min-w-[180px]">Ad set</TableHead>
                                        <TableHead className="text-right">Gasto</TableHead>
                                        <TableHead className="text-right">Impresiones</TableHead>
                                        <TableHead className="text-right">Alcance</TableHead>
                                        <TableHead className="text-right">Frecuencia</TableHead>
                                        <TableHead className="text-right">Clics</TableHead>
                                        <TableHead className="text-right">Link clicks</TableHead>
                                        <TableHead className="text-right">Outbound</TableHead>
                                        <TableHead className="text-right">CTR</TableHead>
                                        <TableHead className="text-right">CPC</TableHead>
                                        <TableHead className="text-right">CPM</TableHead>
                                        <TableHead className="min-w-[150px]">Rango</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visibleRows.map((row) => {
                                        const expanded = expandedKey === row.rowKey;
                                        return (
                                            <Fragment key={row.rowKey}>
                                                <TableRow key={row.rowKey}>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => setExpandedKey(expanded ? null : row.rowKey)}
                                                            title={expanded ? "Ocultar detalle" : "Ver detalle"}
                                                        >
                                                            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell className="max-w-[360px]">
                                                        <div className="space-y-1">
                                                            <p className="truncate font-semibold" title={row.campaignName}>{row.campaignName}</p>
                                                            <p className="truncate text-xs text-muted-foreground">{row.campaignId}</p>
                                                            {row.objective && <Badge variant="outline">{formatBusinessLabel(row.objective)}</Badge>}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-1">
                                                            <Badge variant={row.campaignEffectiveStatus === "ACTIVE" ? "default" : "secondary"}>
                                                                {formatBusinessLabel(row.campaignEffectiveStatus || row.campaignStatus || "Sin estado")}
                                                            </Badge>
                                                            {row.campaignStatus && (
                                                                <p className="text-xs text-muted-foreground">Configurado: {formatBusinessLabel(row.campaignStatus)}</p>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="max-w-[260px]">
                                                        <p className="truncate font-medium" title={row.adsetName}>{row.adsetName}</p>
                                                        <p className="truncate text-xs text-muted-foreground">{row.adsetId || "Sin ID"}</p>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">{formatCurrency(row.spend)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.impressions)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.reach)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.frequency)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.clicks)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.inlineLinkClicks)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(row.outboundClicks)}</TableCell>
                                                    <TableCell className="text-right">{formatPercent(row.ctr)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.cpc)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.cpm)}</TableCell>
                                                    <TableCell>
                                                        <p className="text-sm">{row.dateStart}</p>
                                                        <p className="text-xs text-muted-foreground">{row.dateStop}</p>
                                                    </TableCell>
                                                </TableRow>
                                                {expanded && (
                                                    <TableRow key={`${row.rowKey}-detail`}>
                                                        <TableCell colSpan={15} className="bg-muted/10">
                                                            <DetailRow row={row} />
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                Página {currentPage} de {pageCount}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                                    disabled={currentPage <= 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                                    disabled={currentPage >= pageCount}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>

            <MetaAdsConfigDialog
                open={configDialogOpen}
                onOpenChange={setConfigDialogOpen}
                config={config}
                loadingConfig={loadingConfig}
                savingConfig={savingConfig}
                onSave={saveConfig}
            />
        </Card>
    );
};
