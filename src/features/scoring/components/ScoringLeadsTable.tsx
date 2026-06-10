import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTablePagination } from "@/components/DataTablePagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Clock, ExternalLink, Search, Target } from "lucide-react";
import { formatDateTime, getLeadExternalUrl, getLeadName, getLeadPhone, getMessagePreview, getMessageTimestamp, getInitials } from "@/lib/leadDisplay";
import { formatBusinessLabel } from "@/lib/displayCopy";
import { formatScoreValue, SCORE_BUCKET_COPY } from "@/lib/leadScoreClassification";
import { buildPaginatedListState, WINDOWED_TABLE_MAX_HEIGHT_PX } from "@/lib/windowedList";
import { extractLeadLabels } from "../model/leadScoringModel";

interface ScoringLeadsTableProps {
    scoreFieldLabel: string;
    activeFilterSummary: string;
    detailRows: any[];
    detailSearch: string;
    setDetailSearch: (value: string) => void;
    openHistory: (lead: any) => void;
}

const BUCKET_COPY = SCORE_BUCKET_COPY;

export const ScoringLeadsTable: React.FC<ScoringLeadsTableProps> = ({
    scoreFieldLabel, activeFilterSummary, detailRows,
    detailSearch, setDetailSearch, openHistory
}) => {
    const [page, setPage] = useState(1);
    const paginatedDetailRows = buildPaginatedListState(detailRows, page);

    useEffect(() => {
        setPage(1);
    }, [detailRows]);

    return (
        <Card>
            <CardHeader className="border-b pb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Target className="h-5 w-5 text-primary" />
                            Leads evaluados
                        </CardTitle>
                        <CardDescription className="space-y-1">
                            <span className="block">
                                El puntaje sale de <span className="font-semibold text-foreground">{scoreFieldLabel}</span>. {activeFilterSummary}
                            </span>
                            <span className="block">
                                Total encontrados: <span className="font-semibold text-foreground">{paginatedDetailRows.total}</span> · más recientes primero
                            </span>
                        </CardDescription>
                    </div>
                    <div className="relative min-w-[260px]">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={detailSearch}
                            onChange={(event) => setDetailSearch(event.target.value)}
                            placeholder="Buscar lead, canal, estado, campaña o nivel..."
                            className="h-9 pl-9 text-sm"
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="rounded-xl border bg-background shadow-sm">
                    <div
                        className={paginatedDetailRows.hasVerticalScroll ? "overflow-auto overscroll-contain" : "overflow-x-auto"}
                        style={paginatedDetailRows.hasVerticalScroll ? { maxHeight: `${WINDOWED_TABLE_MAX_HEIGHT_PX}px` } : undefined}
                    >
                        <table className="w-full min-w-[1480px] text-left text-sm">
                            <thead className="sticky top-0 z-10 border-b bg-muted/95 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                                <tr>
                                    <th className="px-4 py-3">Nombre del lead</th>
                                    <th className="px-4 py-3">Nivel</th>
                                    <th className="px-4 py-3">Puntaje</th>
                                    <th className="px-4 py-3">Canal</th>
                                    <th className="px-4 py-3">Número</th>
                                    <th className="px-4 py-3">Estado</th>
                                    <th className="px-4 py-3">Historial de mensajes</th>
                                    <th className="px-4 py-3">URL</th>
                                    <th className="px-4 py-3">Campaña</th>
                                    <th className="px-4 py-3">Fecha de ingreso</th>
                                    <th className="px-4 py-3">Última interacción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {paginatedDetailRows.visibleItems.length === 0 ? (
                                    <tr>
                                        <td className="px-4 py-12 text-center text-muted-foreground" colSpan={11}>
                                            No hay leads para mostrar con estos filtros.
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedDetailRows.visibleItems.map(item => {
                                        const labels = extractLeadLabels(item.lead);
                                        const phone = getLeadPhone(item.lead, item.channel);
                                        const lastMessageDate = formatDateTime(getMessageTimestamp(item.lead));
                                        const externalUrl = getLeadExternalUrl(item.lead, item.channel);

                                        return (
                                            <tr key={item.lead.id} className="hover:bg-muted/20">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase text-primary shadow-sm">
                                                            {getInitials(getLeadName(item.lead))}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="truncate font-semibold">{getLeadName(item.lead)}</div>
                                                            <div className="truncate text-[10px] text-muted-foreground">ID {item.lead.id}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant="outline" className={BUCKET_COPY[item.bucket].bg}>{item.bucketLabel}</Badge>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-bold">{formatScoreValue(item.score)}</div>
                                                    <div className="text-[10px] text-muted-foreground">{BUCKET_COPY[item.bucket].description}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant="secondary" className="px-2 py-0 text-[10px] font-bold uppercase">
                                                        {item.channel}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground">
                                                    {phone || "Sin número"}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex max-w-[260px] flex-wrap gap-1">
                                                        {labels.length > 0 ? (
                                                            labels.map((label) => (
                                                                <Badge key={`${item.lead.id}-${label}`} variant="outline" className="h-5 px-2 text-[9px] font-bold">
                                                                    {formatBusinessLabel(label)}
                                                                </Badge>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">Sin estado</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => openHistory(item.lead)}
                                                        className="flex max-w-[340px] flex-col text-left hover:text-primary"
                                                    >
                                                        <span className="truncate text-xs font-medium text-foreground">{getMessagePreview(item.lead)}</span>
                                                        <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                                            <Clock className="h-3 w-3" />
                                                            {lastMessageDate}
                                                        </span>
                                                        <span className="mt-1 text-[10px] text-primary">Ver historial</span>
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {externalUrl ? (
                                                        <a href={externalUrl} target="_blank" rel="noreferrer">
                                                            <Button size="sm" variant="outline" className="h-8 gap-2 text-xs">
                                                                <ExternalLink className="h-3.5 w-3.5" />
                                                                Abrir URL
                                                            </Button>
                                                        </a>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">Sin URL</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">{item.campaign}</td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(item.lead.created_at || item.lead.timestamp)}</td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(item.lead.timestamp || item.lead.created_at)}</td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    <DataTablePagination
                        total={paginatedDetailRows.total}
                        page={paginatedDetailRows.page}
                        pageCount={paginatedDetailRows.pageCount}
                        start={paginatedDetailRows.start}
                        end={paginatedDetailRows.end}
                        onPageChange={setPage}
                    />
                </div>
            </CardContent>
        </Card>
    );
};
