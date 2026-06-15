import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    AlertCircle,
    ArrowLeft,
    Check,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    ExternalLink,
    Globe2,
    Loader2,
    LogOut,
    Plus,
    RefreshCw,
    Save,
    ShieldCheck,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
    BreSourceType,
    ContextFieldV1,
    InfoSealV1,
    InternalBusinessDataV1,
    MoneyMetricV1,
    OnboardingBreProjectV1,
} from "../domain/types";
import { onboardingBreApiClient } from "../infrastructure/OnboardingBreApiClient";
import {
    BUSINESS_MODEL_OPTIONS,
    INTERNAL_INFO_SEALS,
    canFinalizeBaseContext,
    validateInternalBusinessData,
} from "../model/onboardingBreModel";

const projectKey = (projectId: string) => ["onboarding-bre", "project", projectId] as const;
const SOURCE_FIELDS: Array<{ type: BreSourceType; label: string; placeholder: string; required?: boolean }> = [
    { type: "website", label: "Sitio web oficial", placeholder: "https://empresa.com", required: true },
    { type: "instagram", label: "Instagram", placeholder: "https://instagram.com/empresa" },
    { type: "facebook", label: "Facebook", placeholder: "https://facebook.com/empresa" },
    { type: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@empresa" },
    { type: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/company/empresa" },
    { type: "youtube", label: "YouTube", placeholder: "https://youtube.com/@empresa" },
];

const CATEGORY_LABELS: Record<string, string> = {
    identity: "Identidad",
    classification: "Clasificación comercial",
    offer: "Oferta comercial",
    icp: "Cliente ideal inferido",
    communication: "Comunicación y tono",
    faqs: "FAQs candidatas",
    locations: "Ubicaciones posibles",
    hours: "Horarios visibles",
    contacts: "Contactos y canales",
    marketing: "Marketing y contenido",
    legal: "Información legal visible",
};

const STATUS_LABELS: Record<string, string> = {
    draft: "Borrador",
    sources_ready: "Fuentes listas",
    scraping: "Procesando",
    review_context: "Revisar contexto",
    collecting_answers: "Completando información",
    base_context_complete: "Contexto base completo",
    pending: "Pendiente",
    queued: "En cola",
    processing: "Procesando",
    completed: "Completada",
    partial: "Parcial",
    platform_blocked: "Plataforma bloqueada",
    failed: "Fallida",
};

const fieldLabel = (key: string) => key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const valueToText = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
    return JSON.stringify(value, null, 2);
};

const editorValue = (original: unknown, text: string): unknown => {
    if (Array.isArray(original)) return text.split("\n").map((item) => item.trim()).filter(Boolean);
    if (original && typeof original === "object") {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    return text.trim();
};

const InfoSeal = ({ info }: { info: InfoSealV1 }) => (
    <Popover>
        <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Ver información del campo">
                <CircleHelp className="h-4 w-4" />
            </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
            <div>
                <p className="font-semibold">Qué significa</p>
                <p className="text-muted-foreground">{info.definition}</p>
            </div>
            <div>
                <p className="font-semibold">Ejemplos</p>
                <p className="text-muted-foreground">{info.examples.join(" · ")}</p>
            </div>
            <div>
                <p className="font-semibold">Por qué se pide</p>
                <p className="text-muted-foreground">{info.reason}</p>
            </div>
            <div>
                <p className="font-semibold">Formato esperado</p>
                <p className="text-muted-foreground">{info.expectedFormat}</p>
            </div>
        </PopoverContent>
    </Popover>
);

const AppShell = ({ children, projectName }: { children: React.ReactNode; projectName?: string }) => {
    const { signOut } = useAuth();
    const navigate = useNavigate();
    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b bg-white">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-xl bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" /></div>
                        <div className="min-w-0">
                            <p className="font-semibold">Onboarding BRE</p>
                            <p className="truncate text-sm text-muted-foreground">{projectName || "Contexto base del negocio"}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild><Link to="/onboarding-bre">Proyectos</Link></Button>
                        <Button variant="ghost" size="icon" onClick={() => signOut().then(() => navigate("/login"))} aria-label="Cerrar sesión">
                            <LogOut className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        </div>
    );
};

const ProjectList = () => {
    const { role } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
    const projectsQuery = useQuery({
        queryKey: ["onboarding-bre", "projects"],
        queryFn: () => onboardingBreApiClient.listProjects(),
    });
    const adminsQuery = useQuery({
        queryKey: ["onboarding-bre", "company-admins"],
        queryFn: () => onboardingBreApiClient.listCompanyAdmins(),
        enabled: role === "platform_admin",
    });
    const createMutation = useMutation({
        mutationFn: () => onboardingBreApiClient.createProject({ name, assignedUserIds }),
        onSuccess: ({ projectId }) => {
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            navigate(`/onboarding-bre/${projectId}`);
        },
        onError: (error) => toast.error(error.message),
    });

    return (
        <AppShell>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section>
                    <div className="mb-5">
                        <h1 className="text-2xl font-bold tracking-tight">Proyectos BRE</h1>
                        <p className="mt-1 text-muted-foreground">Cada proyecto mantiene su scraping, evidencias y contexto completamente aislados.</p>
                    </div>
                    {projectsQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando proyectos...</div>
                    ) : projectsQuery.error ? (
                        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se pudieron cargar</AlertTitle><AlertDescription>{projectsQuery.error.message}</AlertDescription></Alert>
                    ) : projectsQuery.data?.projects.length ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {projectsQuery.data.projects.map((project) => (
                                <Card key={project.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => navigate(`/onboarding-bre/${project.id}`)}>
                                    <CardHeader>
                                        <div className="flex items-start justify-between gap-3">
                                            <CardTitle className="text-lg">{project.name}</CardTitle>
                                            <Badge variant={project.status === "base_context_complete" ? "default" : "secondary"}>{STATUS_LABELS[project.status]}</Badge>
                                        </div>
                                        <CardDescription>Actualizado {new Date(project.updatedAt).toLocaleString()}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                                        <span>{project.assignedUserIds.length} miembro(s)</span>
                                        <ChevronRight className="h-4 w-4" />
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <Card><CardContent className="py-10 text-center text-muted-foreground">No hay proyectos asignados todavía.</CardContent></Card>
                    )}
                </section>

                {role === "platform_admin" && (
                    <Card className="h-fit">
                        <CardHeader><CardTitle>Nuevo proyecto</CardTitle><CardDescription>Crea el espacio y asígnalo a uno o más administradores de empresa.</CardDescription></CardHeader>
                        <CardContent className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="project-name">Nombre del proyecto</Label>
                                <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Onboarding Empresa ACME" />
                            </div>
                            <div className="space-y-3">
                                <Label>Company admins</Label>
                                {adminsQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando usuarios...</p> : adminsQuery.data?.users.map((admin) => (
                                    <label key={admin.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                                        <Checkbox
                                            checked={assignedUserIds.includes(admin.id)}
                                            onCheckedChange={(checked) => setAssignedUserIds((current) => checked
                                                ? [...current, admin.id]
                                                : current.filter((id) => id !== admin.id))}
                                        />
                                        <span className="truncate">{admin.email || admin.id}</span>
                                    </label>
                                ))}
                            </div>
                            <Button className="w-full" disabled={createMutation.isPending || name.trim().length < 2 || assignedUserIds.length === 0} onClick={() => createMutation.mutate()}>
                                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                Crear proyecto
                            </Button>
                        </CardContent>
                    </Card>
                )}
            </div>
        </AppShell>
    );
};

type WizardStage = "sources" | "processing" | "context" | "gaps" | "internal" | "summary";
const STAGES: Array<{ key: WizardStage; label: string }> = [
    { key: "sources", label: "Fuentes" },
    { key: "processing", label: "Scraping" },
    { key: "context", label: "Contexto" },
    { key: "gaps", label: "Faltantes" },
    { key: "internal", label: "Datos internos" },
    { key: "summary", label: "Cierre" },
];

const WizardProgress = ({ stage }: { stage: WizardStage }) => {
    const active = STAGES.findIndex((item) => item.key === stage);
    return (
        <div className="mb-8 overflow-x-auto pb-2">
            <div className="flex min-w-[720px] items-center">
                {STAGES.map((item, index) => (
                    <div key={item.key} className="flex flex-1 items-center last:flex-none">
                        <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${index <= active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                {index < active ? <Check className="h-4 w-4" /> : index + 1}
                            </div>
                            <span className={`whitespace-nowrap text-sm ${index <= active ? "font-medium" : "text-muted-foreground"}`}>{item.label}</span>
                        </div>
                        {index < STAGES.length - 1 && <div className={`mx-3 h-px flex-1 ${index < active ? "bg-primary" : "bg-border"}`} />}
                    </div>
                ))}
            </div>
        </div>
    );
};

const SourcesStep = ({ project, onStarted }: { project: OnboardingBreProjectV1; onStarted: () => void }) => {
    const queryClient = useQueryClient();
    const initial = Object.fromEntries(SOURCE_FIELDS.map((item) => [item.type, project.sources.find((source) => source.type === item.type && source.origin === "user")?.url || ""]));
    const [urls, setUrls] = useState<Record<string, string>>(initial);
    const [otherUrls, setOtherUrls] = useState(project.sources.filter((source) => source.type === "other" && source.origin === "user").map((source) => source.url));
    const processMutation = useMutation({
        mutationFn: async () => {
            const sources = [
                ...SOURCE_FIELDS.map((item) => ({ type: item.type, url: urls[item.type]?.trim() })).filter((item) => item.url),
                ...otherUrls.map((url) => ({ type: "other" as const, url: url.trim() })).filter((item) => item.url),
            ];
            const saved = await onboardingBreApiClient.saveSources({ projectId: project.id, sources });
            queryClient.setQueryData(projectKey(project.id), saved);
            return onboardingBreApiClient.startScrape(project.id, crypto.randomUUID());
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
            onStarted();
        },
        onError: (error) => toast.error(error.message),
    });

    const discovered = project.sources.filter((source) => source.origin === "discovered");
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Fuentes públicas</h2>
                <p className="mt-1 text-muted-foreground">El sitio web es obligatorio. Las redes son complementarias y su extracción es best effort.</p>
            </div>
            <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Procesamiento público y seguro</AlertTitle><AlertDescription>No se usarán cuentas personales, proxies pagados, evasión de CAPTCHA ni contenido privado.</AlertDescription></Alert>
            <Card>
                <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
                    {SOURCE_FIELDS.map((item) => (
                        <div key={item.type} className="space-y-2">
                            <Label htmlFor={`source-${item.type}`}>{item.label}{item.required && <span className="ml-1 text-destructive">*</span>}</Label>
                            <Input id={`source-${item.type}`} type="url" value={urls[item.type] || ""} onChange={(event) => setUrls((current) => ({ ...current, [item.type]: event.target.value }))} placeholder={item.placeholder} />
                        </div>
                    ))}
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle className="text-lg">Otras fuentes públicas</CardTitle><CardDescription>Puedes agregar páginas o redes adicionales; se procesarán con el adaptador web genérico.</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                    {otherUrls.map((url, index) => (
                        <div key={index} className="flex gap-2">
                            <Input value={url} onChange={(event) => setOtherUrls((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="https://otra-fuente.com/perfil" />
                            <Button variant="outline" onClick={() => setOtherUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</Button>
                        </div>
                    ))}
                    <Button variant="outline" onClick={() => setOtherUrls((current) => [...current, ""])}><Plus className="mr-2 h-4 w-4" />Agregar otra fuente</Button>
                </CardContent>
            </Card>
            {discovered.length > 0 && (
                <Card><CardHeader><CardTitle className="text-lg">Fuentes descubiertas</CardTitle></CardHeader><CardContent className="space-y-2">{discovered.map((source) => <div key={source.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span className="truncate">{source.url}</span><Badge variant="secondary">{source.type}</Badge></div>)}</CardContent></Card>
            )}
            <div className="flex justify-end">
                <Button size="lg" disabled={processMutation.isPending || !urls.website?.trim()} onClick={() => processMutation.mutate()}>
                    {processMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe2 className="mr-2 h-4 w-4" />}
                    Guardar e iniciar scraping
                </Button>
            </div>
        </div>
    );
};

const ProcessingStep = ({ project, onBack }: { project: OnboardingBreProjectV1; onBack: () => void }) => {
    const queryClient = useQueryClient();
    const retryMutation = useMutation({
        mutationFn: (sourceId: string) => onboardingBreApiClient.retrySource(project.id, sourceId, crypto.randomUUID()),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKey(project.id) }),
        onError: (error) => toast.error(error.message),
    });
    const run = project.latestRun;
    const progress = run?.sourcesTotal ? Math.round((run.sourcesCompleted / run.sourcesTotal) * 100) : 5;
    const website = project.sources.find((source) => source.type === "website");
    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="text-center">
                {project.status === "scraping" ? <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" /> : <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />}
                <h2 className="text-2xl font-bold">{project.status === "scraping" ? "Construyendo el contexto del negocio" : "El sitio web necesita atención"}</h2>
                <p className="mt-2 text-muted-foreground">Rastreo, extracción, deduplicación, evidencias y normalización IA se ejecutan fuera del navegador.</p>
            </div>
            <Card><CardContent className="space-y-3 pt-6"><div className="flex justify-between text-sm"><span>{run?.pagesProcessed || 0} páginas procesadas</span><span>{progress}%</span></div><Progress value={progress} /></CardContent></Card>
            <div className="space-y-3">
                {(run?.sourceProgress || project.sources).map((source: any) => (
                    <Card key={source.sourceId || source.id}>
                        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2"><p className="font-medium capitalize">{source.sourceType || source.type}</p><Badge variant={["completed"].includes(source.status) ? "default" : ["failed", "platform_blocked"].includes(source.status) ? "destructive" : "secondary"}>{STATUS_LABELS[source.status] || source.status}</Badge></div>
                                <p className="mt-1 truncate text-sm text-muted-foreground">{source.errorMessage || `${source.pagesProcessed || 0} páginas`}</p>
                            </div>
                            {["failed", "platform_blocked", "partial"].includes(source.status) && source.sourceId && (
                                <Button variant="outline" size="sm" disabled={retryMutation.isPending || project.status === "scraping"} onClick={() => retryMutation.mutate(source.sourceId)}><RefreshCw className="mr-2 h-4 w-4" />Reintentar</Button>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
            {website && ["failed", "platform_blocked", "partial"].includes(website.status) && (
                <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>El sitio web es obligatorio</AlertTitle><AlertDescription>Corrige la fuente o reintenta. Una red social puede fallar sin bloquear, pero el sitio oficial debe completar correctamente.</AlertDescription></Alert>
            )}
            {project.status !== "scraping" && <Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Revisar fuentes</Button>}
        </div>
    );
};

const ContextFieldCard = ({ projectId, field }: { projectId: string; field: ContextFieldV1 }) => {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(valueToText(field.value));
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveContextField(projectId, field.key, editorValue(field.value, text)),
        onSuccess: (project) => {
            queryClient.setQueryData(projectKey(projectId), project);
            setEditing(false);
            toast.success("Campo actualizado");
        },
        onError: (error) => toast.error(error.message),
    });
    return (
        <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium">{fieldLabel(field.key)}</p><div className="mt-1 flex flex-wrap gap-1"><Badge variant="outline">{field.origin}</Badge>{field.confidence && <Badge variant="secondary">Confianza {field.confidence}</Badge>}<Badge variant={field.status === "confirmed" || field.status === "corrected" ? "default" : "outline"}>{field.status}</Badge></div></div>
                <Button variant="ghost" size="sm" onClick={() => setEditing((current) => !current)}>{editing ? "Cancelar" : "Editar"}</Button>
            </div>
            {editing ? (
                <div className="mt-3 space-y-3"><Textarea rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} value={text} onChange={(event) => setText(event.target.value)} /><Button size="sm" disabled={mutation.isPending || !text.trim()} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar corrección</Button></div>
            ) : <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{valueToText(field.value) || <span className="italic text-muted-foreground">No encontrado</span>}</div>}
            {field.evidence.length > 0 && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">Ver {field.evidence.length} evidencia(s)</summary><div className="mt-2 space-y-2">{field.evidence.map((item, index) => <div key={item.id || `${item.url}-${index}`} className="rounded-lg bg-muted/50 p-3"><a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-primary">Abrir fuente <ExternalLink className="h-3 w-3" /></a><p className="mt-1 text-muted-foreground">{item.originalText}</p></div>)}</div></details>
            )}
        </div>
    );
};

const ContextStep = ({ project, onContinue }: { project: OnboardingBreProjectV1; onContinue: () => void }) => {
    const grouped = useMemo(() => project.contextFields.reduce<Record<string, ContextFieldV1[]>>((result, field) => {
        result[field.category] = [...(result[field.category] || []), field];
        return result;
    }, {}), [project.contextFields]);
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Contexto detectado</h2><p className="mt-1 text-muted-foreground">Revisa datos, inferencias y evidencias. Las ubicaciones y horarios son contexto, no configuración final.</p></div>
            <Alert><Sparkles className="h-4 w-4" /><AlertTitle>Las inferencias nunca se confirman solas</AlertTitle><AlertDescription>Industria, ICP u otros datos inferidos pasarán al siguiente paso para confirmación aunque su confianza sea alta.</AlertDescription></Alert>
            {Object.entries(grouped).map(([category, fields]) => (
                <section key={category} className="space-y-3"><h3 className="text-lg font-semibold">{CATEGORY_LABELS[category] || category}</h3><div className="grid gap-3 lg:grid-cols-2">{fields.map((field) => <ContextFieldCard key={field.key} projectId={project.id} field={field} />)}</div></section>
            ))}
            <div className="flex justify-end"><Button size="lg" onClick={onContinue}>Continuar a validación <ChevronRight className="ml-2 h-4 w-4" /></Button></div>
        </div>
    );
};

const GapsStep = ({ project, onContinue }: { project: OnboardingBreProjectV1; onContinue: () => void }) => {
    const queryClient = useQueryClient();
    const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(project.dynamicQuestions.map((question) => [question.fieldKey, valueToText(question.suggestedValue)])));
    const mutation = useMutation({
        mutationFn: ({ fieldKey, value, action }: { fieldKey: any; value: unknown; action: "confirm" | "correct" }) => onboardingBreApiClient.saveContextAnswer({ projectId: project.id, fieldKey, value, action }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Respuesta guardada");
        },
        onError: (error) => toast.error(error.message),
    });
    if (project.dynamicQuestions.length === 0) return (
        <div className="mx-auto max-w-2xl text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><h2 className="mt-4 text-2xl font-bold">Contexto público validado</h2><p className="mt-2 text-muted-foreground">No quedan campos faltantes, dudosos o contradictorios dentro de este alcance.</p><Button className="mt-6" size="lg" onClick={onContinue}>Continuar a datos internos</Button></div>
    );
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Completar y validar</h2><p className="mt-1 text-muted-foreground">Solo se muestran campos previstos que el scraping no pudo resolver de forma confiable.</p></div>
            {project.dynamicQuestions.map((question) => (
                <Card key={question.fieldKey}>
                    <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{question.label}</CardTitle><CardDescription className="mt-1">{question.prompt}</CardDescription></div><InfoSeal info={question.infoSeal} /></div></CardHeader>
                    <CardContent className="space-y-4">
                        {question.alternatives && question.alternatives.length > 0 && <div className="flex flex-wrap gap-2">{question.alternatives.map((alternative, index) => <Button key={index} type="button" variant="outline" size="sm" onClick={() => setAnswers((current) => ({ ...current, [question.fieldKey]: valueToText(alternative.value) }))}>{valueToText(alternative.value)}</Button>)}</div>}
                        <Textarea rows={question.fieldKey === "faqs" ? 6 : 3} value={answers[question.fieldKey] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.fieldKey]: event.target.value }))} />
                        <div className="flex flex-wrap gap-2">
                            {question.suggestedValue !== null && question.suggestedValue !== undefined && question.reason !== "not_found" && <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ fieldKey: question.fieldKey, value: question.suggestedValue, action: "confirm" })}><Check className="mr-2 h-4 w-4" />Confirmar sugerencia</Button>}
                            <Button disabled={mutation.isPending || !answers[question.fieldKey]?.trim()} onClick={() => mutation.mutate({ fieldKey: question.fieldKey, value: editorValue(question.suggestedValue, answers[question.fieldKey]), action: "correct" })}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar respuesta</Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const emptyMetric = (): MoneyMetricV1 => ({ currency: "USD", mode: "single", value: null, min: null, max: null });
const emptyInternal = (): InternalBusinessDataV1 => ({ averageTicket: emptyMetric(), ltv: emptyMetric(), cac: emptyMetric(), businessModels: [], otherBusinessModel: "" });

const MoneyCard = ({ label, info, value, error, onChange }: { label: string; info: InfoSealV1; value: MoneyMetricV1; error?: string; onChange: (value: MoneyMetricV1) => void }) => (
    <Card>
        <CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-lg">{label}</CardTitle><CardDescription>Obligatorio</CardDescription></div><InfoSeal info={info} /></div></CardHeader>
        <CardContent className="space-y-4">
            <div className="grid grid-cols-[120px_1fr] gap-3">
                <Select value={value.currency} onValueChange={(currency) => onChange({ ...value, currency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "COP", "MXN", "PEN", "CLP", "ARS", "BRL"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select>
                <Select value={value.mode} onValueChange={(mode: "single" | "range") => onChange({ ...value, mode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Valor único</SelectItem><SelectItem value="range">Rango</SelectItem></SelectContent></Select>
            </div>
            {value.mode === "single" ? <Input type="number" min="0" step="0.01" placeholder="Valor estimado" value={value.value ?? ""} onChange={(event) => onChange({ ...value, value: event.target.value === "" ? null : Number(event.target.value) })} /> : <div className="grid grid-cols-2 gap-3"><Input type="number" min="0" step="0.01" placeholder="Mínimo" value={value.min ?? ""} onChange={(event) => onChange({ ...value, min: event.target.value === "" ? null : Number(event.target.value) })} /><Input type="number" min="0" step="0.01" placeholder="Máximo" value={value.max ?? ""} onChange={(event) => onChange({ ...value, max: event.target.value === "" ? null : Number(event.target.value) })} /></div>}
            {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
    </Card>
);

const InternalStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: () => void }) => {
    const queryClient = useQueryClient();
    const [data, setData] = useState<InternalBusinessDataV1>(project.internalData || emptyInternal());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveInternalData(project.id, data),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Datos internos guardados");
            onSaved();
        },
        onError: (error) => toast.error(error.message),
    });
    const submit = () => {
        const nextErrors = validateInternalBusinessData(data);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) mutation.mutate();
    };
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Datos internos obligatorios</h2><p className="mt-1 text-muted-foreground">Estos datos no se consideran confiables por scraping y deben ser ingresados por el negocio.</p></div>
            <div className="grid gap-4 lg:grid-cols-2">
                <MoneyCard label="Ticket promedio" info={INTERNAL_INFO_SEALS.averageTicket} value={data.averageTicket} error={errors.averageTicket} onChange={(averageTicket) => setData((current) => ({ ...current, averageTicket }))} />
                <MoneyCard label="LTV del cliente" info={INTERNAL_INFO_SEALS.ltv} value={data.ltv} error={errors.ltv} onChange={(ltv) => setData((current) => ({ ...current, ltv }))} />
                <MoneyCard label="CAC del negocio" info={INTERNAL_INFO_SEALS.cac} value={data.cac} error={errors.cac} onChange={(cac) => setData((current) => ({ ...current, cac }))} />
                <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-lg">Modelo de negocio</CardTitle><CardDescription>Obligatorio, selección múltiple</CardDescription></div><InfoSeal info={INTERNAL_INFO_SEALS.businessModels} /></div></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2">{BUSINESS_MODEL_OPTIONS.map((model) => <label key={model} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm"><Checkbox checked={data.businessModels.includes(model)} onCheckedChange={(checked) => setData((current) => ({ ...current, businessModels: checked ? [...current.businessModels, model] : current.businessModels.filter((item) => item !== model) }))} /><span>{model}</span></label>)}</div>{data.businessModels.includes("Otro") && <Input placeholder="Describe el otro modelo" value={data.otherBusinessModel || ""} onChange={(event) => setData((current) => ({ ...current, otherBusinessModel: event.target.value }))} />}{(errors.businessModels || errors.otherBusinessModel) && <p className="text-sm text-destructive">{errors.businessModels || errors.otherBusinessModel}</p>}</CardContent></Card>
            </div>
            <div className="flex justify-end"><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar y revisar cierre</Button></div>
        </div>
    );
};

const metricText = (metric: MoneyMetricV1) => metric.mode === "single" ? `${metric.currency} ${metric.value}` : `${metric.currency} ${metric.min} - ${metric.max}`;

const SummaryStep = ({ project }: { project: OnboardingBreProjectV1 }) => {
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.finalizeBaseContext(project.id),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            toast.success("Contexto base completado");
        },
        onError: (error) => toast.error(error.message),
    });
    if (project.status === "base_context_complete") return (
        <div className="mx-auto max-w-3xl text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-9 w-9" /></div><h2 className="mt-5 text-3xl font-bold">Contexto base completo</h2><p className="mt-3 text-muted-foreground">Se generó <code>BaseBusinessContextCompletedV1</code>. Este alcance termina aquí, antes de seleccionar citas o reuniones.</p><Card className="mt-8 text-left"><CardContent className="grid gap-4 pt-6 sm:grid-cols-3"><div><p className="text-2xl font-bold">{project.sources.length}</p><p className="text-sm text-muted-foreground">Fuentes registradas</p></div><div><p className="text-2xl font-bold">{project.contextFields.length}</p><p className="text-sm text-muted-foreground">Campos de contexto</p></div><div><p className="text-2xl font-bold">{project.contextFields.filter((field) => field.status === "corrected").length}</p><p className="text-sm text-muted-foreground">Campos corregidos</p></div></CardContent></Card></div>
    );
    const ready = canFinalizeBaseContext(project.contextFields, project.internalData);
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Resumen y cierre</h2><p className="mt-1 text-muted-foreground">Confirma el contexto base. Esta acción no configura todavía objetivos, sedes, agenda ni reuniones.</p></div>
            <div className="grid gap-4 lg:grid-cols-3">
                <Card><CardHeader><CardTitle className="text-lg">Fuentes</CardTitle></CardHeader><CardContent className="space-y-2">{project.sources.map((source) => <div key={source.id || source.url} className="flex items-center justify-between gap-2 text-sm"><span className="truncate capitalize">{source.type}</span><Badge variant={source.status === "completed" ? "default" : "secondary"}>{STATUS_LABELS[source.status]}</Badge></div>)}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-lg">Contexto</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{project.contextFields.length} campos normalizados</p><p>{project.contextFields.filter((field) => field.status === "confirmed").length} confirmados</p><p>{project.contextFields.filter((field) => field.status === "corrected").length} corregidos</p><p>{project.contextFields.reduce((sum, field) => sum + field.evidence.length, 0)} evidencias conservadas</p></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-lg">Datos internos</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{project.internalData ? <><p>Ticket: {metricText(project.internalData.averageTicket)}</p><p>LTV: {metricText(project.internalData.ltv)}</p><p>CAC: {metricText(project.internalData.cac)}</p><p>{project.internalData.businessModels.join(", ")}</p></> : <p className="text-destructive">Pendientes</p>}</CardContent></Card>
            </div>
            {!ready && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se puede finalizar todavía</AlertTitle><AlertDescription>Resuelve todas las preguntas dinámicas y completa ticket, LTV, CAC y modelo de negocio.</AlertDescription></Alert>}
            <div className="flex justify-end"><Button size="lg" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Confirmar contexto base</Button></div>
        </div>
    );
};

const ProjectWizard = ({ projectId }: { projectId: string }) => {
    const [stage, setStage] = useState<WizardStage>("sources");
    const projectQuery = useQuery({
        queryKey: projectKey(projectId),
        queryFn: () => onboardingBreApiClient.getProject(projectId),
        refetchInterval: (query) => query.state.data?.status === "scraping" ? 2500 : false,
    });
    const project = projectQuery.data;
    useEffect(() => {
        if (!project) return;
        if (project.status === "base_context_complete") setStage("summary");
        else if (project.status === "scraping") setStage("processing");
        else if (project.currentStep === "internal" && (stage === "sources" || stage === "processing")) setStage("internal");
        else if (project.currentStep === "gaps" && (stage === "sources" || stage === "processing")) setStage("gaps");
        else if (project.contextFields.length > 0 && (stage === "sources" || stage === "processing")) setStage("context");
    }, [project?.id, project?.status, project?.currentStep, project?.contextFields.length]);

    if (projectQuery.isLoading) return <AppShell><div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Cargando onboarding...</div></AppShell>;
    if (projectQuery.error || !project) return <AppShell><Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se pudo abrir el proyecto</AlertTitle><AlertDescription>{projectQuery.error?.message || "Proyecto no encontrado"}</AlertDescription></Alert></AppShell>;

    return (
        <AppShell projectName={project.name}>
            <div className="mb-5 flex items-center justify-between gap-3"><Button variant="ghost" asChild><Link to="/onboarding-bre"><ArrowLeft className="mr-2 h-4 w-4" />Volver</Link></Button><Badge variant={project.status === "base_context_complete" ? "default" : "secondary"}>{STATUS_LABELS[project.status]}</Badge></div>
            <WizardProgress stage={stage} />
            {stage === "sources" && <SourcesStep project={project} onStarted={() => setStage("processing")} />}
            {stage === "processing" && <ProcessingStep project={project} onBack={() => setStage("sources")} />}
            {stage === "context" && <ContextStep project={project} onContinue={() => setStage(project.dynamicQuestions.length ? "gaps" : "internal")} />}
            {stage === "gaps" && <GapsStep project={project} onContinue={() => setStage("internal")} />}
            {stage === "internal" && <InternalStep project={project} onSaved={() => setStage("summary")} />}
            {stage === "summary" && <SummaryStep project={project} />}
        </AppShell>
    );
};

export const OnboardingBreRoute = () => {
    const { projectId } = useParams();
    const { role } = useAuth();
    if (role === "operator") return (
        <AppShell>
            <div className="mx-auto max-w-xl py-16"><Alert variant="destructive"><ShieldCheck className="h-4 w-4" /><AlertTitle>Acceso restringido</AlertTitle><AlertDescription>El rol operator no puede acceder al onboarding BRE.</AlertDescription></Alert></div>
        </AppShell>
    );
    return projectId ? <ProjectWizard projectId={projectId} /> : <ProjectList />;
};
