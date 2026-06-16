import { useCallback, useEffect, useMemo, useState } from 'react';
import { chatwootService } from '@/services/ChatwootService';
import { RefreshCw, DollarSign, CalendarDays, AlertTriangle } from 'lucide-react';
import { useLeadWorkflowUpdate } from "@/features/followup/hooks/useLeadWorkflowUpdate";
import { useFollowupAttributeDefinitions } from "@/features/followup/hooks/useFollowupAttributeDefinitions";
import { useHumanFlowConfig } from "@/features/followup/hooks/useHumanFlowConfig";
import {
    AppointmentFormValue,
    AttributeDefinition,
    formatAppointmentFieldValue,
    getAppointmentFieldInitialValue,
    serializeAppointmentFieldValue,
    validateAppointmentFieldValue,
} from "@/features/followup/model/leadActionQueueModel";
import { WorkflowField } from "@/features/followup/components/WorkflowField";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getGuayaquilDateString, getGuayaquilTimeString } from "@/lib/guayaquilTime";
import { metaCapiClient } from "@/infrastructure/supabase/MetaCapiClient";
import type { MetaCapiEventKind, MetaCapiLeadPayload } from "@/features/followup/model/metaCapiModel";
import { friendlyErrorMessage } from "@/lib/displayCopy";

type WorkflowModalStep = "closed" | "edit" | "confirm" | "saving";

const getWorkflowString = (value: unknown, fallback = "") =>
    String(value ?? fallback).trim();
import { supabaseHistoricalClient } from '@/infrastructure/supabase/SupabaseHistoricalClient';
import { useDashboardContext } from '@/context/useDashboardContext';
import type { MinifiedConversation } from '@/services/StorageService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    AlertCircle,
    Clock,
    ExternalLink,
    Loader2,
    MessageSquare,
    Search,
    UserCircle
} from 'lucide-react';
import {
    getConversationMessageRole,
    getDisplayMessages,
    formatDateTime,
    getAttrs,
    getChatwootUrl,
    getInitials,
    getLeadChannelName,
    getLeadEmail,
    getLeadExternalUrl,
    getLeadInboxName,
    getLeadName,
    getLeadPhone,
    getMessageText,
    getMessagePreview,
    getMessageTimestamp,
    getRawLeadPhone,
    normalize
} from '@/lib/leadDisplay';
import { formatBusinessLabel } from '@/lib/displayCopy';
import {
    buildWindowedListState,
    WINDOWED_TABLE_MAX_HEIGHT_PX
} from '@/lib/windowedList';
import { TablePaginationControls } from '@/shared/ui/dashboard/TablePaginationControls.tsx';
import { toast } from 'sonner';
import type { ConversationMessage, Inbox } from '@/domain/lead';

const dayStartUnix = (date?: Date) => {
    if (!date) return 0;
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return Math.floor(start.getTime() / 1000);
};

const dayEndUnix = (date?: Date) => {
    if (!date) return Number.MAX_SAFE_INTEGER;
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return Math.floor(end.getTime() / 1000);
};

const ConversationsLayer = () => {
    const {
        conversations,
        inboxes,
        globalFilters,
        loading,
        error,
        dataSource,
        liveError,
        historicalError,
        tagSettings,
        labels: allAvailableLabels,
        replaceConversation,
        refetch: refetchContext,
        updateTagSettings,
    } = useDashboardContext();

    const { applyLeadWorkflowUpdate } = useLeadWorkflowUpdate({
        replaceConversation,
        refetchContext,
        refetchDashboard: () => { },
    });

    const {
        attributeDefinitionMap,
    } = useFollowupAttributeDefinitions({ conversations });

    const {
        mergedLabels,
        configuredAppointmentFields,
        configuredSaleFields,
        humanAppointmentTargetLabel,
        humanSaleTargetLabel,
    } = useHumanFlowConfig({
        tagSettings,
        allAvailableLabels,
        attributeDefinitionMap,
        updateTagSettings,
    });

    const [search, setSearch] = useState('');
    const [viewingConv, setViewingConv] = useState<MinifiedConversation | null>(null);
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [page, setPage] = useState(1);

    const selectedInboxKey = (globalFilters.selectedInboxes || []).join(',');
    const selectedInboxes = useMemo(
        () => selectedInboxKey
            ? selectedInboxKey.split(',').map(Number).filter(Number.isFinite)
            : [],
        [selectedInboxKey]
    );

    const inboxMap = useMemo(
        () => new Map<number, Inbox>(inboxes.map((inbox) => [Number(inbox.id), inbox])),
        [inboxes]
    );

    const getInbox = useCallback(
        (lead: MinifiedConversation) => lead?.inbox_id ? inboxMap.get(Number(lead.inbox_id)) || null : null,
        [inboxMap]
    );

    const getChannelName = useCallback(
        (lead: MinifiedConversation) => getLeadChannelName(lead, getInbox(lead)),
        [getInbox]
    );

    const filteredConversations = useMemo(() => {
        const query = normalize(search);
        const startUnix = dayStartUnix(globalFilters.startDate);
        const endUnix = dayEndUnix(globalFilters.endDate);

        return conversations
            .filter((lead) => {
                const filterTimestamp = lead.created_at || lead.timestamp || 0;
                if (filterTimestamp && (filterTimestamp < startUnix || filterTimestamp > endUnix)) return false;
                if (selectedInboxes.length > 0 && !selectedInboxes.includes(Number(lead.inbox_id))) return false;
                return true;
            })
            .filter((lead) => {
                if (!query) return true;

                const channel = getChannelName(lead);
                const attrs = getAttrs(lead);
                const haystack = [
                    lead.id,
                    getLeadName(lead),
                    getLeadPhone(lead, channel),
                    getRawLeadPhone(lead),
                    getLeadEmail(lead),
                    channel,
                    getLeadInboxName(lead, getInbox(lead)),
                    ...(lead.labels || []),
                    attrs.nombre_completo,
                    attrs.celular,
                    attrs.correo,
                    attrs.canal
                ].map(normalize).join(' ');

                return haystack.includes(query);
            })
            .sort((a, b) => (b.timestamp || b.created_at || 0) - (a.timestamp || a.created_at || 0));
    }, [conversations, globalFilters.startDate, globalFilters.endDate, selectedInboxes, search, getChannelName, getInbox]);

    const windowedConversations = useMemo(
        () => buildWindowedListState(filteredConversations, page),
        [filteredConversations, page]
    );

    useEffect(() => {
        setPage(1);
    }, [search, globalFilters.startDate, globalFilters.endDate, selectedInboxKey]);

    useEffect(() => {
        if (page !== windowedConversations.page) setPage(windowedConversations.page);
    }, [page, windowedConversations.page]);

    // --- WORKFLOW STATE & FUNCTIONS ---
    const [selectedLead, setSelectedLead] = useState<MinifiedConversation | null>(null);
    const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
    const [isTagConfirmOpen, setIsTagConfirmOpen] = useState(false);
    const [newTag, setNewTag] = useState<string>("");

    const [operationLead, setOperationLead] = useState<MinifiedConversation | null>(null);
    const [operationValues, setOperationValues] = useState<Record<string, AppointmentFormValue>>({});
    const [operationModalStep, setOperationModalStep] = useState<WorkflowModalStep>("closed");
    const [isSavingOperation, setIsSavingOperation] = useState(false);

    const [appointmentLead, setAppointmentLead] = useState<MinifiedConversation | null>(null);
    const [appointmentValues, setAppointmentValues] = useState<Record<string, AppointmentFormValue>>({});
    const [appointmentModalStep, setAppointmentModalStep] = useState<WorkflowModalStep>("closed");
    const [isSavingAppointment, setIsSavingAppointment] = useState(false);

    const buildMetaCapiLeadPayload = useCallback((lead: MinifiedConversation, meetingId?: unknown): MetaCapiLeadPayload => {
        const channel = getChannelName(lead);
        return {
            id: lead.id,
            fullName: getLeadName(lead),
            email: getLeadEmail(lead),
            phone: getRawLeadPhone(lead) || getLeadPhone(lead, channel),
            conversationId: String(lead.id),
            meetingId: getWorkflowString(meetingId, String(lead.id)),
        };
    }, [getChannelName]);

    const sendMetaCapiWorkflowEvent = useCallback(async (params: {
        eventKind: Exclude<MetaCapiEventKind, "test">;
        lead: MinifiedConversation;
        appointmentDate: string;
        appointmentTime: string;
        meetingId?: unknown;
    }) => {
        try {
            const result = await metaCapiClient.sendEvent({
                eventKind: params.eventKind,
                lead: buildMetaCapiLeadPayload(params.lead, params.meetingId),
                channel: getChannelName(params.lead),
                appointmentDate: params.appointmentDate,
                appointmentTime: params.appointmentTime,
            });

            if (result.skipped) {
                if (result.reason && !result.reason.toLowerCase().includes("no esta configurado")) {
                    toast.info(`Meta CAPI omitido: ${result.reason}`);
                }
                return;
            }

            toast.success(result.testMode ? "Meta CAPI enviado en modo test" : "Meta CAPI enviado correctamente");
        } catch (capiError) {
            console.error("Meta CAPI event failed after workflow update:", capiError);
            toast.error("El cambio se guardó, pero Meta CAPI no pudo recibir el evento.");
        }
    }, [buildMetaCapiLeadPayload, getChannelName]);

    const closeAppointmentWorkflow = (force = false) => {
        if (isSavingAppointment && !force) return;
        setAppointmentModalStep("closed");
        setAppointmentLead(null);
        setAppointmentValues({});
    };

    const closeOperationWorkflow = (force = false) => {
        if (isSavingOperation && !force) return;
        setOperationModalStep("closed");
        setOperationLead(null);
        setOperationValues({});
    };

    const openAppointmentDialog = (lead: MinifiedConversation) => {
        if (configuredAppointmentFields.length === 0) {
            toast.error("Configura primero los campos de cita agendada en la seccion de flujo humano");
            return;
        }

        const attrs = getAttrs(lead);
        const nextValues = configuredAppointmentFields.reduce<Record<string, AppointmentFormValue>>((acc, field) => {
            const rawValue = attrs[field.key];
            acc[field.key] = getAppointmentFieldInitialValue(field, rawValue);
            return acc;
        }, {});

        setAppointmentLead(lead);
        setAppointmentValues(nextValues);
        setAppointmentModalStep("edit");
    };

    const openOperationDialog = (lead: MinifiedConversation) => {
        if (configuredSaleFields.length === 0) {
            toast.error("Configura primero los campos de venta exitosa en la seccion de flujo humano");
            return;
        }

        const attrs = getAttrs(lead);
        const nextValues = configuredSaleFields.reduce<Record<string, AppointmentFormValue>>((acc, field) => {
            const rawValue =
                field.key === "fecha_monto_operacion"
                    ? lead.timestamp || lead.created_at ? formatDateTime(lead.timestamp || lead.created_at).split(' ')[0] : getGuayaquilDateString()
                    : attrs[field.key];
            acc[field.key] = getAppointmentFieldInitialValue(field, rawValue);
            return acc;
        }, {});

        setOperationLead(lead);
        setOperationValues(nextValues);
        setOperationModalStep("edit");
    };

    const handleOpenTagChange = (lead: MinifiedConversation) => {
        setSelectedLead(lead);
        setNewTag("");
        setIsTagDialogOpen(true);
    };

    const handleConfirmTagChange = () => {
        if (!newTag || !selectedLead) return;
        const normalizedTag = newTag.toLowerCase().replace(/_/g, " ");
        const isAppointment = newTag === humanAppointmentTargetLabel || normalizedTag.includes("agenda cita") || normalizedTag.includes("cita agendada");
        const isSale = newTag === humanSaleTargetLabel || normalizedTag.includes("venta exitosa");

        if (isAppointment) {
            setIsTagDialogOpen(false);
            openAppointmentDialog(selectedLead);
        } else if (isSale) {
            setIsTagDialogOpen(false);
            openOperationDialog(selectedLead);
        } else {
            setIsTagConfirmOpen(true);
        }
    };

    const executeTagChange = async () => {
        if (!selectedLead || !newTag) return;

        try {
            await applyLeadWorkflowUpdate({
                lead: selectedLead as any,
                nextLabels: [newTag],
                rawPayload: {
                    action: "change_followup_status",
                    selected_label: newTag
                },
                successMessage: `Estado cambiado a: ${newTag}`
            });

            setIsTagDialogOpen(false);
            setIsTagConfirmOpen(false);
            setNewTag("");
            setSelectedLead(null);
        } catch (tagError) {
            console.error("Error changing tag:", tagError);
            toast.error(friendlyErrorMessage("changeStatus"));
        }
    };

    const handleAppointmentFormConfirm = () => {
        if (!appointmentLead) return;

        const invalidField = configuredAppointmentFields
            .map((field) => ({
                field,
                error: validateAppointmentFieldValue(field, appointmentValues[field.key])
            }))
            .find((result) => result.error);

        if (invalidField?.error) {
            toast.error(invalidField.error);
            return;
        }
        setAppointmentModalStep("confirm");
    };

    const executeAppointmentConfirm = async () => {
        if (!appointmentLead) return;
        setIsSavingAppointment(true);
        setAppointmentModalStep("saving");
        try {
            const appointmentPayload = Object.fromEntries(
                configuredAppointmentFields.map((field) => [
                    field.key,
                    serializeAppointmentFieldValue(field, appointmentValues[field.key])
                ])
            );

            await applyLeadWorkflowUpdate({
                lead: appointmentLead as any,
                nextLabels: [humanAppointmentTargetLabel],
                contactAttributePatch: appointmentPayload,
                conversationAttributePatch: appointmentPayload,
                rawPayload: {
                    action: "schedule_human_appointment",
                    fields: appointmentPayload,
                    target_label: humanAppointmentTargetLabel
                },
                successMessage: "Cita guardada correctamente"
            });

            const appointmentDate = getWorkflowString(appointmentPayload.fecha_visita, getGuayaquilDateString());
            const appointmentTime = getWorkflowString(appointmentPayload.hora_visita, getGuayaquilTimeString());
            const appointmentMeetingId = appointmentPayload.meeting_id || appointmentPayload.id || appointmentLead.id;

            closeAppointmentWorkflow(true);
            void sendMetaCapiWorkflowEvent({
                eventKind: "appointment",
                lead: appointmentLead,
                appointmentDate,
                appointmentTime,
                meetingId: appointmentMeetingId,
            });
        } catch (appointmentError) {
            console.error("Error confirming human appointment:", appointmentError);
            toast.error(friendlyErrorMessage("saveAppointment"));
            setAppointmentModalStep("confirm");
        } finally {
            setIsSavingAppointment(false);
        }
    };

    const handleOperationFormConfirm = () => {
        if (!operationLead) return;

        const invalidField = configuredSaleFields
            .map((field) => ({
                field,
                error: validateAppointmentFieldValue(field, operationValues[field.key])
            }))
            .find((result) => result.error);

        if (invalidField?.error) {
            toast.error(invalidField.error);
            return;
        }
        setOperationModalStep("confirm");
    };

    const executeOperationConfirm = async () => {
        if (!operationLead) return;
        setIsSavingOperation(true);
        setOperationModalStep("saving");
        try {
            const salePayload = Object.fromEntries(
                configuredSaleFields.map((field) => [
                    field.key,
                    serializeAppointmentFieldValue(field, operationValues[field.key])
                ])
            );

            await applyLeadWorkflowUpdate({
                lead: operationLead as any,
                nextLabels: [humanSaleTargetLabel],
                contactAttributePatch: salePayload,
                conversationAttributePatch: salePayload,
                rawPayload: {
                    action: "confirm_operation",
                    fields: salePayload,
                    target_label: humanSaleTargetLabel
                },
                successMessage: "Venta guardada correctamente"
            });

            const operationDate = getWorkflowString(salePayload.fecha_monto_operacion, getGuayaquilDateString());
            const operationTime = getGuayaquilTimeString();
            const operationMeetingId = salePayload.meeting_id || salePayload.id || operationLead.id;

            closeOperationWorkflow(true);
            void sendMetaCapiWorkflowEvent({
                eventKind: "sale",
                lead: operationLead,
                appointmentDate: operationDate,
                appointmentTime: operationTime,
                meetingId: operationMeetingId,
            });
        } catch (operationError) {
            console.error("Error confirming operation:", operationError);
            toast.error(friendlyErrorMessage("saveSale"));
            setOperationModalStep("confirm");
        } finally {
            setIsSavingOperation(false);
        }
    };
    // --- END WORKFLOW STATE & FUNCTIONS ---

    const openInChatwoot = (lead: MinifiedConversation) => {
        const url = getChatwootUrl(lead);
        if (!url) {
            toast.info('Este lead no tiene una conversación válida en el Chatwoot actual');
            return;
        }
        window.open(url, '_blank');
    };

    const handleOpenHistory = async (lead: MinifiedConversation) => {
        setViewingConv(lead);
        setMessages([]);
        setLoadingHistory(true);

        try {
            let history: ConversationMessage[] = [];
            const chatwootUrl = getChatwootUrl(lead);
            const isLivePreferred = Boolean(chatwootUrl) && lead.source !== 'supabase';
            const fetchApiMessages = async (): Promise<ConversationMessage[]> => {
                if (!chatwootUrl) return [];
                try {
                    return await chatwootService.getMessages(lead.id);
                } catch (apiError) {
                    console.warn('[ChatwootPage] Chatwoot history failed:', apiError);
                    return [];
                }
            };
            const fetchSupabaseMessages = async (): Promise<ConversationMessage[]> => {
                try {
                    return await supabaseHistoricalClient.getHistoricalMessages(lead.id);
                } catch (dbError) {
                    console.warn('[ChatwootPage] Supabase history failed:', dbError);
                    return [];
                }
            };

            if (isLivePreferred) {
                history = await fetchApiMessages();
                if (!history || history.length === 0) {
                    history = await fetchSupabaseMessages();
                }
            } else {
                history = await fetchSupabaseMessages();
                if (!history || history.length === 0) {
                    history = await fetchApiMessages();
                }
            }

            if ((!history || history.length === 0) && lead.last_non_activity_message) {
                history = [lead.last_non_activity_message];
            }

            setMessages(getDisplayMessages(history || []));
        } catch (historyError) {
            console.error('[ChatwootPage] History Error:', historyError);
            toast.error('Error al cargar el historial');
        } finally {
            setLoadingHistory(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="border-border bg-card">
                <CardHeader className="pb-4 border-b">
                    <div className="flex flex-col lg:flex-row gap-4 justify-between lg:items-center">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <MessageSquare className="h-5 w-5 text-primary" />
                                Listado de Conversaciones
                            </CardTitle>
                            <CardDescription>
                                Total encontrado: <span className="font-bold text-foreground">{windowedConversations.total}</span>
                                {windowedConversations.total > 0 && (
                                    <span> · página {windowedConversations.page} de {windowedConversations.pageCount}</span>
                                )}
                            </CardDescription>
                            {(liveError || historicalError || error) && (
                                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    La lista está usando la mejor información disponible. Algunos datos recientes podrían tardar en actualizarse.
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <Badge variant="outline" className="h-9 justify-center px-3">
                                {dataSource === 'HYBRID' ? 'Datos en vivo + historial' : dataSource === 'API_ONLY' ? 'Datos en vivo' : 'Historial disponible'}
                            </Badge>
                            <div className="relative min-w-[260px]">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por ID, nombre, número, estado o canal..."
                                    className="pl-9 h-9 text-sm"
                                    value={search}
                                    onChange={(event) => {
                                        setPage(1);
                                        setSearch(event.target.value);
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-4">
                            <Loader2 className="animate-spin h-10 w-10 text-primary/40" />
                            <p className="text-sm text-muted-foreground animate-pulse">Cargando conversaciones...</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-xl border border-border overflow-hidden bg-background shadow-sm">
                                <div
                                    className={windowedConversations.hasVerticalScroll ? 'overflow-auto overscroll-contain' : 'overflow-x-auto'}
                                    style={windowedConversations.hasVerticalScroll ? { maxHeight: `${WINDOWED_TABLE_MAX_HEIGHT_PX}px` } : undefined}
                                >
                                    <table className="w-full min-w-[1480px] text-sm text-left border-collapse">
                                        <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                                            <tr className="text-muted-foreground uppercase text-[10px] tracking-wider font-bold border-b">
                                                <th className="px-6 py-4">Nombre del lead</th>
                                                <th className="px-6 py-4">Canal</th>
                                                <th className="px-6 py-4">Numero</th>
                                                <th className="px-6 py-4">Producto</th>
                                                <th className="px-6 py-4">Estado</th>
                                                <th className="px-6 py-4">Historial de mensajes</th>
                                                <th className="px-6 py-4">URL</th>
                                                <th className="px-6 py-4">Fecha de ingreso</th>
                                                <th className="px-6 py-4">Última interacción</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {windowedConversations.visibleItems.length === 0 ? (
                                                <tr>
                                                    <td colSpan={9} className="px-6 py-24 text-center">
                                                        <div className="flex flex-col items-center gap-2 opacity-40">
                                                            <Search className="h-10 w-10" />
                                                            <p className="text-sm font-medium">No se encontraron resultados</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                windowedConversations.visibleItems.map((lead) => {
                                                    const inbox = getInbox(lead);
                                                    const displayName = getLeadName(lead);
                                                    const channelDisplay = getLeadChannelName(lead, inbox);
                                                    const phoneDisplay = getLeadPhone(lead, channelDisplay);
                                                    const lastMessage = getMessagePreview(lead);
                                                    const lastMessageDate = formatDateTime(getMessageTimestamp(lead));
                                                    const externalUrl = getLeadExternalUrl(lead, channelDisplay);
                                                    const createdDate = formatDateTime(lead.created_at || lead.timestamp);
                                                    const lastInteractionDate = formatDateTime(lead.timestamp || lead.created_at);

                                                    return (
                                                        <tr key={lead.id} className="hover:bg-muted/20 transition-colors">
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase shadow-sm shrink-0">
                                                                        {getInitials(displayName)}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="font-semibold text-foreground truncate">
                                                                            {displayName}
                                                                        </div>
                                                                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                                                                            ID {lead.id}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <Badge variant="secondary" className="px-2 py-0 text-[10px] uppercase font-bold">
                                                                    {channelDisplay}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium italic">
                                                                    <UserCircle className="w-3 h-3" />
                                                                    {phoneDisplay || 'Sin numero'}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-xs font-medium text-foreground">
                                                                {String(getAttrs(lead).producto || "-")}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col gap-2 max-w-[260px]">
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {(lead.labels || []).length > 0 ? (
                                                                            (lead.labels || []).map((label) => (
                                                                                <Badge key={label} variant="outline" className="text-[10px] font-bold px-2 py-0.5 whitespace-nowrap">
                                                                                    {formatBusinessLabel(label)}
                                                                                </Badge>
                                                                            ))
                                                                        ) : (
                                                                            <span className="text-xs text-muted-foreground">Sin estado</span>
                                                                        )}
                                                                    </div>
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="h-7 text-xs flex items-center gap-1 mt-1 w-fit border-primary/20 hover:bg-primary/5"
                                                                        onClick={() => handleOpenTagChange(lead)}
                                                                    >
                                                                        <RefreshCw className="h-3 w-3" />
                                                                        Cambiar estado
                                                                    </Button>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenHistory(lead)}
                                                                    className="flex max-w-[360px] flex-col text-left hover:text-primary"
                                                                >
                                                                    <span className="text-xs truncate text-foreground font-medium">
                                                                        {lastMessage}
                                                                    </span>
                                                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
                                                                        <Clock className="w-3 h-3" />
                                                                        {lastMessageDate}
                                                                    </span>
                                                                    <span className="text-[10px] text-primary mt-1">Ver historial</span>
                                                                </button>
                                                            </td>
                                                            <td className="px-6 py-4">
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
                                                            <td className="px-6 py-4 text-xs text-muted-foreground">{createdDate}</td>
                                                            <td className="px-6 py-4 text-xs text-muted-foreground">{lastInteractionDate}</td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <TablePaginationControls pageState={windowedConversations} onPageChange={setPage} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!viewingConv} onOpenChange={(open) => !open && setViewingConv(null)}>
                <DialogContent className="max-w-2xl sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-primary" />
                            Historial de: {viewingConv ? getLeadName(viewingConv) : ''}
                        </DialogTitle>
                        <DialogDescription>
                            Mensajes disponibles del lead. Puedes abrir la conversación original para revisar más contexto.
                        </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="h-[500px] mt-4 pr-4">
                        {loadingHistory ? (
                            <div className="flex flex-col items-center justify-center h-full">
                                <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                                <p className="text-sm text-muted-foreground">Cargando mensajes...</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {messages.length === 0 && (
                                    <div className="py-16 text-center text-sm text-muted-foreground">
                                        No hay mensajes disponibles para este lead.
                                    </div>
                                )}
                                {messages.map((msg, index) => {
                                    const role = getConversationMessageRole(msg);
                                    const isOutgoing = role === 'outgoing';
                                    return (
                                        <div key={msg.id || index} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${isOutgoing
                                                ? 'bg-primary text-primary-foreground rounded-tr-none'
                                                : 'bg-muted text-foreground rounded-tl-none'
                                                }`}>
                                                <div className="font-bold text-[10px] mb-1 opacity-70 uppercase">
                                                    {isOutgoing ? 'Agente / Bot' : 'Cliente'}
                                                </div>
                                                <p className="whitespace-pre-wrap">{getMessageText(msg)}</p>
                                                <div className="text-[9px] mt-1 text-right opacity-60">
                                                    {formatDateTime(msg.created_at || msg.created_at_chatwoot)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </ScrollArea>

                    <DialogFooter className="mt-4 border-t pt-4">
                        <Button variant="outline" onClick={() => setViewingConv(null)}>Cerrar</Button>
                        <Button
                            className="gap-2"
                            onClick={() => viewingConv && openInChatwoot(viewingConv)}
                            disabled={Boolean(viewingConv) && !getChatwootUrl(viewingConv)}
                        >
                            <ExternalLink className="h-4 w-4" />
                            {viewingConv && !getChatwootUrl(viewingConv) ? 'Sin conversación en Chatwoot' : 'Abrir conversación'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={appointmentModalStep !== "closed"}
                onOpenChange={(open) => {
                    if (!open) closeAppointmentWorkflow();
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CalendarDays className="h-5 w-5 text-violet-600" />
                            Marcar cita agendada
                        </DialogTitle>
                        <DialogDescription>
                            Completa los campos configurados para guardar los datos del cliente y cambiar el estado a {formatBusinessLabel(humanAppointmentTargetLabel)}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                            <div className="font-semibold">{appointmentLead ? getLeadName(appointmentLead) : ""}</div>
                            <div className="text-xs text-muted-foreground">
                                ID {appointmentLead?.id} - {appointmentLead ? getLeadPhone(appointmentLead, getChannelName(appointmentLead)) : ""} - {appointmentLead ? getChannelName(appointmentLead) : ""}
                            </div>
                        </div>

                        {appointmentModalStep === "edit" && (
                            <div className="max-h-[60vh] overflow-y-auto pr-4">
                                <div className="space-y-4">
                                    {configuredAppointmentFields.map((field) => (
                                        <WorkflowField
                                            key={field.key}
                                            field={field}
                                            value={appointmentValues[field.key]}
                                            onValueChange={(key, val) => setAppointmentValues(prev => ({ ...prev, [key]: val }))}
                                            fieldIdPrefix="appointment"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {appointmentModalStep !== "edit" && (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    Vas a guardar la cita agendada de <strong>{appointmentLead ? getLeadName(appointmentLead) : ""}</strong> y cambiar el estado a{" "}
                                    <strong>{formatBusinessLabel(humanAppointmentTargetLabel)}</strong>.
                                </p>
                                <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
                                    <p className="font-semibold mb-2">Datos que se guardarán</p>
                                    <div className="space-y-1">
                                        {configuredAppointmentFields.map((field) => (
                                            <div key={`confirm-appointment-${field.key}`}>
                                                <span className="font-medium">{field.label}:</span>{" "}
                                                <span>{formatAppointmentFieldValue(field, appointmentValues[field.key])}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    El lead quedará con el estado <strong>{formatBusinessLabel(humanAppointmentTargetLabel)}</strong>.
                                </p>
                                {appointmentModalStep === "saving" && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Guardando cambios...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {appointmentModalStep === "edit" ? (
                            <>
                                <Button variant="outline" onClick={() => closeAppointmentWorkflow()}>Cancelar</Button>
                                <Button className="bg-violet-600 hover:bg-violet-700" onClick={handleAppointmentFormConfirm}>
                                    Guardar cita
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => setAppointmentModalStep("edit")}
                                    disabled={isSavingAppointment}
                                >
                                    Volver
                                </Button>
                                <Button
                                    className="bg-violet-600 hover:bg-violet-700"
                                    onClick={() => executeAppointmentConfirm()}
                                    disabled={isSavingAppointment}
                                >
                                    {isSavingAppointment ? "Guardando..." : "Confirmar cita"}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={operationModalStep !== "closed"}
                onOpenChange={(open) => {
                    if (!open) closeOperationWorkflow();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-emerald-600" />
                            Confirmar operación
                        </DialogTitle>
                        <DialogDescription>
                            Completa los campos configurados para marcar este lead como {formatBusinessLabel(humanSaleTargetLabel).toLowerCase()}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                            <div className="font-semibold">{operationLead ? getLeadName(operationLead) : ""}</div>
                            <div className="text-xs text-muted-foreground">
                                ID {operationLead?.id} - {operationLead ? getLeadPhone(operationLead, getChannelName(operationLead)) : ""} - {operationLead ? getChannelName(operationLead) : ""}
                            </div>
                        </div>

                        {operationModalStep === "edit" && (
                            <div className="max-h-[60vh] overflow-y-auto pr-4">
                                <div className="space-y-4">
                                    {configuredSaleFields.map((field) => (
                                        <WorkflowField
                                            key={field.key}
                                            field={field}
                                            value={operationValues[field.key]}
                                            onValueChange={(key, val) => setOperationValues(prev => ({ ...prev, [key]: val }))}
                                            fieldIdPrefix="sale"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {operationModalStep !== "edit" && (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    Vas a confirmar la venta de <strong>{operationLead ? getLeadName(operationLead) : ""}</strong> y cambiar el estado a{" "}
                                    <strong>{formatBusinessLabel(humanSaleTargetLabel)}</strong>.
                                </p>
                                <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900">
                                    <p className="font-semibold mb-2">Datos que se guardarán</p>
                                    <div className="space-y-1">
                                        {configuredSaleFields.map((field) => (
                                            <div key={`confirm-sale-${field.key}`}>
                                                <span className="font-medium">{field.label}:</span>{" "}
                                                <span>{formatAppointmentFieldValue(field, operationValues[field.key])}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {operationModalStep === "saving" && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Guardando cambios...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {operationModalStep === "edit" ? (
                            <>
                                <Button variant="outline" onClick={() => closeOperationWorkflow()}>Cancelar</Button>
                                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleOperationFormConfirm}>
                                    Confirmar
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => setOperationModalStep("edit")}
                                    disabled={isSavingOperation}
                                >
                                    Volver
                                </Button>
                                <Button
                                    className="bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => executeOperationConfirm()}
                                    disabled={isSavingOperation}
                                >
                                    {isSavingOperation ? "Guardando..." : "Confirmar venta"}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isTagDialogOpen} onOpenChange={setIsTagDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cambiar estado</DialogTitle>
                        <DialogDescription>
                            Selecciona un estado. Los estados actuales se reemplazarán por el estado elegido.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nuevo estado</label>
                            <Select onValueChange={setNewTag} value={newTag}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar estado..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {mergedLabels.map((label) => (
                                        <SelectItem key={`manual-label-${label}`} value={label}>
                                            {formatBusinessLabel(label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTagDialogOpen(false)}>Cancelar</Button>
                        <Button
                            disabled={!newTag}
                            onClick={handleConfirmTagChange}
                            className="bg-amber-600 hover:bg-amber-700"
                        >
                            Cambiar estado
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isTagConfirmOpen} onOpenChange={setIsTagConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            Confirmar cambio de estado
                        </AlertDialogTitle>
                        <AlertDialogDescription className="space-y-4 pt-2">
                            <p>
                                Vas a reemplazar todos los estados actuales de <strong>{selectedLead ? getLeadName(selectedLead) : ""}</strong> por{" "}
                                <Badge variant="secondary">{formatBusinessLabel(newTag)}</Badge>. ¿Estás seguro?
                            </p>
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
                                <p className="font-bold mb-1">Recuerda</p>
                                <p>Si cambias a un estado de cita o agendamiento, revisa antes que la información necesaria del cliente quede actualizada.</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={executeTagChange} className="bg-amber-600 hover:bg-amber-700">
                            Sí, confirmar cambio
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ConversationsLayer;