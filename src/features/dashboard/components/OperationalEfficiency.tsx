import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/shared/ui/dashboard/KPICard";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useDashboardData } from "@/features/dashboard/hooks/useDashboardData";
import { useDashboardContext } from "@/context/useDashboardContext";
import { GUAYAQUIL_TIMEZONE, getGuayaquilDateString } from "@/lib/guayaquilTime";
import { getInboxChannelName } from "@/lib/leadDisplay";
import { HybridDashboardService } from "@/services/HybridDashboardService";
import type { IncomingMessageTrafficEvent } from "@/domain/conversation";
import type { Inbox } from "@/domain/lead";
import {
    AlertCircle,
    Clock,
    Loader2,
    MessageCircle,
    UserCheck,
    Users
} from "lucide-react";

import {
    Tooltip as ShadcnTooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { parseISO, getDay } from "date-fns";

const formatDuration = (seconds: number) => {
    if (!seconds) return "0 s";
    if (seconds < 60) return `${Math.round(seconds)} s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (remainingSeconds === 0) return `${minutes} min`;
    return `${minutes} min ${remainingSeconds} s`;
};

const formatDateFilter = (date?: Date) => date ? getGuayaquilDateString(date) : "Sin fecha";



const sourceLabel = (events: IncomingMessageTrafficEvent[]) => {
    const hasApi = events.some((event) => event.source === "api");
    const hasSupabase = events.some((event) => event.source === "supabase");
    if (hasApi && hasSupabase) return "Datos en vivo + historial";
    if (hasApi) return "Datos en vivo";
    if (hasSupabase) return "Historial disponible";
    return "Sin mensajes";
};

const getTrafficLevel = (value: number, maxValue: number) => {
    if (value <= 0 || maxValue <= 0) return "Sin actividad";

    const intensity = value / maxValue;
    if (intensity > 0.7) return "Tráfico alto";
    if (intensity > 0.3) return "Tráfico medio";
    return "Tráfico bajo";
};

const OperationalEfficiency = () => {
    const {
        globalFilters,
        tagSettings,
        inboxes,
        lastLiveFetchAt
    } = useDashboardContext();
    const { loading, error, data } = useDashboardData({
        ...globalFilters,
        ...tagSettings
    });

    const [trafficEvents, setTrafficEvents] = useState<IncomingMessageTrafficEvent[]>([]);
    const [trafficLoading, setTrafficLoading] = useState(false);
    const [trafficRefreshing, setTrafficRefreshing] = useState(false);
    const [trafficError, setTrafficError] = useState<string | null>(null);
    const [trafficHasLoaded, setTrafficHasLoaded] = useState(false);
    const trafficHasLoadedRef = useRef(false);
    const lastTrafficFilterKeyRef = useRef("");

    const trafficStartMs = globalFilters.startDate?.getTime() || 0;
    const trafficEndMs = globalFilters.endDate?.getTime() || trafficStartMs;
    const selectedInboxKey = (globalFilters.selectedInboxes || []).join(",");
    const liveFetchMs = lastLiveFetchAt?.getTime() || 0;
    const selectedInboxIds = useMemo(
        () => selectedInboxKey
            ? selectedInboxKey.split(",").map(Number).filter(Number.isFinite)
            : [],
        [selectedInboxKey]
    );
    const inboxMap = useMemo(
        () => new Map<number, Inbox>(inboxes.map((inbox) => [Number(inbox.id), inbox])),
        [inboxes]
    );

    useEffect(() => {
        if (!trafficStartMs) return;

        const controller = new AbortController();
        const trafficFilterKey = [
            trafficStartMs,
            trafficEndMs || trafficStartMs,
            selectedInboxKey
        ].join("|");
        const isFilterChange = lastTrafficFilterKeyRef.current !== trafficFilterKey;
        const shouldBlockChart = !trafficHasLoadedRef.current || isFilterChange;

        lastTrafficFilterKeyRef.current = trafficFilterKey;
        if (isFilterChange && trafficHasLoadedRef.current) {
            trafficHasLoadedRef.current = false;
            setTrafficHasLoaded(false);
        }
        setTrafficLoading(shouldBlockChart);
        setTrafficRefreshing(!shouldBlockChart);
        setTrafficError(null);

        HybridDashboardService.fetchHybridIncomingMessageEvents({
            startDate: new Date(trafficStartMs),
            endDate: new Date(trafficEndMs || trafficStartMs),
            selectedInboxes: selectedInboxIds,
            signal: controller.signal
        })
            .then((events) => {
                if (!controller.signal.aborted) {
                    setTrafficEvents(events);
                    setTrafficError(null);
                    if (!trafficHasLoadedRef.current) {
                        trafficHasLoadedRef.current = true;
                        setTrafficHasLoaded(true);
                    }
                }
            })
            .catch((err) => {
                if (!controller.signal.aborted) {
                    console.error("Error loading incoming traffic:", err);
                    if (shouldBlockChart) {
                        setTrafficEvents([]);
                        setTrafficError("No se pudo cargar el trafico de mensajes entrantes.");
                    } else {
                        setTrafficError("No se pudo actualizar el trafico. Se mantiene la ultima vista disponible.");
                    }
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setTrafficLoading(false);
                    setTrafficRefreshing(false);
                }
            });

        return () => controller.abort();
    }, [
        trafficStartMs,
        trafficEndMs,
        selectedInboxKey,
        selectedInboxIds,
        liveFetchMs
    ]);

    const operational = data.operationalMetrics;
    const ownerRows = data.ownerPerformance || [];


    const heatmapData = useMemo(() => {
        const data: Record<number, Record<number, number>> = {};
        // Initialize: 1=Mon ... 6=Sat, 0=Sun
        for (let d = 0; d < 7; d++) {
            data[d] = {};
            for (let h = 0; h < 24; h++) {
                data[d][h] = 0;
            }
        }

        trafficEvents.forEach((event) => {
            // event.date is YYYY-MM-DD
            // We use parseISO and getDay. getDay is 0 (Sun) to 6 (Sat).
            const date = parseISO(event.date);
            const day = getDay(date);
            const hour = event.hour;
            if (day >= 0 && day <= 6 && hour >= 0 && hour <= 23) {
                data[day][hour] += 1;
            }
        });
        return data;
    }, [trafficEvents]);

    const maxHeatmapValue = useMemo(() => {
        let max = 0;
        Object.values(heatmapData).forEach(dayRow => {
            Object.values(dayRow).forEach(count => {
                if (count > max) max = count;
            });
        });
        return max || 1;
    }, [heatmapData]);

    const selectedChannelLabel = useMemo(() => {
        if (selectedInboxIds.length === 0) return "Todos los canales";
        const names = Array.from(new Set(selectedInboxIds
            .map((id) => inboxMap.get(Number(id)))
            .filter((inbox): inbox is Inbox => Boolean(inbox))
            .map((inbox) => getInboxChannelName(inbox))));
        return names.join(", ");
    }, [selectedInboxIds, inboxMap]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-96 text-red-500">
                Error: {error}
            </div>
        );
    }

    const totalLeads = operational.totalLeads || 0;
    const averageResponse = operational.averageFirstResponseSeconds || operational.firstResponseAverageSeconds || 0;
    const rawAverageResponse = operational.firstResponseRawAverageSeconds || 0;
    const responseGraceSeconds = operational.firstResponseGraceSeconds || 60;
    const responseSamples = operational.firstResponseCount || 0;
    const leadsWithoutResponse = operational.leadsSinRespuesta || 0;
    const leadsWithOwner = operational.leadsWithOwnerCount || 0;
    const unassignedLeads = operational.unassignedLeadsCount || ownerRows.find((owner) => owner.source === "sin_asignar")?.leads || 0;
    const leadsWithOwnerPercentage = operational.leadsWithOwnerPercentage || 0;
    const startLabel = formatDateFilter(globalFilters.startDate);
    const endLabel = formatDateFilter(globalFilters.endDate || globalFilters.startDate);

    const ownerSourceLabel = (source?: string) => {
        if (source === "responsable") return "Responsable configurado";
        if (source === "sin_asignar") return "Sin asignar";
        return "Agente asignado";
    };



    return (
        <TooltipProvider>
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <KPICard
                        title="Tiempo promedio de respuesta"
                        value={formatDuration(averageResponse)}
                        subtitle={`Descontados ${formatDuration(responseGraceSeconds)} gracia. Bruto: ${formatDuration(rawAverageResponse)}`}
                        icon={Clock}
                        variant="warning"
                    />

                    <KPICard
                        title="Leads sin respuesta"
                        value={leadsWithoutResponse}
                        subtitle="Interacción del cliente sin respuesta posterior"
                        icon={AlertCircle}
                        variant="destructive"
                    />

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <UserCheck className="w-4 h-4 text-emerald-500" />
                                Leads con responsable
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <div className="text-2xl font-bold">{leadsWithOwnerPercentage}%</div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {leadsWithOwner} de {totalLeads} leads asignados.
                                    </p>
                                </div>
                                <Badge variant="outline">responsable &gt; agente</Badge>
                            </div>
                            <Progress value={leadsWithOwnerPercentage} className="h-1.5 mt-4" />
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Users className="h-5 w-5 text-primary" />
                            Desempeno por Responsable
                        </CardTitle>
                        <CardDescription>
                            El responsable configurado tiene prioridad sobre el agente asignado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto border rounded-xl">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Responsable</th>
                                        <th className="px-4 py-3 text-left">Fuente</th>
                                        <th className="px-4 py-3 text-right">Leads</th>
                                        <th className="px-4 py-3 text-right">Sin respuesta</th>
                                        <th className="px-4 py-3 text-right">Citas</th>
                                        <th className="px-4 py-3 text-right">Conversion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {ownerRows.map((owner) => (
                                        <tr key={owner.name} className="hover:bg-muted/20">
                                            <td className="px-4 py-3 font-medium">{owner.name}</td>
                                            <td className="px-4 py-3">
                                                <Badge variant={owner.source === "responsable" ? "default" : owner.source === "sin_asignar" ? "outline" : "secondary"}>
                                                    {ownerSourceLabel(owner.source)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold">{owner.leads}</td>
                                            <td className="px-4 py-3 text-right">{owner.unanswered || 0}</td>
                                            <td className="px-4 py-3 text-right">{owner.appointments}</td>
                                            <td className="px-4 py-3 text-right font-semibold">{owner.winRate}%</td>
                                        </tr>
                                    ))}
                                    {ownerRows.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                                                No hay leads en este periodo.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <span className="font-semibold">{unassignedLeads} leads sin responsable.</span>{" "}
                            Son leads sin agente asignado y sin responsable configurado.
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <MessageCircle className="h-5 w-5 text-primary" />
                                    Horas pico de tráfico
                                </CardTitle>
                                <CardDescription className="mt-1 max-w-3xl">
                                    Intensidad de mensajes entrantes por día de la semana y hora (Hora local Guayaquil).
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">Rango: {startLabel} - {endLabel}</Badge>
                                <Badge variant="outline">Canal: {selectedChannelLabel}</Badge>
                                <Badge variant="secondary">{GUAYAQUIL_TIMEZONE}</Badge>
                                {trafficRefreshing && <Badge variant="outline">Actualizando…</Badge>}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {trafficLoading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                                <p className="text-sm text-muted-foreground">Calculando mapa de calor...</p>
                            </div>
                        ) : trafficError && !trafficHasLoaded ? (
                            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <AlertCircle className="h-4 w-4" />
                                {trafficError}
                            </div>
                        ) : (
                            <>
                                {trafficError && (
                                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                        <AlertCircle className="h-4 w-4" />
                                        {trafficError}
                                    </div>
                                )}
                                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="space-y-3">
                                            <p className="text-sm text-slate-600">
                                                <span className="font-semibold text-slate-900">¿Cómo se clasifica?</span>{" "}
                                                Cada celda cuenta los mensajes entrantes de ese día y hora, y se compara con la celda de mayor volumen dentro del rango y canal seleccionados.
                                            </p>
                                            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                                    Bajo: más de 0% hasta 30%
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                    Medio: más de 30% hasta 70%
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                                                    Alto: más de 70% hasta 100%
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                                    Sin actividad: 0 mensajes
                                                </span>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="h-fit whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold text-slate-700">
                                            Referencia: 100% = {maxHeatmapValue} {maxHeatmapValue === 1 ? "mensaje" : "mensajes"}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <div className="min-w-[900px] pb-2 pt-2">
                                        <div className="flex">
                                            {/* Day labels */}
                                            <div className="flex flex-col justify-between py-1 pr-6 w-16 text-[11px] font-bold text-muted-foreground uppercase">
                                                {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => (
                                                    <div key={dayIdx} className="h-9 flex items-center">
                                                        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dayIdx]}
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex-1">
                                                {/* Heat grid */}
                                                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
                                                    {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => (
                                                        <div key={`row-${dayIdx}`} className="contents">
                                                            {Array.from({ length: 24 }).map((_, hour) => {
                                                                const val = heatmapData[dayIdx][hour];
                                                                const intensity = val > 0 ? (val / maxHeatmapValue) : 0;
                                                                const trafficLevel = getTrafficLevel(val, maxHeatmapValue);
                                                                return (
                                                                    <ShadcnTooltip key={`cell-${dayIdx}-${hour}`}>
                                                                        <TooltipTrigger asChild>
                                                                            <div
                                                                                className="h-9 rounded-sm transition-all hover:ring-2 hover:ring-orange-500/40 hover:z-10 cursor-default"
                                                                                style={{
                                                                                    backgroundColor: val === 0
                                                                                        ? 'rgba(241, 245, 249, 0.4)'
                                                                                        : `rgba(245, 158, 11, ${0.15 + intensity * 0.85})` // Amber/Orange gradient matching "Fire" heatmap
                                                                                }}
                                                                            />
                                                                        </TooltipTrigger>
                                                                        <TooltipContent className="bg-popover border-border animate-in zoom-in-95 duration-100">
                                                                            <p className="text-[10px] font-bold uppercase text-muted-foreground">
                                                                                {['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayIdx]}
                                                                            </p>
                                                                            <p className="text-sm font-semibold">
                                                                                {hour.toString().padStart(2, '0')}:00 — {trafficLevel}
                                                                            </p>
                                                                            <p className="text-xs text-muted-foreground">
                                                                                {val} {val === 1 ? "mensaje" : "mensajes"} en esta franja.
                                                                            </p>
                                                                        </TooltipContent>
                                                                    </ShadcnTooltip>
                                                                );
                                                            })}
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Hour labels X axis */}
                                                <div className="grid gap-1.5 mt-3" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
                                                    {Array.from({ length: 24 }).map((_, hour) => (
                                                        <div key={`hour-${hour}`} className="text-[10px] text-muted-foreground text-center font-bold">
                                                            {hour % 2 === 0 ? (hour === 0 ? '12' : hour === 12 ? '12' : hour > 12 ? `${hour - 12}` : `${hour}`) : ''}
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* AM/PM */}
                                                <div className="flex mt-2 items-center text-[10px] text-muted-foreground font-bold uppercase tracking-[0.2em]">
                                                    <div className="flex-1 flex justify-center border-t border-muted-foreground/20 pt-2 mr-0.5">AM</div>
                                                    <div className="flex-1 flex justify-center border-t border-muted-foreground/20 pt-2 ml-0.5">PM</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Leyenda */}
                                        <div className="flex justify-center pt-8">
                                            <div className="flex items-center gap-3">
                                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Menor tráfico</span>
                                                <div className="flex gap-1.5 h-3">
                                                    {[0.2, 0.4, 0.6, 0.8, 1].map((lvl) => (
                                                        <div
                                                            key={lvl}
                                                            className="w-12 rounded-full"
                                                            style={{ backgroundColor: `rgba(245, 158, 11, ${0.15 + lvl * 0.85})` }}
                                                        />
                                                    ))}
                                                </div>
                                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Mayor tráfico</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </TooltipProvider>
    );
};

export default OperationalEfficiency;
