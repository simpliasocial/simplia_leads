import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
    CheckCircle2,
    Clock,
    ExternalLink,
    ListTodo,
    Phone,
    RefreshCw,
    Search,
    UserCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/DataTablePagination";
import {
    formatDateTime,
    getChatwootUrl,
    getInitials,
    getLeadExternalUrl,
    getLeadName,
    getLeadPhone,
    getMessagePreview,
    getMessageTimestamp,
    getAttrs,
} from "@/lib/leadDisplay";
import {
    buildPaginatedListState,
    WINDOWED_TABLE_MAX_HEIGHT_PX,
} from "@/lib/windowedList";
import { formatBusinessLabel } from "@/lib/displayCopy";
import { getEmptyQueueMessage } from "../model/leadActionQueueModel";

type DisplayLead = Parameters<typeof getLeadName>[0];

export type FollowupQueueTableLead = DisplayLead & {
    id: number;
    owner?: string;
};

type FollowupQueueTableProps<TLead extends FollowupQueueTableLead> = {
    title: string;
    description: string;
    configuredTags: string[];
    leads: TLead[];
    primaryActionLabel: string;
    primaryActionIcon: LucideIcon;
    primaryActionClassName: string;
    onPrimaryAction: (lead: TLead) => void;
    onChangeStatus: (lead: TLead) => void;
    onOpenHistory: (lead: TLead) => void;
    getChannelName: (lead: TLead) => string;
    searchValue: string;
    onSearchChange: (value: string) => void;
};

export const FollowupQueueTable = <TLead extends FollowupQueueTableLead>({
    title,
    description,
    configuredTags,
    leads,
    primaryActionLabel,
    primaryActionIcon: PrimaryActionIcon,
    primaryActionClassName,
    onPrimaryAction,
    onChangeStatus,
    onOpenHistory,
    getChannelName,
    searchValue,
    onSearchChange,
}: FollowupQueueTableProps<TLead>) => {
    const [page, setPage] = useState(1);
    const paginatedLeads = buildPaginatedListState(leads, page);
    const filteredLabel = `${paginatedLeads.total} lead${paginatedLeads.total === 1 ? "" : "s"} filtrado${paginatedLeads.total === 1 ? "" : "s"}`;
    const summaryLabel = `${filteredLabel} \u00b7 m\u00e1s recientes primero`;

    useEffect(() => {
        setPage(1);
    }, [leads]);

    return (
        <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <ListTodo className="h-6 w-6 text-primary" />
                            {title}
                        </CardTitle>
                        <CardDescription className="mt-2 space-y-2">
                            <span className="block">{description}</span>
                            <span className="flex flex-wrap items-center gap-2">
                                {configuredTags.length > 0 ? (
                                    configuredTags.map((label) => (
                                        <Badge key={`${title}-${label}`} variant="outline">
                                            {formatBusinessLabel(label)}
                                        </Badge>
                                    ))
                                ) : (
                                    <Badge variant="outline">Sin estados configurados</Badge>
                                )}
                            </span>
                        </CardDescription>
                    </div>
                    <div className="flex w-full flex-col items-end gap-3 lg:w-auto">
                        <div className="w-fit rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            {summaryLabel}
                        </div>
                        <div className="relative w-full sm:w-64 lg:w-80">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                className="h-9 pl-9 text-sm"
                                placeholder={`Buscar en ${title.toLowerCase()}...`}
                                value={searchValue}
                                onChange={(event) => onSearchChange(event.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="relative overflow-hidden rounded-xl border bg-background">
                    <div
                        className={paginatedLeads.hasVerticalScroll ? "overflow-auto overscroll-contain" : "overflow-x-auto"}
                        style={paginatedLeads.hasVerticalScroll ? { maxHeight: `${WINDOWED_TABLE_MAX_HEIGHT_PX}px` } : undefined}
                    >
                        <table className="w-full min-w-[1480px] text-left text-sm">
                            <thead className="sticky top-0 z-10 border-b bg-muted/95 text-[10px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                                <tr>
                                    <th className="px-6 py-4">Nombre del lead</th>
                                    <th className="px-6 py-4">Canal</th>
                                    <th className="px-6 py-4">{"N\u00famero"}</th>
                                    <th className="px-6 py-4">Producto</th>
                                    <th className="px-6 py-4">Historial de mensajes</th>
                                    <th className="px-6 py-4">URL</th>
                                    <th className="px-6 py-4">Cambiar estado</th>
                                    <th className="px-6 py-4 text-right">Acciones</th>
                                    <th className="px-6 py-4">Fecha de ingreso</th>
                                    <th className="px-6 py-4">{"\u00daltima interacci\u00f3n"}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-muted/20">
                                {paginatedLeads.visibleItems.map((lead) => {
                                    const displayName = getLeadName(lead);
                                    const channelDisplay = getChannelName(lead);
                                    const phoneDisplay = getLeadPhone({ ...lead, channel: channelDisplay }, channelDisplay);
                                    const lastMessage = getMessagePreview(lead);
                                    const lastMessageDate = formatDateTime(getMessageTimestamp(lead));
                                    const externalUrl = getLeadExternalUrl(lead, channelDisplay);
                                    const createdDate = formatDateTime(lead.created_at || lead.timestamp);
                                    const lastInteractionDate = formatDateTime(lead.timestamp || lead.created_at);

                                    return (
                                        <tr key={`${title}-${lead.id}`} className="bg-background transition-colors hover:bg-muted/10">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase text-primary">
                                                        {getInitials(displayName)}
                                                    </div>
                                                    <div className="flex min-w-0 flex-col">
                                                        <span className="truncate font-semibold text-foreground">{displayName}</span>
                                                        <span className="text-[10px] text-muted-foreground">ID {lead.id}</span>
                                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                            <UserCircle className="h-3 w-3" />
                                                            {lead.owner}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge variant="secondary" className="px-2 py-0 text-[10px] font-bold uppercase">
                                                    {channelDisplay}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 text-xs">
                                                    <span className="flex items-center gap-1.5 font-medium italic text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {phoneDisplay || "Sin n\u00famero"}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-medium text-foreground">
                                                {String(getAttrs(lead).producto || "-")}
                                            </td>
                                            <td className="px-6 py-4">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenHistory(lead)}
                                                    className="flex max-w-[300px] flex-col text-left hover:text-primary"
                                                >
                                                    <span className="truncate text-xs font-medium text-foreground">
                                                        {lastMessage}
                                                    </span>
                                                    <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        {lastMessageDate}
                                                    </span>
                                                    <span className="mt-1 text-[10px] text-primary">Ver historial</span>
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
                                            <td className="px-6 py-4">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 gap-2 border-primary/30 text-xs text-primary hover:bg-primary/5"
                                                    onClick={() => onChangeStatus(lead)}
                                                >
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    Cambiar estado
                                                </Button>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className={`h-8 gap-2 text-xs ${primaryActionClassName}`}
                                                        onClick={() => onPrimaryAction(lead)}
                                                    >
                                                        <PrimaryActionIcon className="h-3.5 w-3.5" />
                                                        {primaryActionLabel}
                                                    </Button>
                                                    <a href={getChatwootUrl(lead.id)} target="_blank" rel="noreferrer">
                                                        <Button size="sm" variant="ghost" className="h-8 gap-2 px-2 text-xs text-muted-foreground hover:text-primary">
                                                            <ExternalLink className="h-4 w-4" />
                                                            {"Abrir conversaci\u00f3n"}
                                                        </Button>
                                                    </a>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-muted-foreground">{createdDate}</td>
                                            <td className="px-6 py-4 text-xs text-muted-foreground">{lastInteractionDate}</td>
                                        </tr>
                                    );
                                })}
                                {paginatedLeads.visibleItems.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-2 opacity-40">
                                                <CheckCircle2 className="h-12 w-12 text-muted-foreground" />
                                                <span className="text-sm font-medium italic">{getEmptyQueueMessage(title, configuredTags)}</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <DataTablePagination
                        total={paginatedLeads.total}
                        page={paginatedLeads.page}
                        pageCount={paginatedLeads.pageCount}
                        start={paginatedLeads.start}
                        end={paginatedLeads.end}
                        onPageChange={setPage}
                    />
                </div>
            </CardContent>
        </Card>
    );
};
