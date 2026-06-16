import { useMemo, useState, useCallback } from "react";
import { useDashboardData } from "@/features/dashboard/hooks/useDashboardData";
import {
    Loader2,
    RefreshCw,
    AlertTriangle,
    DollarSign,
    CalendarDays,
    Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardContext } from "@/context/useDashboardContext";
import type { ResolvedConversation } from "@/context/dashboardDataTypes";
import type { DashboardQueueLead } from "@/application/dashboard";
import { useAuth } from "@/context/useAuth";
import { isAdmin } from "@/domain/auth/permissions";
import { DateRangePicker } from "@/shared/ui/dashboard/DateRangePicker";
import { ChannelSelector } from "@/shared/ui/dashboard/ChannelSelector";
import { TabExportMenu } from "@/features/dashboard/components/TabExportMenu";
import { getGuayaquilDateString, getGuayaquilTimeString } from "@/lib/guayaquilTime";
import type { MinifiedConversation } from "@/services/StorageService";
import type { Inbox } from "@/domain/lead";
import { metaCapiClient } from "@/infrastructure/supabase/MetaCapiClient";
import { DateRange } from "react-day-picker";
import {
    getAttrs,
    getLeadChannelName,
    getLeadEmail,
    getLeadName,
    getLeadOperationDate,
    getLeadPhone,
    getRawLeadPhone,
} from "@/lib/leadDisplay";
import {
    formatBusinessLabel,
    friendlyErrorMessage
} from "@/lib/displayCopy";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
    AppointmentFormValue,
    AttributeDefinition,
    calculateSalesTotal,
    filterQueueBySearch,
    filterSalesRows,
    formatAppointmentFieldValue,
    getAppointmentFieldInitialValue,
    serializeAppointmentFieldValue,
    validateAppointmentFieldValue,
} from "@/features/followup/model/leadActionQueueModel";
import { useLeadWorkflowUpdate } from "@/features/followup/hooks/useLeadWorkflowUpdate";
import { useFollowupAttributeDefinitions } from "@/features/followup/hooks/useFollowupAttributeDefinitions";
import { useLeadMessageHistory } from "@/features/followup/hooks/useLeadMessageHistory";
import { useHumanFlowConfig } from "@/features/followup/hooks/useHumanFlowConfig";
import { useSalesReportExport } from "@/features/followup/hooks/useSalesReportExport";
import { WorkflowField } from "./WorkflowField";
import { FollowupQueueTable } from "./FollowupQueueTable";
import { SalesReportPanel } from "./SalesReportPanel";
import { HumanFlowConfigPanel } from "./HumanFlowConfigPanel";
import { LeadMessageHistoryDialog } from "./LeadMessageHistoryDialog";
import type { MetaCapiEventKind, MetaCapiLeadPayload } from "../model/metaCapiModel";

type QueueLead = Omit<DashboardQueueLead, "id" | "labels" | "meta" | "source"> &
    Partial<ResolvedConversation> & {
        id: number;
        labels?: string[];
        meta?: MinifiedConversation["meta"];
        source?: MinifiedConversation["source"];
        owner?: string;
        account_id?: unknown;
        additional_attributes?: unknown;
        channel?: unknown;
        channel_name?: unknown;
        channel_type?: unknown;
        last_message?: unknown;
        name?: unknown;
        raw_payload?: unknown;
    };

type WorkflowModalStep = "closed" | "edit" | "confirm" | "saving";

const getWorkflowString = (value: unknown, fallback = "") =>
    String(value ?? fallback).trim();

const LeadActionQueue = () => {
    const {
        globalFilters,
        tagSettings,
        labels: allAvailableLabels,
        conversations,
        inboxes,
        setGlobalFilters,
        updateTagSettings,
        replaceConversation,
        refetch: refetchContext
    } = useDashboardContext();
    const { loading, error, data, refetch } = useDashboardData({
        ...globalFilters,
        ...tagSettings
    });
    const { role } = useAuth();
    const { applyLeadWorkflowUpdate } = useLeadWorkflowUpdate({
        replaceConversation,
        refetchContext,
        refetchDashboard: refetch,
    });
    const {
        attributeDefinitions,
        attributeDefinitionMap,
        loadingAttributeDefinitions,
    } = useFollowupAttributeDefinitions({ conversations });
    const {
        humanConfig,
        updateHumanConfigList,
        updateHumanConfigLabel,
        saveHumanConfig,
        hasHumanConfigChanges,
        mergedLabels,
        configuredAppointmentFields,
        configuredSaleFields,
        humanFollowupQueueTags,
        humanAppointmentTargetLabel,
        humanSalesQueueTags,
        humanSaleTargetLabel,
    } = useHumanFlowConfig({
        tagSettings,
        allAvailableLabels,
        attributeDefinitionMap,
        updateTagSettings,
    });

    const [isHumanConfigOpen, setIsHumanConfigOpen] = useState(false);

    const [selectedLead, setSelectedLead] = useState<QueueLead | null>(null);
    const {
        historyLead,
        isHistoryOpen,
        setIsHistoryOpen,
        historyMessages,
        loadingHistory,
        openHistory
    } = useLeadMessageHistory<QueueLead>();

    const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
    const [isTagConfirmOpen, setIsTagConfirmOpen] = useState(false);
    const [newTag, setNewTag] = useState<string>("");

    const [followUpSearch, setFollowUpSearch] = useState("");
    const [scheduledSearch, setScheduledSearch] = useState("");

    const [operationLead, setOperationLead] = useState<QueueLead | null>(null);
    const [operationValues, setOperationValues] = useState<Record<string, AppointmentFormValue>>({});
    const [operationModalStep, setOperationModalStep] = useState<WorkflowModalStep>("closed");
    const [isSavingOperation, setIsSavingOperation] = useState(false);

    const [appointmentLead, setAppointmentLead] = useState<QueueLead | null>(null);
    const [appointmentValues, setAppointmentValues] = useState<Record<string, AppointmentFormValue>>({});
    const [appointmentModalStep, setAppointmentModalStep] = useState<WorkflowModalStep>("closed");
    const [isSavingAppointment, setIsSavingAppointment] = useState(false);

    const [salesStartDate, setSalesStartDate] = useState("");
    const [salesEndDate, setSalesEndDate] = useState("");
    const [salesSearch, setSalesSearch] = useState("");

    const inboxMap = useMemo(() => new Map<number, Inbox>(inboxes.map((inbox) => [Number(inbox.id), inbox])), [inboxes]);

    const getChannelName = useCallback((lead: QueueLead | Partial<MinifiedConversation>) => {
        const inbox = lead?.inbox_id ? inboxMap.get(Number(lead.inbox_id)) : null;
        return getLeadChannelName(lead, inbox);
    }, [inboxMap]);

    const buildMetaCapiLeadPayload = useCallback((lead: QueueLead, meetingId?: unknown): MetaCapiLeadPayload => {
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
        lead: QueueLead;
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

    const getQueueSearchValues = useCallback((lead: QueueLead) => {
        const attrs = getAttrs(lead);
        const channel = getChannelName(lead);

        return [
            lead.id,
            getLeadName(lead),
            getLeadPhone(lead, channel),
            getRawLeadPhone(lead),
            getLeadEmail(lead),
            attrs.celular,
            attrs.nombre_completo
        ];
    }, [getChannelName]);

    const followUpQueue = useMemo(() => {
        const queue = (data.operationalMetrics?.followUpQueue || []) as QueueLead[];
        return filterQueueBySearch(queue, followUpSearch, getQueueSearchValues);
    }, [data, followUpSearch, getQueueSearchValues]);

    const scheduledAppointmentsQueue = useMemo(() => {
        const queue = (data.operationalMetrics?.scheduledAppointmentsQueue || []) as QueueLead[];
        return filterQueueBySearch(queue, scheduledSearch, getQueueSearchValues);
    }, [data, scheduledSearch, getQueueSearchValues]);

    const handleQueueDateRangeChange = (range: DateRange | undefined) => {
        setGlobalFilters((prev) => ({ ...prev, startDate: range?.from, endDate: range?.to }));
    };

    const handleQueueInboxesChange = (selectedInboxes: number[]) => {
        setGlobalFilters((prev) => ({ ...prev, selectedInboxes }));
    };

    const salesRows = useMemo(() => {
        return filterSalesRows({
            leads: conversations,
            saleTargetLabel: humanSaleTargetLabel,
            selectedInboxes: globalFilters.selectedInboxes || [],
            startDate: salesStartDate,
            endDate: salesEndDate,
            search: salesSearch,
            getLabels: (lead) => lead.labels || [],
            getInboxId: (lead) => lead.inbox_id,
            getOperationDate: getLeadOperationDate,
            getSearchValues: (lead) => [
                lead.id,
                getLeadName(lead),
                getLeadPhone(lead, getChannelName(lead)),
                getLeadEmail(lead),
                getChannelName(lead)
            ],
        });
    }, [conversations, globalFilters.selectedInboxes, humanSaleTargetLabel, salesEndDate, salesSearch, salesStartDate, getChannelName]);

    const salesTotal = useMemo(
        () => calculateSalesTotal(salesRows, (lead) => getAttrs(lead).monto_operacion),
        [salesRows]
    );
    const exportSalesReport = useSalesReportExport({
        salesRows,
        tagSettings,
        salesStartDate,
        salesEndDate,
        salesSearch,
        saleTargetLabel: humanSaleTargetLabel,
        salesTotal,
        getChannelName,
    });

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

    const openAppointmentDialog = (lead: QueueLead) => {
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

    const handleAppointmentValueChange = (key: string, value: AppointmentFormValue) => {
        setAppointmentValues((prev) => ({
            ...prev,
            [key]: value
        }));
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
                lead: appointmentLead,
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

    const openOperationDialog = (lead: QueueLead) => {
        if (configuredSaleFields.length === 0) {
            toast.error("Configura primero los campos de venta exitosa en la seccion de flujo humano");
            return;
        }

        const attrs = getAttrs(lead);
        const nextValues = configuredSaleFields.reduce<Record<string, AppointmentFormValue>>((acc, field) => {
            const rawValue =
                field.key === "fecha_monto_operacion"
                    ? getLeadOperationDate(lead) || attrs[field.key] || getGuayaquilDateString()
                    : attrs[field.key];
            acc[field.key] = getAppointmentFieldInitialValue(field, rawValue);
            return acc;
        }, {});

        setOperationLead(lead);
        setOperationValues(nextValues);
        setOperationModalStep("edit");
    };

    const handleOperationValueChange = (key: string, value: AppointmentFormValue) => {
        setOperationValues((prev) => ({
            ...prev,
            [key]: value
        }));
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
                lead: operationLead,
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

    const handleOpenTagChange = (lead: QueueLead) => {
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
                lead: selectedLead,
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

    const renderAppointmentField = (field: AttributeDefinition) =>
        <WorkflowField
            key={field.key}
            field={field}
            value={appointmentValues[field.key]}
            onValueChange={handleAppointmentValueChange}
            fieldIdPrefix="appointment"
        />;

    const renderSaleField = (field: AttributeDefinition) =>
        <WorkflowField
            key={field.key}
            field={field}
            value={operationValues[field.key]}
            onValueChange={handleOperationValueChange}
            fieldIdPrefix="sale"
        />;

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

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-card p-4 rounded-xl border shadow-sm">
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                    <ChannelSelector
                        selectedInboxes={globalFilters.selectedInboxes || []}
                        onChange={handleQueueInboxesChange}
                    />
                    <DateRangePicker
                        value={{ from: globalFilters.startDate, to: globalFilters.endDate }}
                        onChange={handleQueueDateRangeChange}
                    />
                </div>

                <div className="flex items-center gap-2 w-full lg:w-auto lg:ml-auto justify-end">
                    <TabExportMenu tabId="followup" compact />
                    <Button variant="outline" size="icon" onClick={refetch} title="Actualizar datos">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {isAdmin(role) && (
                <HumanFlowConfigPanel
                    isOpen={isHumanConfigOpen}
                    onOpenChange={setIsHumanConfigOpen}
                    humanConfig={humanConfig}
                    mergedLabels={mergedLabels}
                    attributeDefinitions={attributeDefinitions}
                    loadingAttributeDefinitions={loadingAttributeDefinitions}
                    hasHumanConfigChanges={hasHumanConfigChanges}
                    updateHumanConfigList={updateHumanConfigList}
                    updateHumanConfigLabel={updateHumanConfigLabel}
                    saveHumanConfig={saveHumanConfig}
                />
            )}



            <FollowupQueueTable<QueueLead>
                title="Cola de Trabajo Diaria"
                description="Leads que entran al seguimiento humano y deben pasar a cita agendada humana."
                configuredTags={humanFollowupQueueTags}
                leads={followUpQueue}
                primaryActionLabel="Cita agendada"
                primaryActionIcon={CalendarDays}
                primaryActionClassName="border-violet-300 text-violet-700 hover:bg-violet-50"
                onPrimaryAction={openAppointmentDialog}
                onChangeStatus={handleOpenTagChange}
                onOpenHistory={openHistory}
                getChannelName={getChannelName}
                searchValue={followUpSearch}
                onSearchChange={setFollowUpSearch}
            />

            <FollowupQueueTable<QueueLead>
                title="Citas Agendadas"
                description="Leads que ya estan en etapa de cita y desde aqui pueden confirmarse como venta exitosa."
                configuredTags={humanSalesQueueTags}
                leads={scheduledAppointmentsQueue}
                primaryActionLabel="Venta exitosa"
                primaryActionIcon={DollarSign}
                primaryActionClassName="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onPrimaryAction={openOperationDialog}
                onChangeStatus={handleOpenTagChange}
                onOpenHistory={openHistory}
                getChannelName={getChannelName}
                searchValue={scheduledSearch}
                onSearchChange={setScheduledSearch}
            />

            <SalesReportPanel
                salesCount={salesRows.length}
                salesTotal={salesTotal}
                salesStartDate={salesStartDate}
                salesEndDate={salesEndDate}
                salesSearch={salesSearch}
                canConfigureColumns={isAdmin(role)}
                tagSettings={tagSettings}
                onSalesStartDateChange={setSalesStartDate}
                onSalesEndDateChange={setSalesEndDate}
                onSalesSearchChange={setSalesSearch}
                onExportSalesReport={exportSalesReport}
                updateTagSettings={updateTagSettings}
            />

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
                                    {configuredAppointmentFields.map(renderAppointmentField)}
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
                                    El lead saldrá de la cola actual y quedará con el estado <strong>{formatBusinessLabel(humanAppointmentTargetLabel)}</strong>.
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
                                    {configuredSaleFields.map(renderSaleField)}
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

            <LeadMessageHistoryDialog
                isOpen={isHistoryOpen}
                onOpenChange={setIsHistoryOpen}
                lead={historyLead}
                messages={historyMessages}
                loading={loadingHistory}
            />

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
                                <p className="mt-2">Después del cambio, este lead puede desaparecer de esta vista si ya no coincide con los estados configurados para la tabla actual.</p>
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

export default LeadActionQueue;