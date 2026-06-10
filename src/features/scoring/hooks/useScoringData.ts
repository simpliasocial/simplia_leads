import { useEffect, useMemo, useState } from "react";
import { useDashboardContext } from "@/context/useDashboardContext";
import type { ResolvedConversation } from "@/context/dashboardDataTypes";
import { getLeadChannelName, normalize, getLeadPhone, getRawLeadPhone, getLeadName, getMessagePreview, formatDateTime, getMessageTimestamp } from "@/lib/leadDisplay";
import { bucketFromScore, parseNumericScore, formatScoreValue, SCORE_BUCKET_COPY, SCORE_BUCKET_ORDER, type ScoreBucket } from "@/lib/leadScoreClassification";
import { formatBusinessLabel, formatFieldLabel } from "@/lib/displayCopy";
import { extractLeadLabels, parseDate, percent, resolveLeadCampaign, scoreAverage, unique, type ScoreDimension } from "@/features/scoring/model/leadScoringModel";
import type { Inbox } from "@/domain/lead";

export interface PreparedLead {
    lead: ResolvedConversation;
    score: number | null;
    bucket: ScoreBucket;
    bucketLabel: string;
    channel: string;
    campaign: string;
    owner: string;
    attributeKey: string;
    attributeLabel: string;
}

const BUCKET_ORDER = SCORE_BUCKET_ORDER;
const BUCKET_COPY = SCORE_BUCKET_COPY;

export const useScoringData = (config: {
    activeScoreAttributeKey: string;
    activeScoreThresholds: { hotMin: number; warmMin: number };
    activeAppointmentLabels: string[];
    selectedScoreAttribute: { label: string } | null;
    actualLabels: string[];
}) => {
    const { conversations, inboxes, globalFilters } = useDashboardContext();

    const [campaignFilter, setCampaignFilter] = useState("all");
    const [labelFilters, setLabelFilters] = useState<string[]>([]);
    const [ownerFilter, setOwnerFilter] = useState("all");
    const [bucketFilter, setBucketFilter] = useState("all");
    const [detailSearch, setDetailSearch] = useState("");
    const [scoreDimension, setScoreDimension] = useState<ScoreDimension>("label");

    const inboxMap = useMemo(() => new Map<number, Inbox>(inboxes.map(inbox => [Number(inbox.id), inbox])), [inboxes]);

    const dateFilteredLeads = useMemo(() => {
        const start = globalFilters.startDate ? new Date(globalFilters.startDate) : new Date(2024, 0, 1);
        start.setHours(0, 0, 0, 0);
        const end = globalFilters.endDate ? new Date(globalFilters.endDate) : new Date(2030, 0, 1);
        end.setHours(23, 59, 59, 999);
        const selectedInboxes = globalFilters.selectedInboxes || [];
        return conversations.filter(lead => {
            if (selectedInboxes.length > 0 && !selectedInboxes.includes(Number(lead.inbox_id))) return false;
            const createdAt = parseDate(lead.created_at || lead.timestamp);
            return createdAt >= start && createdAt <= end;
        });
    }, [conversations, globalFilters.startDate, globalFilters.endDate, globalFilters.selectedInboxes]);

    const preparedLeads = useMemo<PreparedLead[]>(() => {
        const selectedAttributeLabel = config.selectedScoreAttribute?.label || formatFieldLabel(config.activeScoreAttributeKey) || "Sin campo";
        return dateFilteredLeads.map(lead => {
            const inbox = lead.inbox_id ? inboxMap.get(Number(lead.inbox_id)) : null;
            const score = config.activeScoreAttributeKey ? parseNumericScore(lead.resolvedAttrs[config.activeScoreAttributeKey]) : null;
            const bucket = bucketFromScore(score, config.activeScoreThresholds);
            return {
                lead, score, bucket,
                bucketLabel: BUCKET_COPY[bucket].label,
                channel: getLeadChannelName(lead, inbox),
                campaign: resolveLeadCampaign(lead),
                owner: String(lead.resolvedAttrs.responsable || lead.meta?.assignee?.name || "").trim() || "Sin responsable",
                attributeKey: config.activeScoreAttributeKey,
                attributeLabel: selectedAttributeLabel,
            };
        });
    }, [dateFilteredLeads, inboxMap, config.activeScoreAttributeKey, config.activeScoreThresholds, config.selectedScoreAttribute]);

    const scorablePreparedLeads = useMemo(() => preparedLeads.filter((i): i is PreparedLead & { score: number } => i.score !== null), [preparedLeads]);
    const scoreVisibleLabels = useMemo(() => unique(scorablePreparedLeads.flatMap(i => extractLeadLabels(i.lead))), [scorablePreparedLeads]);
    const allVisibleLabels = useMemo(() => unique([...config.actualLabels, ...preparedLeads.flatMap(i => extractLeadLabels(i.lead))]), [config.actualLabels, preparedLeads]);

    const filterOptions = useMemo(() => ({
        campaigns: unique(preparedLeads.map(i => i.campaign)),
        labels: allVisibleLabels,
        owners: unique(preparedLeads.map(i => i.owner)),
    }), [preparedLeads, allVisibleLabels]);

    useEffect(() => {
        if (campaignFilter !== "all" && !filterOptions.campaigns.includes(campaignFilter)) setCampaignFilter("all");
        if (ownerFilter !== "all" && !filterOptions.owners.includes(ownerFilter)) setOwnerFilter("all");
        setLabelFilters(cur => cur.some(l => !filterOptions.labels.includes(l)) ? cur.filter(l => filterOptions.labels.includes(l)) : cur);
    }, [campaignFilter, ownerFilter, filterOptions]);

    const visiblePreparedLeads = useMemo(() => preparedLeads.filter(item => {
        if (campaignFilter !== "all" && item.campaign !== campaignFilter) return false;
        if (labelFilters.length > 0 && !extractLeadLabels(item.lead).some(l => labelFilters.includes(l))) return false;
        if (ownerFilter !== "all" && item.owner !== ownerFilter) return false;
        return true;
    }), [preparedLeads, campaignFilter, labelFilters, ownerFilter]);

    const filteredLeads = useMemo(() => visiblePreparedLeads.filter(item => bucketFilter === "all" || item.bucket === bucketFilter), [visiblePreparedLeads, bucketFilter]);

    const scoredFilteredLeads = filteredLeads.filter((i): i is PreparedLead & { score: number } => i.score !== null);
    const filteredMissingScoreCount = filteredLeads.filter(i => i.score === null).length;

    const isAppointmentLead = (lead: ResolvedConversation) => {
        const hasLabel = config.activeAppointmentLabels.length > 0 && lead.resolvedLabels.some(l => config.activeAppointmentLabels.includes(l));
        return hasLabel || lead.resolvedStage === "sale";
    };

    const hotLeads = filteredLeads.filter(i => i.bucket === "hot");
    const coldLeads = filteredLeads.filter(i => i.bucket === "cold");
    const hotAppointments = hotLeads.filter(i => isAppointmentLead(i.lead)).length;

    const bucketDistribution = BUCKET_ORDER.map(bucket => ({
        bucket, name: BUCKET_COPY[bucket].label,
        value: filteredLeads.filter(i => i.bucket === bucket).length,
        fill: BUCKET_COPY[bucket].color,
    }));

    const averageByChannel = Array.from(
        scoredFilteredLeads.reduce((map, item) => {
            const row = map.get(item.channel) || { name: item.channel, total: 0, count: 0 };
            row.total += item.score; row.count += 1;
            map.set(item.channel, row); return map;
        }, new Map<string, { name: string; total: number; count: number }>())
    ).map(([, row]) => ({ name: row.name, score: Math.round((row.total / row.count) * 10) / 10, leads: row.count }))
        .sort((a, b) => b.score - a.score || b.leads - a.leads);

    const averageByDimension = Array.from(
        scoredFilteredLeads.reduce((map, item) => {
            const keys = scoreDimension === "campaign"
                ? (item.campaign !== "Sin campaña" ? [item.campaign] : [])
                : extractLeadLabels(item.lead).filter(l => scoreVisibleLabels.includes(l)).length > 0
                    ? extractLeadLabels(item.lead).filter(l => scoreVisibleLabels.includes(l))
                    : ["Sin estado"];
            keys.forEach(key => {
                const row = map.get(key) || { name: key, total: 0, count: 0 };
                row.total += item.score; row.count += 1; map.set(key, row);
            }); return map;
        }, new Map<string, { name: string; total: number; count: number }>())
    ).map(([, row]) => ({ name: scoreDimension === "label" ? formatBusinessLabel(row.name) : row.name, score: Math.round((row.total / row.count) * 10) / 10, leads: row.count }))
        .sort((a, b) => b.score - a.score || b.leads - a.leads).slice(0, 8);

    const scoreDomain = useMemo((): [number, number] => {
        const values = [...scoredFilteredLeads.map(i => i.score), ...averageByChannel.map(i => i.score), ...averageByDimension.map(i => i.score)].filter((v): v is number => Number.isFinite(v));
        if (values.length === 0) return [-5, 25];
        const min = Math.min(...values), max = Math.max(...values), spread = max - min;
        const padding = Math.max(2, Math.ceil((spread || Math.max(Math.abs(max), 10)) * 0.1));
        return [Math.min(0, min - padding), max + padding];
    }, [scoredFilteredLeads, averageByChannel, averageByDimension]);

    const conversionByBucket = BUCKET_ORDER.map(bucket => {
        const bl = filteredLeads.filter(i => i.bucket === bucket);
        const converted = bl.filter(i => isAppointmentLead(i.lead)).length;
        return { bucket, name: BUCKET_COPY[bucket].label, conversion: percent(converted, bl.length), converted, total: bl.length, fill: BUCKET_COPY[bucket].color };
    });

    const kpis = {
        averageScore: scoreAverage(scoredFilteredLeads),
        hotPercentage: percent(hotLeads.length, filteredLeads.length),
        hotAppointmentConversion: percent(hotAppointments, hotLeads.length),
        coldPercentage: percent(coldLeads.length, filteredLeads.length),
    };

    const detailRows = useMemo(
        () => [...filteredLeads].sort((a, b) =>
            Number(b.lead.timestamp || b.lead.created_at || 0) - Number(a.lead.timestamp || a.lead.created_at || 0) ||
            (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY)
        ),
        [filteredLeads],
    );

    const searchedDetailRows = useMemo(() => {
        const query = normalize(detailSearch);
        if (!query) return detailRows;
        return detailRows.filter(item => {
            const labels = extractLeadLabels(item.lead);
            const phone = getLeadPhone(item.lead, item.channel);
            const haystack = [item.lead.id, getLeadName(item.lead), phone, getRawLeadPhone(item.lead), item.channel, item.campaign, item.owner, item.bucketLabel, item.score, formatScoreValue(item.score), getMessagePreview(item.lead), formatDateTime(item.lead.created_at || item.lead.timestamp), formatDateTime(item.lead.timestamp || item.lead.created_at), ...labels, ...labels.map(formatBusinessLabel)].map(normalize).join(" ");
            return haystack.includes(query);
        });
    }, [detailRows, detailSearch]);

    const scoreFieldLabel = config.selectedScoreAttribute?.label || formatFieldLabel(config.activeScoreAttributeKey) || "ningún campo";

    const activeFilterSummary = useMemo(() => {
        const filters: string[] = [];
        if (globalFilters.startDate || globalFilters.endDate) filters.push(`Fecha: ${globalFilters.startDate ? globalFilters.startDate.toLocaleDateString("es-EC") : "inicio"} a ${globalFilters.endDate ? globalFilters.endDate.toLocaleDateString("es-EC") : "hoy"}`);
        if ((globalFilters.selectedInboxes || []).length > 0) {
            const channels = (globalFilters.selectedInboxes || []).map(id => inboxMap.get(Number(id))?.name || `Canal ${id}`);
            filters.push(`Canales: ${channels.join(", ")}`);
        }
        if (campaignFilter !== "all") filters.push(`Campaña: ${campaignFilter}`);
        if (labelFilters.length > 0) filters.push(`Estados: ${labelFilters.map(formatBusinessLabel).join(", ")}`);
        if (ownerFilter !== "all") filters.push(`Responsable: ${ownerFilter}`);
        if (bucketFilter !== "all") filters.push(`Nivel: ${BUCKET_COPY[bucketFilter as ScoreBucket]?.label || bucketFilter}`);
        if (detailSearch.trim()) filters.push(`Búsqueda: ${detailSearch.trim()}`);
        return filters.length > 0 ? filters.join(" | ") : "Sin filtros internos; usando fecha y canal global si están seleccionados.";
    }, [globalFilters.startDate, globalFilters.endDate, globalFilters.selectedInboxes, inboxMap, campaignFilter, labelFilters, ownerFilter, bucketFilter, detailSearch]);

    return {
        // Filter state
        campaignFilter, setCampaignFilter, labelFilters, setLabelFilters,
        ownerFilter, setOwnerFilter, bucketFilter, setBucketFilter,
        detailSearch, setDetailSearch, scoreDimension, setScoreDimension,
        // Data
        filterOptions, filteredLeads, scoredLeadCount: scoredFilteredLeads.length, filteredMissingScoreCount,
        kpis, bucketDistribution, averageByChannel, averageByDimension, scoreDomain, conversionByBucket,
        detailRows: searchedDetailRows, scoreFieldLabel, activeFilterSummary,
        hotLeads, coldLeads, hotAppointments,
    };
};
