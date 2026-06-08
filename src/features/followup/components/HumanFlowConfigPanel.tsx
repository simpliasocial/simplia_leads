import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Loader2, Settings2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    formatBusinessLabel,
    formatBusinessList,
    formatFieldLabel,
} from "@/lib/displayCopy";
import {
    getFieldTypeLabel,
    type AttributeDefinition,
    type HumanFlowConfigState,
} from "../model/leadActionQueueModel";

type HumanFlowListKey = keyof Pick<
    HumanFlowConfigState,
    "humanFollowupQueueTags" | "humanSalesQueueTags" | "humanAppointmentFieldKeys" | "humanSaleFieldKeys"
>;

type HumanFlowLabelKey = "humanAppointmentTargetLabel" | "humanSaleTargetLabel";

type HumanFlowConfigPanelProps = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    humanConfig: HumanFlowConfigState;
    mergedLabels: string[];
    attributeDefinitions: AttributeDefinition[];
    loadingAttributeDefinitions: boolean;
    hasHumanConfigChanges: boolean;
    updateHumanConfigList: (key: HumanFlowListKey, value: string) => void;
    updateHumanConfigLabel: (key: HumanFlowLabelKey, value: string) => void;
    saveHumanConfig: () => void | Promise<void>;
    metaCapiSection?: ReactNode;
};

export const HumanFlowConfigPanel = ({
    isOpen,
    onOpenChange,
    humanConfig,
    mergedLabels,
    attributeDefinitions,
    loadingAttributeDefinitions,
    hasHumanConfigChanges,
    updateHumanConfigList,
    updateHumanConfigLabel,
    saveHumanConfig,
    metaCapiSection,
}: HumanFlowConfigPanelProps) => (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-4">
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="w-full text-left"
                        aria-label={isOpen ? "Ocultar configuracion del flujo humano" : "Abrir configuracion del flujo humano"}
                    >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <Settings2 className="h-6 w-6 text-primary" />
                                    Configurar flujo humano
                                </CardTitle>
                                <CardDescription className="mt-2">
                                    Define qué estados entran a cada cola y qué datos se pedirán al marcar una cita agendada o una venta exitosa.
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                                <Badge variant="outline">{humanConfig.humanFollowupQueueTags.length} estados en seguimiento</Badge>
                                <Badge variant="outline">{humanConfig.humanSalesQueueTags.length} estados en citas agendadas</Badge>
                                <Badge variant="outline">{humanConfig.humanAppointmentFieldKeys.length} campos para cita</Badge>
                                <Badge variant="outline">{humanConfig.humanSaleFieldKeys.length} campos para venta</Badge>
                                <Badge variant="secondary" className="gap-1.5 px-3 py-1">
                                    {isOpen ? (
                                        <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                    {isOpen ? "Ocultar" : "Abrir"}
                                </Badge>
                            </div>
                        </div>
                    </button>
                </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
                <CardContent className="space-y-5">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Estado destino de cita</Label>
                                <Select
                                    value={humanConfig.humanAppointmentTargetLabel}
                                    onValueChange={(value) => updateHumanConfigLabel("humanAppointmentTargetLabel", value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona estado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {mergedLabels.map((label) => (
                                            <SelectItem key={`appointment-target-${label}`} value={label}>
                                                {formatBusinessLabel(label)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Estado destino de venta</Label>
                                <Select
                                    value={humanConfig.humanSaleTargetLabel}
                                    onValueChange={(value) => updateHumanConfigLabel("humanSaleTargetLabel", value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona estado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {mergedLabels.map((label) => (
                                            <SelectItem key={`sale-target-${label}`} value={label}>
                                                {formatBusinessLabel(label)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                            <p className="font-semibold text-foreground">Resumen activo</p>
                            <div className="mt-3 space-y-2 text-muted-foreground">
                                <p>
                                    Seguimiento humano:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanFollowupQueueTags.length ? formatBusinessList(humanConfig.humanFollowupQueueTags) : "Sin estados"}
                                    </span>
                                </p>
                                <p>
                                    Cita humana destino:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanAppointmentTargetLabel ? formatBusinessLabel(humanConfig.humanAppointmentTargetLabel) : "Sin configurar"}
                                    </span>
                                </p>
                                <p>
                                    Cola de ventas:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanSalesQueueTags.length ? formatBusinessList(humanConfig.humanSalesQueueTags) : "Sin estados"}
                                    </span>
                                </p>
                                <p>
                                    Venta destino:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanSaleTargetLabel ? formatBusinessLabel(humanConfig.humanSaleTargetLabel) : "Sin configurar"}
                                    </span>
                                </p>
                                <p>
                                    Campos de cita:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanAppointmentFieldKeys.length ? humanConfig.humanAppointmentFieldKeys.map(formatFieldLabel).join(", ") : "Sin campos"}
                                    </span>
                                </p>
                                <p>
                                    Campos de venta:{" "}
                                    <span className="font-medium text-foreground">
                                        {humanConfig.humanSaleFieldKeys.length ? humanConfig.humanSaleFieldKeys.map(formatFieldLabel).join(", ") : "Sin campos"}
                                    </span>
                                </p>
                            </div>
                        </div>
                    </div>

                    <Accordion type="multiple" className="w-full rounded-xl border px-4">
                        <AccordionItem value="followup-tags">
                            <AccordionTrigger className="text-sm">
                                Estados que entran en Cola de Trabajo Diaria
                            </AccordionTrigger>
                            <AccordionContent>
                                <ScrollArea className="h-[220px] rounded-lg border p-4">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {mergedLabels.map((label) => (
                                            <div key={`followup-label-${label}`} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`followup-label-${label}`}
                                                    checked={humanConfig.humanFollowupQueueTags.includes(label)}
                                                    onCheckedChange={() => updateHumanConfigList("humanFollowupQueueTags", label)}
                                                />
                                                <Label htmlFor={`followup-label-${label}`} className="text-sm font-medium">
                                                    {formatBusinessLabel(label)}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="sales-tags">
                            <AccordionTrigger className="text-sm">
                                Estados que entran en Citas Agendadas
                            </AccordionTrigger>
                            <AccordionContent>
                                <ScrollArea className="h-[220px] rounded-lg border p-4">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {mergedLabels.map((label) => (
                                            <div key={`sales-label-${label}`} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`sales-label-${label}`}
                                                    checked={humanConfig.humanSalesQueueTags.includes(label)}
                                                    onCheckedChange={() => updateHumanConfigList("humanSalesQueueTags", label)}
                                                />
                                                <Label htmlFor={`sales-label-${label}`} className="text-sm font-medium">
                                                    {formatBusinessLabel(label)}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="appointment-fields">
                            <AccordionTrigger className="text-sm">
                                Campos que se pedirán al marcar Cita agendada
                            </AccordionTrigger>
                            <AccordionContent>
                                {loadingAttributeDefinitions ? (
                                    <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Cargando campos configurados...
                                    </div>
                                ) : attributeDefinitions.length === 0 ? (
                                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                                        No hay campos configurados disponibles todavía.
                                    </div>
                                ) : (
                                    <ScrollArea className="h-[260px] rounded-lg border p-4">
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {attributeDefinitions.map((definition) => (
                                                <div key={definition.key} className="flex items-start space-x-2">
                                                    <Checkbox
                                                        id={`appointment-field-${definition.key}`}
                                                        checked={humanConfig.humanAppointmentFieldKeys.includes(definition.key)}
                                                        onCheckedChange={() => updateHumanConfigList("humanAppointmentFieldKeys", definition.key)}
                                                    />
                                                    <Label htmlFor={`appointment-field-${definition.key}`} className="text-sm font-medium leading-tight">
                                                        <span className="flex flex-wrap items-center gap-2">
                                                            <span>{definition.label}</span>
                                                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                                                                {getFieldTypeLabel(definition)}
                                                            </Badge>
                                                        </span>
                                                        {definition.description && (
                                                            <span className="block text-[11px] text-muted-foreground">
                                                                {definition.description}
                                                            </span>
                                                        )}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="sale-fields">
                            <AccordionTrigger className="text-sm">
                                Campos que se pedirán al marcar Venta exitosa
                            </AccordionTrigger>
                            <AccordionContent>
                                {loadingAttributeDefinitions ? (
                                    <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Cargando campos configurados...
                                    </div>
                                ) : attributeDefinitions.length === 0 ? (
                                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                                        No hay campos configurados disponibles todavía.
                                    </div>
                                ) : (
                                    <ScrollArea className="h-[260px] rounded-lg border p-4">
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {attributeDefinitions.map((definition) => (
                                                <div key={`sale-field-${definition.key}`} className="flex items-start space-x-2">
                                                    <Checkbox
                                                        id={`sale-field-${definition.key}`}
                                                        checked={humanConfig.humanSaleFieldKeys.includes(definition.key)}
                                                        onCheckedChange={() => updateHumanConfigList("humanSaleFieldKeys", definition.key)}
                                                    />
                                                    <Label htmlFor={`sale-field-${definition.key}`} className="text-sm font-medium leading-tight">
                                                        <span className="flex flex-wrap items-center gap-2">
                                                            <span>{definition.label}</span>
                                                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                                                                {getFieldTypeLabel(definition)}
                                                            </Badge>
                                                        </span>
                                                        {definition.description && (
                                                            <span className="block text-[11px] text-muted-foreground">
                                                                {definition.description}
                                                            </span>
                                                        )}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    <div className="flex flex-col gap-3 rounded-xl border bg-amber-50/60 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                        <p>
                            Si no dejas campos configurados para cita agendada o venta exitosa, el boton de la cola mostrará un aviso para configurar primero el flujo.
                        </p>
                        <Button
                            onClick={saveHumanConfig}
                            disabled={!hasHumanConfigChanges}
                            className="sm:w-auto"
                        >
                            Guardar configuracion
                        </Button>
                    </div>

                    {metaCapiSection}
                </CardContent>
            </CollapsibleContent>
        </Card>
    </Collapsible>
);
