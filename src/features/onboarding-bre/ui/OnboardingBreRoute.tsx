import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    AlertCircle,
    ArrowLeft,
    Bot,
    CalendarDays,
    Check,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    ExternalLink,
    FileText,
    Globe2,
    Loader2,
    LogOut,
    MapPin,
    Plus,
    RefreshCw,
    Save,
    ShieldCheck,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
    BreAgendaConfigV1,
    BreLeadCaptureFieldV1,
    BreLocationV1,
    BreOperationalObjective,
    BreStylePreferenceV1,
    BreSourceType,
    ContextFieldV1,
    InfoSealV1,
    InternalBusinessDataV1,
    MoneyMetricV1,
    OnboardingBreProjectV1,
    DynamicQuestionV1,
} from "../domain/types";
import { DYNAMIC_CONTEXT_FIELD_KEYS } from "../domain/types";
import { onboardingBreApiClient } from "../infrastructure/OnboardingBreApiClient";
import {
    BUSINESS_MODEL_OPTIONS,
    CONTEXT_FIELD_LABELS,
    DEFAULT_LEAD_FIELDS,
    DYNAMIC_FIELD_PLACEHOLDERS,
    EMOJI_MODE_OPTIONS,
    INTERNAL_INFO_SEALS,
    OBJECTIVE_OPTIONS,
    OPERATIONAL_INFO_SEALS,
    WEEKDAY_LABELS,
    areProvidedSourcesReady,
    buildSuggestedLocationsFromContext,
    emptyAgendaConfig,
    emptyLocation,
    formatWeeklyHours,
    hydrateLocationForEditor,
    inferIanaTimezoneFromContext,
    normalizeLeadCaptureFieldLabel,
    normalizeLeadCaptureFieldsForUi,
    validateAgendaConfig,
    validateInternalBusinessData,
    validateLeadCaptureFields,
    validateLocations,
    validateStylePreference,
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

const SOURCE_TYPE_LABELS: Record<string, string> = {
    website: "Sitio web",
    landing_page: "Landing page",
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    linkedin: "LinkedIn",
    youtube: "YouTube",
    google_maps: "Google Maps",
    other: "Otra fuente",
};

const STATUS_LABELS: Record<string, string> = {
    draft: "Borrador",
    sources_ready: "Fuentes listas",
    scraping: "Procesando",
    review_context: "Revisar contexto",
    collecting_answers: "Completando información",
    base_context_complete: "Contexto base completo",
    objective_selected: "Objetivo seleccionado",
    locations_configured: "Sedes configuradas",
    agenda_configured: "Agenda configurada",
    lead_fields_configured: "Datos del lead configurados",
    style_configured: "Estilo configurado",
    generating_bot: "Generando bot",
    ready_for_technical_review: "Listo para revisión técnica",
    pending: "Pendiente",
    queued: "En cola",
    processing: "Procesando",
    completed: "Completada",
    partial: "Parcial",
    platform_blocked: "Plataforma bloqueada",
    failed: "Fallida",
};

const OPTIONAL_SOURCE_RETRY_LIMIT = 3;

const ORIGIN_LABELS: Record<string, string> = {
    extracted: "Fuente pública",
    inferred: "Inferencia IA",
    user: "Usuario",
};

const CONFIDENCE_LABELS: Record<string, string> = {
    high: "Alta",
    medium: "Media",
    low: "Baja",
};

const FIELD_STATUS_LABELS: Record<string, string> = {
    extracted: "Detectado",
    inferred: "Hipótesis",
    not_found: "No encontrado",
    pending_validation: "Pendiente de validar",
    confirmed: "Confirmado",
    corrected: "Corregido",
};

const fieldLabel = (key: string) => key
    ? CONTEXT_FIELD_LABELS[key] || key
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "";

const sourceTypeLabel = (type?: string | null) => type ? SOURCE_TYPE_LABELS[type] || fieldLabel(type) : "Fuente";

const toSpanishError = (message?: string | null) => {
    const value = String(message || "").trim();
    if (!value) return "No se pudo completar la acción.";
    const lower = value.toLowerCase();
    const httpMatch = value.match(/HTTP\s+(\d+)/i);
    if (lower.includes("tiktok did not expose public profile metadata")
        || lower.includes("tiktok public profile metadata is incomplete")
        || lower.includes("tiktok no expuso datos públicos")) {
        return "TikTok no expuso datos públicos utilizables. El perfil existe, pero no tiene biografía, videos o contenido adicional disponible para extraer.";
    }
    if (lower.includes("no expuso datos públicos utilizables")) {
        return value;
    }
    if (lower.includes("this account does not have any videos posted")) {
        return "La cuenta existe, pero no tiene videos públicos para extraer.";
    }
    if (lower.includes("linkedin blocked automated public extraction")) {
        return "LinkedIn bloqueó la extracción pública automatizada. La fuente queda registrada como no disponible públicamente.";
    }
    if (lower.includes("platform requires authentication") || lower.includes("requires authentication")) {
        return "La plataforma requiere inicio de sesión para mostrar esa información pública.";
    }
    if (lower.includes("blocked public extraction")) {
        return "La plataforma bloqueó la extracción pública automatizada.";
    }
    if (lower.includes("public page did not expose readable content")) {
        return "La fuente pública existe o fue proporcionada, pero no expuso contenido legible para extraer. Se acepta como fuente parcial si no es el sitio web obligatorio.";
    }
    if (lower.includes("website did not expose crawlable public content")) {
        return "El sitio web no expuso contenido público rastreable.";
    }
    if (lower.includes("website crawler failed")) {
        return "El rastreador del sitio web no pudo completar el análisis.";
    }
    if (lower.includes("only http and https urls are allowed")) {
        return "Solo se permiten URLs con HTTP o HTTPS.";
    }
    if (lower.includes("local or metadata hosts are not allowed")) {
        return "No se permiten direcciones locales, privadas o de metadata cloud.";
    }
    if (httpMatch) {
        return `La fuente devolvió HTTP ${httpMatch[1]}; no se pudo extraer contenido público utilizable.`;
    }
    if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
        return "No se pudo conectar con el servicio. Revisa la conexión e intenta nuevamente.";
    }
    return value;
};

const sourceProgressMessage = (source: { status?: string; errorMessage?: string | null; pagesProcessed?: number | null; sourceType?: string; type?: string; retryLimitReached?: boolean }) => {
    if (source.retryLimitReached) return `Se agotaron los ${OPTIONAL_SOURCE_RETRY_LIMIT} reintentos. Esta fuente complementaria ya no se usará y no bloqueará el avance.`;
    if (source.errorMessage) return toSpanishError(source.errorMessage);
    if (source.status === "partial") return `${sourceTypeLabel(source.sourceType || source.type)} existe, pero no expuso más datos públicos útiles. Se acepta como fuente parcial.`;
    return `${source.pagesProcessed || 0} páginas`;
};

const sourceStatusLabel = (source: { status?: string; retryLimitReached?: boolean }) =>
    source.retryLimitReached ? `Omitida tras ${OPTIONAL_SOURCE_RETRY_LIMIT} reintentos` : (STATUS_LABELS[source.status || ""] || source.status || "Pendiente");

const sourceBadgeVariant = (source: { status?: string; retryLimitReached?: boolean }) => {
    if (source.retryLimitReached) return "secondary" as const;
    if (["completed"].includes(source.status || "")) return "default" as const;
    if (["failed", "platform_blocked"].includes(source.status || "")) return "destructive" as const;
    return "secondary" as const;
};

const questionInputPlaceholder = (question: DynamicQuestionV1) => {
    if (question.fieldKey === "faqs") return "Escribe aquí entre 3 y 20 preguntas frecuentes con su respuesta. Si tienes más contexto útil, aprovecha y agrega varias...";
    if (question.fieldKey === "country") return "Escribe aquí el país principal...";
    return "Escribe aquí la respuesta real del negocio...";
};

const questionFormatHelp = (question: DynamicQuestionV1) => DYNAMIC_FIELD_PLACEHOLDERS[question.fieldKey];

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

type AiBrainFilterPreview = {
    rule_key: string;
    question: string;
    gate_type: "blocking" | "non_blocking";
    placement: string;
    reason: string;
};

type PromptTemplatePreview = {
    name: string;
    content: string;
    group: "universal" | "objective" | "faq" | "other";
};

const normalizeText = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const getProjectContextText = (project: OnboardingBreProjectV1, key: string) => valueToText(project.contextFields.find((field) => field.key === key)?.value).trim();

const isEcuadorProject = (project: OnboardingBreProjectV1) => normalizeText(getProjectContextText(project, "country")).includes("ecuador");

type DataProtectionUiRecommendation = {
    key: string;
    countryLabel: string;
    lawName: string;
    sourceUrl: string;
    legalText: string;
    aliases: string[];
};

const DATA_PROTECTION_UI_RECOMMENDATIONS: DataProtectionUiRecommendation[] = [
    {
        key: "ecuador",
        countryLabel: "Ecuador",
        lawName: "Ley Orgánica de Protección de Datos Personales (LOPDP)",
        sourceUrl: "https://www.finanzaspopulares.gob.ec/wp-content/uploads/2021/07/ley_organica_de_proteccion_de_datos_personales.pdf",
        aliases: ["ecuador", "quito", "guayaquil", "cuenca"],
        legalText: "¡Recuerde! Al registrar sus datos, está aceptando que sean tratados conforme a la Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador. Puede solicitar el acceso, corrección o eliminación de sus datos en cualquier momento.",
    },
    {
        key: "spain",
        countryLabel: "España",
        lawName: "RGPD/GDPR y Ley Orgánica 3/2018 (LOPDGDD)",
        sourceUrl: "https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673",
        aliases: ["espana", "españa", "madrid", "barcelona", "valencia", "sevilla"],
        legalText: "Al facilitar sus datos, autoriza que sean tratados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Reglamento General de Protección de Datos (RGPD) y la Ley Orgánica 3/2018 de España. Puede solicitar acceso, rectificación, supresión, oposición, limitación o portabilidad de sus datos por los canales oficiales del negocio.",
    },
    {
        key: "european_union",
        countryLabel: "Unión Europea / Espacio Económico Europeo",
        lawName: "Reglamento General de Protección de Datos (GDPR/RGPD)",
        sourceUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
        aliases: [
            "union europea", "unión europea", "european union", "europa", "eea", "espacio economico europeo", "espacio económico europeo",
            "alemania", "berlin", "francia", "paris", "italia", "roma", "portugal", "lisboa", "paises bajos", "países bajos", "holanda", "amsterdam",
            "belgica", "bélgica", "bruselas", "irlanda", "dublin", "dublín", "polonia", "varsovia", "suecia", "estocolmo", "dinamarca", "copenhague",
            "finlandia", "helsinki", "austria", "viena", "grecia", "atenas", "chequia", "republica checa", "república checa", "praga", "hungria", "hungría",
            "budapest", "rumania", "bucarest", "bulgaria", "sofia", "croacia", "zagreb", "eslovenia", "liubliana", "eslovaquia", "bratislava",
            "estonia", "tallin", "tallinn", "letonia", "riga", "lituania", "vilna", "luxemburgo", "malta", "chipre", "nicosia",
            "noruega", "oslo", "islandia", "reikiavik", "reykjavik", "liechtenstein", "vaduz",
        ],
        legalText: "Al facilitar sus datos, autoriza que sean tratados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Reglamento General de Protección de Datos (GDPR/RGPD). Puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad por los canales oficiales del negocio.",
    },
    {
        key: "united_kingdom",
        countryLabel: "Reino Unido",
        lawName: "UK GDPR y Data Protection Act 2018",
        sourceUrl: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/",
        aliases: ["reino unido", "united kingdom", "uk", "londres", "london", "england"],
        legalText: "Al facilitar sus datos, autoriza que sean tratados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al UK GDPR y la Data Protection Act 2018. Puede solicitar acceso, rectificación, eliminación, oposición o limitación del tratamiento por los canales oficiales del negocio.",
    },
    {
        key: "california",
        countryLabel: "California, Estados Unidos",
        lawName: "California Consumer Privacy Act (CCPA) y California Privacy Rights Act (CPRA)",
        sourceUrl: "https://oag.ca.gov/privacy/ccpa",
        aliases: ["california", "los angeles", "san francisco", "san diego"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la CCPA/CPRA de California cuando aplique. Puede solicitar acceso, corrección, eliminación u optar por limitar ciertos usos de su información personal por los canales oficiales del negocio.",
    },
    {
        key: "virginia",
        countryLabel: "Virginia, Estados Unidos",
        lawName: "Virginia Consumer Data Protection Act (VCDPA)",
        sourceUrl: "https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/",
        aliases: ["virginia", "richmond", "virginia beach"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Virginia Consumer Data Protection Act (VCDPA) cuando aplique. Puede solicitar acceso, corrección, eliminación, portabilidad u oposición a ciertos tratamientos por los canales oficiales del negocio.",
    },
    {
        key: "colorado",
        countryLabel: "Colorado, Estados Unidos",
        lawName: "Colorado Privacy Act (CPA)",
        sourceUrl: "https://coag.gov/resources/colorado-privacy-act/",
        aliases: ["colorado", "denver", "boulder", "colorado springs"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Colorado Privacy Act (CPA) cuando aplique. Puede solicitar acceso, corrección, eliminación, portabilidad u oposición a ciertos tratamientos por los canales oficiales del negocio.",
    },
    {
        key: "connecticut",
        countryLabel: "Connecticut, Estados Unidos",
        lawName: "Connecticut Data Privacy Act (CTDPA)",
        sourceUrl: "https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act",
        aliases: ["connecticut", "hartford", "new haven", "stamford"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Connecticut Data Privacy Act (CTDPA) cuando aplique. Puede solicitar acceso, corrección, eliminación, portabilidad u oposición a ciertos tratamientos por los canales oficiales del negocio.",
    },
    {
        key: "utah",
        countryLabel: "Utah, Estados Unidos",
        lawName: "Utah Consumer Privacy Act (UCPA)",
        sourceUrl: "https://le.utah.gov/xcode/Title13/Chapter61/13-61.html",
        aliases: ["utah", "salt lake city", "provo"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Utah Consumer Privacy Act (UCPA) cuando aplique. Puede solicitar acceso, eliminación, portabilidad u oposición a ciertos usos de su información por los canales oficiales del negocio.",
    },
    {
        key: "texas",
        countryLabel: "Texas, Estados Unidos",
        lawName: "Texas Data Privacy and Security Act (TDPSA)",
        sourceUrl: "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm",
        aliases: ["texas", "houston", "dallas", "austin", "san antonio"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Texas Data Privacy and Security Act (TDPSA) cuando aplique. Puede solicitar acceso, corrección, eliminación, portabilidad u oposición a ciertos tratamientos por los canales oficiales del negocio.",
    },
    {
        key: "oregon",
        countryLabel: "Oregon, Estados Unidos",
        lawName: "Oregon Consumer Privacy Act (OCPA)",
        sourceUrl: "https://www.doj.state.or.us/consumer-protection/sales-scams-fraud/consumer-privacy/",
        aliases: ["oregon", "portland", "salem", "eugene"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Oregon Consumer Privacy Act (OCPA) cuando aplique. Puede solicitar acceso, corrección, eliminación, portabilidad u oposición a ciertos tratamientos por los canales oficiales del negocio.",
    },
    {
        key: "united_states",
        countryLabel: "Estados Unidos",
        lawName: "Normativa de privacidad aplicable según estado y sector",
        sourceUrl: "https://www.ftc.gov/business-guidance/privacy-security",
        aliases: ["estados unidos", "usa", "united states", "miami", "new york", "nueva york", "florida", "texas"],
        legalText: "Al compartir sus datos, queda informado de que serán usados para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado conforme a la normativa de privacidad aplicable en su estado y sector. Puede solicitar acceso, corrección o eliminación de su información por los canales oficiales del negocio.",
    },
    {
        key: "quebec",
        countryLabel: "Quebec, Canadá",
        lawName: "Act respecting the protection of personal information in the private sector, modernizada por Law 25",
        sourceUrl: "https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1",
        aliases: ["quebec", "québec", "montreal", "montréal", "quebec city", "ciudad de quebec"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la normativa de protección de información personal del sector privado de Quebec, incluyendo las obligaciones modernizadas por Law 25 cuando aplique. Puede solicitar acceso, rectificación, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "canada",
        countryLabel: "Canadá",
        lawName: "Personal Information Protection and Electronic Documents Act (PIPEDA)",
        sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/P-8.6/",
        aliases: ["canada", "canadá", "toronto", "ottawa", "vancouver", "calgary", "alberta", "british columbia", "columbia britanica", "columbia británica"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a PIPEDA y la normativa provincial aplicable en Canadá cuando corresponda. Puede solicitar acceso, corrección o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "australia",
        countryLabel: "Australia",
        lawName: "Privacy Act 1988 y Australian Privacy Principles (APPs)",
        sourceUrl: "https://www.oaic.gov.au/privacy/privacy-legislation/the-privacy-act",
        aliases: ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Privacy Act 1988 y los Australian Privacy Principles cuando apliquen. Puede solicitar acceso o corrección de su información por los canales oficiales del negocio.",
    },
    {
        key: "new_zealand",
        countryLabel: "Nueva Zelanda",
        lawName: "Privacy Act 2020",
        sourceUrl: "https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html",
        aliases: ["nueva zelanda", "new zealand", "auckland", "wellington", "christchurch"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Privacy Act 2020 de Nueva Zelanda cuando aplique. Puede solicitar acceso o corrección de su información por los canales oficiales del negocio.",
    },
    {
        key: "switzerland",
        countryLabel: "Suiza",
        lawName: "Federal Act on Data Protection (FADP/nFADP)",
        sourceUrl: "https://www.edoeb.admin.ch/edoeb/en/home/datenschutz/grundlagen.html",
        aliases: ["suiza", "switzerland", "zurich", "zürich", "ginebra", "geneva", "bern", "berna", "basel"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Federal Act on Data Protection (FADP) de Suiza cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "colombia",
        countryLabel: "Colombia",
        lawName: "Ley Estatutaria 1581 de 2012",
        sourceUrl: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981",
        aliases: ["colombia", "bogota", "bogotá", "medellin", "medellín", "cali"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley 1581 de 2012 de Colombia. Puede conocer, actualizar, rectificar o solicitar la supresión de sus datos por los canales oficiales del negocio.",
    },
    {
        key: "mexico",
        countryLabel: "México",
        lawName: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP)",
        sourceUrl: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf",
        aliases: ["mexico", "méxico", "ciudad de mexico", "ciudad de méxico", "cdmx", "guadalajara", "monterrey"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares de México. Puede ejercer sus derechos ARCO por los canales oficiales del negocio.",
    },
    {
        key: "peru",
        countryLabel: "Perú",
        lawName: "Ley N.° 29733 de Protección de Datos Personales",
        sourceUrl: "https://www.gob.pe/institucion/minjus/informes-publicaciones/315948-ley-de-proteccion-de-datos-personales-y-su-reglamento",
        aliases: ["peru", "perú", "lima", "arequipa"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley N.° 29733 de Protección de Datos Personales de Perú. Puede solicitar acceso, rectificación, cancelación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "brazil",
        countryLabel: "Brasil",
        lawName: "Lei Geral de Proteção de Dados Pessoais (LGPD)",
        sourceUrl: "https://www.planalto.gov.br/ccivil_03.old/_ato2015-2018/2018/lei/l13709.htm",
        aliases: ["brasil", "brazil", "sao paulo", "são paulo", "rio de janeiro"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Lei Geral de Proteção de Dados Pessoais (LGPD) de Brasil. Puede solicitar confirmación, acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "argentina",
        countryLabel: "Argentina",
        lawName: "Ley 25.326 de Protección de los Datos Personales",
        sourceUrl: "https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790",
        aliases: ["argentina", "buenos aires", "cordoba", "córdoba"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley 25.326 de Protección de los Datos Personales de Argentina. Puede solicitar acceso, rectificación, actualización o supresión por los canales oficiales del negocio.",
    },
    {
        key: "chile",
        countryLabel: "Chile",
        lawName: "Ley 19.628 sobre Protección de la Vida Privada",
        sourceUrl: "https://www.bcn.cl/leychile/navegar?idNorma=141599",
        aliases: ["chile", "santiago", "santiago de chile"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la normativa chilena de protección de datos personales. Puede solicitar acceso, rectificación, cancelación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "uruguay",
        countryLabel: "Uruguay",
        lawName: "Ley N.° 18.331 de Protección de Datos Personales",
        sourceUrl: "https://www.impo.com.uy/bases/leyes/18331-2008",
        aliases: ["uruguay", "montevideo"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley N.° 18.331 de Protección de Datos Personales de Uruguay. Puede ejercer sus derechos de acceso, rectificación, actualización, inclusión o supresión por los canales oficiales del negocio.",
    },
    {
        key: "panama",
        countryLabel: "Panamá",
        lawName: "Ley 81 de 2019 sobre Protección de Datos Personales",
        sourceUrl: "https://www.antai.gob.pa/ley-81-de-2019/",
        aliases: ["panama", "panamá"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley 81 de 2019 sobre Protección de Datos Personales de Panamá. Puede solicitar acceso, rectificación, cancelación, oposición o portabilidad por los canales oficiales del negocio.",
    },
    {
        key: "costa_rica",
        countryLabel: "Costa Rica",
        lawName: "Ley N.° 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales",
        sourceUrl: "https://www.pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?nValor1=1&nValor2=70975",
        aliases: ["costa rica", "san jose", "san josé"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley N.° 8968 de Costa Rica. Puede solicitar acceso, rectificación, cancelación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "dominican_republic",
        countryLabel: "República Dominicana",
        lawName: "Ley 172-13 sobre Protección de Datos de Carácter Personal",
        sourceUrl: "https://www.indotel.gob.do/media/6200/ley-no-172-13.pdf",
        aliases: ["republica dominicana", "república dominicana", "santo domingo"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley 172-13 sobre Protección de Datos de Carácter Personal de República Dominicana. Puede solicitar acceso, rectificación, cancelación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "india",
        countryLabel: "India",
        lawName: "Digital Personal Data Protection Act, 2023 (DPDP Act)",
        sourceUrl: "https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf",
        aliases: ["india", "delhi", "new delhi", "nueva delhi", "mumbai", "bombay", "bangalore", "bengaluru", "hyderabad", "chennai"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Digital Personal Data Protection Act, 2023 de India cuando aplique. Puede solicitar acceso, corrección, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "singapore",
        countryLabel: "Singapur",
        lawName: "Personal Data Protection Act 2012 (PDPA)",
        sourceUrl: "https://www.pdpc.gov.sg/Overview-of-PDPA/The-Legislation/Personal-Data-Protection-Act",
        aliases: ["singapur", "singapore"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Personal Data Protection Act 2012 (PDPA) de Singapur cuando aplique. Puede solicitar acceso, corrección o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "malaysia",
        countryLabel: "Malasia",
        lawName: "Personal Data Protection Act 2010 (PDPA)",
        sourceUrl: "https://www.pdp.gov.my/",
        aliases: ["malasia", "malaysia", "kuala lumpur", "penang", "johor"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Personal Data Protection Act 2010 (PDPA) de Malasia cuando aplique. Puede solicitar acceso, corrección o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "thailand",
        countryLabel: "Tailandia",
        lawName: "Personal Data Protection Act B.E. 2562 (PDPA)",
        sourceUrl: "https://www.mdes.go.th/law/detail/5069-Personal-Data-Protection-Act-B-E--2562--2019-",
        aliases: ["tailandia", "thailand", "bangkok", "phuket", "chiang mai"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Personal Data Protection Act de Tailandia cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "indonesia",
        countryLabel: "Indonesia",
        lawName: "Personal Data Protection Law (Law No. 27 of 2022)",
        sourceUrl: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
        aliases: ["indonesia", "yakarta", "jakarta", "bali", "surabaya"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Personal Data Protection Law de Indonesia cuando aplique. Puede solicitar acceso, corrección, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "philippines",
        countryLabel: "Filipinas",
        lawName: "Data Privacy Act of 2012",
        sourceUrl: "https://privacy.gov.ph/data-privacy-act/",
        aliases: ["filipinas", "philippines", "manila", "cebu", "davao"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Data Privacy Act of 2012 de Filipinas cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "japan",
        countryLabel: "Japón",
        lawName: "Act on the Protection of Personal Information (APPI)",
        sourceUrl: "https://www.ppc.go.jp/en/legal/",
        aliases: ["japon", "japón", "japan", "tokio", "tokyo", "osaka", "kyoto", "yokohama"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Act on the Protection of Personal Information (APPI) de Japón cuando aplique. Puede solicitar divulgación, corrección, suspensión de uso o eliminación por los canales oficiales del negocio.",
    },
    {
        key: "south_korea",
        countryLabel: "Corea del Sur",
        lawName: "Personal Information Protection Act (PIPA)",
        sourceUrl: "https://www.pipc.go.kr/eng/user/ltn/lawInfo.do",
        aliases: ["corea del sur", "south korea", "korea", "seul", "seúl", "seoul", "busan", "incheon"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Personal Information Protection Act (PIPA) de Corea del Sur cuando aplique. Puede solicitar acceso, corrección, eliminación o suspensión del tratamiento por los canales oficiales del negocio.",
    },
    {
        key: "china",
        countryLabel: "China",
        lawName: "Personal Information Protection Law (PIPL)",
        sourceUrl: "https://www.gov.cn/xinwen/2021-08/20/content_5632486.htm",
        aliases: ["china", "beijing", "pekin", "pekín", "shanghai", "shenzhen", "guangzhou"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Personal Information Protection Law (PIPL) de China cuando aplique. Puede solicitar acceso, copia, corrección, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "hong_kong",
        countryLabel: "Hong Kong",
        lawName: "Personal Data (Privacy) Ordinance (PDPO)",
        sourceUrl: "https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html",
        aliases: ["hong kong", "hongkong"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Personal Data (Privacy) Ordinance (PDPO) de Hong Kong cuando aplique. Puede solicitar acceso o corrección de sus datos por los canales oficiales del negocio.",
    },
    {
        key: "taiwan",
        countryLabel: "Taiwán",
        lawName: "Personal Data Protection Act (PDPA)",
        sourceUrl: "https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=I0050021",
        aliases: ["taiwan", "taiwán", "taipei", "taichung", "kaohsiung"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Personal Data Protection Act de Taiwán cuando aplique. Puede solicitar consulta, copia, corrección, eliminación o suspensión del tratamiento por los canales oficiales del negocio.",
    },
    {
        key: "vietnam",
        countryLabel: "Vietnam",
        lawName: "Decree No. 13/2023/ND-CP on Personal Data Protection",
        sourceUrl: "https://vanban.chinhphu.vn/?pageid=27160&docid=207307",
        aliases: ["vietnam", "viet nam", "hanoi", "hanói", "ho chi minh", "saigon", "saigón"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al marco vietnamita de protección de datos personales, incluyendo el Decree No. 13/2023/ND-CP cuando aplique. Puede solicitar acceso, corrección, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "turkey",
        countryLabel: "Turquía",
        lawName: "Law No. 6698 on the Protection of Personal Data (KVKK)",
        sourceUrl: "https://www.kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law",
        aliases: ["turquia", "turquía", "turkey", "istanbul", "estambul", "ankara", "izmir"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Law No. 6698 on the Protection of Personal Data (KVKK) de Turquía cuando aplique. Puede solicitar información, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "israel",
        countryLabel: "Israel",
        lawName: "Protection of Privacy Law, 5741-1981",
        sourceUrl: "https://www.gov.il/en/departments/the_privacy_protection_authority/govil-landing-page",
        aliases: ["israel", "tel aviv", "jerusalem", "jerusalén", "haifa"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la normativa de protección de privacidad de Israel cuando aplique. Puede solicitar acceso, corrección o eliminación por los canales oficiales del negocio.",
    },
    {
        key: "united_arab_emirates",
        countryLabel: "Emiratos Árabes Unidos",
        lawName: "Federal Decree-Law No. 45 of 2021 on Personal Data Protection",
        sourceUrl: "https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws",
        aliases: ["emiratos arabes unidos", "emiratos árabes unidos", "uae", "dubai", "abu dhabi", "sharjah"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la normativa de protección de datos personales de Emiratos Árabes Unidos cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "saudi_arabia",
        countryLabel: "Arabia Saudita",
        lawName: "Personal Data Protection Law (PDPL)",
        sourceUrl: "https://sdaia.gov.sa/en/SDAIA/about/Files/Personal%20Data%20English%20V2-23April2023-%20Reviewed-.pdf",
        aliases: ["arabia saudita", "saudi arabia", "riyadh", "riad", "jeddah", "jedda"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Personal Data Protection Law (PDPL) de Arabia Saudita cuando aplique. Puede solicitar acceso, corrección, eliminación o retirar su consentimiento por los canales oficiales del negocio.",
    },
    {
        key: "qatar",
        countryLabel: "Qatar",
        lawName: "Law No. 13 of 2016 concerning Personal Data Privacy Protection",
        sourceUrl: "https://www.motc.gov.qa/en/documents/document/law-no-13-2016-personal-data-privacy-protection",
        aliases: ["qatar", "doha"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la normativa de privacidad de datos personales de Qatar cuando aplique. Puede solicitar acceso, corrección o eliminación por los canales oficiales del negocio.",
    },
    {
        key: "south_africa",
        countryLabel: "Sudáfrica",
        lawName: "Protection of Personal Information Act (POPIA)",
        sourceUrl: "https://www.justice.gov.za/inforeg/legal/InfoRegSA-act-2013-004.pdf",
        aliases: ["sudafrica", "sudáfrica", "south africa", "johannesburg", "cape town", "ciudad del cabo", "pretoria", "durban"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Protection of Personal Information Act (POPIA) de Sudáfrica cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "kenya",
        countryLabel: "Kenia",
        lawName: "Data Protection Act, 2019",
        sourceUrl: "https://www.odpc.go.ke/dpa-act/",
        aliases: ["kenia", "kenya", "nairobi", "mombasa"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Data Protection Act, 2019 de Kenia cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "nigeria",
        countryLabel: "Nigeria",
        lawName: "Nigeria Data Protection Act, 2023",
        sourceUrl: "https://ndpc.gov.ng/Files/Nigeria_Data_Protection_Act_2023.pdf",
        aliases: ["nigeria", "lagos", "abuja", "kano"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Nigeria Data Protection Act, 2023 cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "ghana",
        countryLabel: "Ghana",
        lawName: "Data Protection Act, 2012 (Act 843)",
        sourceUrl: "https://www.dataprotection.org.gh/",
        aliases: ["ghana", "accra", "kumasi"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Data Protection Act, 2012 de Ghana cuando aplique. Puede solicitar acceso, corrección o eliminación por los canales oficiales del negocio.",
    },
    {
        key: "morocco",
        countryLabel: "Marruecos",
        lawName: "Law No. 09-08 on the protection of individuals with regard to personal data processing",
        sourceUrl: "https://www.cndp.ma/",
        aliases: ["marruecos", "morocco", "casablanca", "rabat", "marrakech"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Law No. 09-08 de Marruecos cuando aplique. Puede solicitar acceso, rectificación, oposición o eliminación por los canales oficiales del negocio.",
    },
    {
        key: "jamaica",
        countryLabel: "Jamaica",
        lawName: "Data Protection Act, 2020",
        sourceUrl: "https://www.moj.gov.jm/laws/data-protection-act-2020",
        aliases: ["jamaica", "kingston", "montego bay"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme al Data Protection Act, 2020 de Jamaica cuando aplique. Puede solicitar acceso, corrección, eliminación u oposición por los canales oficiales del negocio.",
    },
];

const dataProtectionRecommendationForProject = (project: OnboardingBreProjectV1) => {
    const haystack = normalizeText([
        getProjectContextText(project, "country"),
        getProjectContextText(project, "applicable_legal_country"),
        getProjectContextText(project, "visible_cities"),
        getProjectContextText(project, "possible_locations"),
    ].filter(Boolean).join(" "));
    return DATA_PROTECTION_UI_RECOMMENDATIONS.find((item) =>
        item.aliases.some((alias) => haystack.includes(normalizeText(alias))),
    ) || null;
};

const singularLocationLabel = (locationTerm?: string | null) => {
    const normalized = normalizeText(locationTerm || "sede");
    if (normalized === "agencias") return "Agencia";
    if (normalized === "sucursales") return "Sucursal";
    if (normalized === "locales") return "Local";
    if (normalized === "oficinas") return "Oficina";
    if (normalized === "puntos de atencion") return "Punto de atención";
    return "Sede";
};

const CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 10] as const;
const MEETING_DURATION_OPTIONS = [15, 30, 60, 120] as const;

const promptBlock = (project: OnboardingBreProjectV1, key: string) => project.promptVersion?.blocks.find((block) => block.blockKey === key);

const metadataArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const metadataRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const groupedMetadataArray = (value: unknown, key: string) => metadataArray<string>(metadataRecord(value)[key]);
const isResponseTemplateName = (name: string) => /^PLANTILLA_[A-Z0-9_]+$/.test(String(name || "").trim());

const templateEntriesFromMetadata = (value: unknown, group: PromptTemplatePreview["group"]): PromptTemplatePreview[] => metadataArray<Record<string, unknown>>(value)
    .map((entry) => ({
        name: String(entry.name || "").trim(),
        content: String(entry.content || "").trim(),
        group,
    }))
    .filter((entry) => isResponseTemplateName(entry.name));

const uniqueTemplateNames = (items: Array<{ name: string }>) => Array.from(new Set(items.map((item) => item.name).filter(isResponseTemplateName)));

const matcherTemplateNames = (matcherConfig: Record<string, unknown>) => {
    const names = new Set<string>();
    Object.values(matcherConfig || {}).forEach((entries) => {
        metadataArray<Record<string, unknown>>(entries).forEach((entry) => {
            const template = String(entry.template || "").trim();
            if (isResponseTemplateName(template)) names.add(template);
        });
    });
    return Array.from(names);
};

const defaultBrainFilters = (project: OnboardingBreProjectV1): AiBrainFilterPreview[] => {
    const isAppointments = project.operationalObjective?.objective !== "meetings";
    return isAppointments ? [
        {
            rule_key: "welcome_intent",
            question: "Detectar preguntas directas, interes comercial, ubicaciones, horarios o intencion de agendar.",
            gate_type: "non_blocking",
            placement: "welcome",
            reason: "Responde dudas sin perder el flujo hacia la cita.",
        },
        {
            rule_key: "location_required",
            question: "No confirmar cita sin sede, agencia o sucursal elegida.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La cita presencial necesita lugar real de atencion.",
        },
        {
            rule_key: "location_business_hours",
            question: "Validar fecha y hora contra horario semanal de la sede.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "Evita citas fuera de atencion o en dias no laborables.",
        },
        {
            rule_key: "lead_required_fields",
            question: "Validar datos obligatorios definidos para el lead.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "Evita confirmar sin datos minimos de seguimiento.",
        },
    ] : [
        {
            rule_key: "qualification_filters",
            question: "Completar producto, necesidad, volumen o frecuencia y rango de inversion antes de agendar.",
            gate_type: "blocking",
            placement: "after_welcome",
            reason: "La reunion debe llegar con contexto comercial util.",
        },
        {
            rule_key: "data_consent_required",
            question: "Pedir consentimiento antes de solicitar nombre, correo o telefono.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "Protege la captura de datos personales.",
        },
        {
            rule_key: "meeting_availability",
            question: "Validar fecha pasada, no hoy, dia habil, hora exacta, horario permitido y conflicto de agenda.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La disponibilidad debe ser deterministica.",
        },
    ];
};

const buildAiBrainReview = (project: OnboardingBreProjectV1) => {
    const isAppointments = project.operationalObjective?.objective !== "meetings";
    const country = getProjectContextText(project, "country") || "No definido";
    const filterMetadata = promptBlock(project, "filters_block")?.metadata;
    const templateMetadata = promptBlock(project, "templates_block")?.metadata;
    const variableMetadata = promptBlock(project, "variables_block")?.metadata;
    const lopdpMetadata = promptBlock(project, "lopdp_block")?.metadata;
    const objectiveMetadata = promptBlock(project, "objective_config")?.metadata;
    const decisionSummary = metadataRecord((objectiveMetadata as Record<string, unknown> | undefined)?.decisionSummary);
    const aiBrainDecisionNotes = metadataArray<string>((objectiveMetadata as Record<string, unknown> | undefined)?.aiBrainDecisionNotes);
    const aiBrainRuntime = metadataRecord((objectiveMetadata as Record<string, unknown> | undefined)?.aiBrainRuntime);
    const filters = metadataArray<AiBrainFilterPreview>((filterMetadata as Record<string, unknown> | undefined)?.filters);
    const templateGroups = metadataRecord((templateMetadata as Record<string, unknown> | undefined)?.templateGroups);
    const templateEntries = metadataRecord((templateMetadata as Record<string, unknown> | undefined)?.templateEntries);
    const templateCounts = metadataRecord((templateMetadata as Record<string, unknown> | undefined)?.templateCounts);
    const variableGroups = metadataRecord((variableMetadata as Record<string, unknown> | undefined)?.variableGroups);
    const universalTemplates = groupedMetadataArray(templateGroups, "universal").length
        ? groupedMetadataArray(templateGroups, "universal")
        : metadataArray<string>((templateMetadata as Record<string, unknown> | undefined)?.universalTemplates);
    const objectiveTemplates = isAppointments
        ? groupedMetadataArray(templateGroups, "appointments")
        : groupedMetadataArray(templateGroups, "meetings");
    const fallbackObjectiveTemplates = metadataArray<string>((templateMetadata as Record<string, unknown> | undefined)?.objectiveTemplates);
    const universalVariables = groupedMetadataArray(variableGroups, "universal");
    const objectiveVariables = isAppointments
        ? groupedMetadataArray(variableGroups, "appointments")
        : groupedMetadataArray(variableGroups, "meetings");
    const variables = metadataArray<string>((variableMetadata as Record<string, unknown> | undefined)?.variables);
    const activeFilters = filters.length ? filters : defaultBrainFilters(project);
    const activeUniversalTemplates = universalTemplates.length ? universalTemplates : [
        "PLANTILLA_LOPDP",
        "PLANTILLA_NO_INTERES",
        "PLANTILLA_CLIENTE_INTERESADO",
        "PLANTILLA_AGRADECIMIENTO_UTIL",
        "PLANTILLA_AGRADECIMIENTO_LIMITADO",
        "PLANTILLA_LENGUAJE_OFENSIVO_CIERRE",
        "PLANTILLA_NO_AYUDA",
        "PLANTILLA_EQUIVOCACION_CHAT",
        "PLANTILLA_NO_APLICA",
        "PLANTILLA_CLIENTE_TIENE_DUDAS",
    ];
    const activeObjectiveTemplates = objectiveTemplates.length ? objectiveTemplates : fallbackObjectiveTemplates.length ? fallbackObjectiveTemplates : isAppointments
        ? [
            "PLANTILLA_BIENVENIDA",
            "PLANTILLA_BIENVENIDA_FALTAN_DATOS",
            "PLANTILLA_BIENVENIDA_CON_DATOS",
            "PLANTILLA_BIENVENIDA_SIN_DATOS",
            "PLANTILLA_INTERES_CON_CIUDAD",
            "PLANTILLA_INTERES_CON_AGENCIA",
            "PLANTILLA_CIUDADES",
            "PLANTILLA_SECTOR_MATCH_CIUDAD_DEDUCIDA",
            "PLANTILLA_UBICACION_DESCONOCIDA",
            "PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA",
            "PLANTILLA_CIUDAD_SIN_AGENCIA",
            "PLANTILLA_CIUDAD_SIN_AGENCIA_INSISTE",
            "PLANTILLA_UBICACIONES_SIN_CIUDAD",
            "PLANTILLA_UBICACIONES_CON_CIUDAD",
            "PLANTILLA_REFERENCIA_CERCANA_SIN_CIUDAD",
            "PLANTILLA_REFERENCIA_MATCH",
            "PLANTILLA_DATOS_CITA",
            "PLANTILLA_DATOS_INCOMPLETOS",
            "PLANTILLA_FECHA_PASADA",
            "PLANTILLA_NO_AGENDAR_HOY",
            "PLANTILLA_DIA_NO_HABIL",
            "PLANTILLA_HORA_INTERVALO",
            "PLANTILLA_HORA_FUERA_DE_ATENCION",
            "PLANTILLA_HORA_OCUPADA",
            "PLANTILLA_MIS_CITAS",
            "PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR",
            "PLANTILLA_SIN_CITAS",
            "PLANTILLA_NUMERO_OBLIGATORIO",
            "PLANTILLA_CANCELACION_CITA_ABORTADA",
            "PLANTILLA_CITA_CANCELADA",
            "PLANTILLA_VISITA_SIN_CITA",
            "PLANTILLA_CONFIRMACION",
        ]
        : [
            "PLANTILLA_BIENVENIDA",
            "PLANTILLA_BIENVENIDA_FALTAN_DATOS",
            "PLANTILLA_BIENVENIDA_CON_DATOS",
            "PLANTILLA_BIENVENIDA_SIN_DATOS",
            "PLANTILLA_PEDIR_UBICACION_REUNION",
            "PLANTILLA_FECHA_PASADA",
            "PLANTILLA_NO_AGENDAR_HOY",
            "PLANTILLA_DIA_NO_HABIL",
            "PLANTILLA_HORA_NO_EN_PUNTO",
            "PLANTILLA_HORA_FUERA_DE_ATENCION",
            "PLANTILLA_HORA_OCUPADA",
            "PLANTILLA_MOSTRAR_HORARIOS",
            "PLANTILLA_DATOS_REUNION",
            "PLANTILLA_DATOS_REUNION_INCOMPLETOS",
            "PLANTILLA_CONFIRMACION_REUNION",
            "PLANTILLA_CONSULTA_UNA_REUNION",
            "PLANTILLA_CONSULTA_VARIAS_REUNIONES",
            "PLANTILLA_CONSULTA_SIN_REUNIONES",
            "PLANTILLA_LISTADO_REUNIONES_PARA_CANCELAR",
            "PLANTILLA_NUMERO_OBLIGATORIO",
            "PLANTILLA_CANCELACION_ABORTADA",
        ];
    const fallbackUniversalVariables = isAppointments ? [
        "nombre",
        "apellido",
        "nombre_apellido",
        "telefono",
        "correo",
        "canal",
        "consentimiento_datos",
        "lopdp_enviado",
        "intencion_pendiente",
        "ultima_plantilla_enviada",
    ] : [
        "nombre",
        "apellido",
        "nombre_apellido",
        "correo",
        "telefono",
        "canal",
        "consentimiento_datos",
        "lopdp_enviado",
        "fecha_base_oficial",
        "hora_base_oficial",
        "zona_horaria",
    ];
    const activeUniversalVariables = universalVariables.length ? universalVariables : fallbackUniversalVariables;
    const activeObjectiveVariables = objectiveVariables.length ? objectiveVariables : isAppointments
        ? ["sede_confirmada", "ciudad_o_zona", "referencia_ubicacion", "appointment_timezone", "time_zone", "fecha_cita", "hora_cita", "fecha_cita_normalizada", "hora_cita_normalizada", "fecha_base_oficial", "hora_base_oficial", "CONDICION_CANAL_NO_WHATSAPP", "ORDEN_DATOS_POR_CANAL", "dia_semana", "horario_sede_texto", "CITAS_AGENDADAS", "LISTA_MIS_CITAS"]
        : ["business_timezone", "requester_timezone", "requester_city", "requester_region", "requester_country", "producto_interes", "necesidad_principal", "volumen_o_frecuencia", "rango_inversion", "lead_clasificacion", "fecha_reunion", "hora_reunion", "fecha_reunion_normalizada_usuario", "hora_reunion_normalizada_usuario", "fecha_reunion_normalizada", "hora_reunion_normalizada", "fecha_usuario", "hora_usuario", "fecha_negocio", "hora_negocio", "inicio_evento", "fin_evento", "descripcion_evento", "REUNIONES_AGENDADAS", "LISTA_MIS_REUNIONES_CONSULTA"];
    const activeVariables = variables.length ? variables : [...activeUniversalVariables, ...activeObjectiveVariables];
    const promptTemplateEntries = [
        ...templateEntriesFromMetadata(templateEntries.universal, "universal"),
        ...templateEntriesFromMetadata(templateEntries.objective, "objective"),
        ...templateEntriesFromMetadata(templateEntries.faqs, "faq"),
    ];
    const fallbackPromptTemplateEntries = [
        ...activeUniversalTemplates.map((name) => ({ name, content: "", group: "universal" as const })),
        ...activeObjectiveTemplates.map((name) => ({ name, content: "", group: "objective" as const })),
    ];
    const activePromptTemplateEntries = promptTemplateEntries.length ? promptTemplateEntries : fallbackPromptTemplateEntries;
    const activeMatcherTemplateNames = matcherTemplateNames(project.matcherVersion?.matcherConfig || {});
    const lopdpStatus = String((lopdpMetadata as Record<string, unknown> | undefined)?.status || (isEcuadorProject(project) ? "generated" : "pending_legal_review"));
    const locationReferences = project.locations.map((location) => ({
        locationName: location.name,
        address: location.address,
        aliases: location.references
            .filter((reference) => reference.referenceType === "alias")
            .map((reference) => reference.value),
        cities: location.references
            .filter((reference) => reference.referenceType === "city")
            .map((reference) => reference.value),
        sectors: location.references
            .filter((reference) => reference.referenceType === "sector")
            .map((reference) => reference.value),
        geoProfile: location.references
            .filter((reference) => reference.referenceType === "phrase")
            .map((reference) => reference.value),
    }));
    return {
        objectiveLabel: isAppointments ? "Citas agendadas" : "Reuniones agendadas",
        objectiveTemplateLabel: isAppointments ? "Plantillas universales para citas agendadas" : "Plantillas universales para reuniones agendadas",
        objectiveVariableLabel: isAppointments ? "Datos operativos para citas agendadas" : "Datos operativos para reuniones agendadas",
        country,
        filters: activeFilters.filter((filter) => filter.gate_type !== "blocking"),
        gates: activeFilters.filter((filter) => filter.gate_type === "blocking"),
        lopdpStatus,
        lopdpDecision: String((lopdpMetadata as Record<string, unknown> | undefined)?.decision || (isEcuadorProject(project)
            ? "Ecuador detectado: se genera texto LOPDP y se ubica antes de pedir datos personales o antes de confirmar si no se envio."
            : "Pais distinto de Ecuador: se requiere texto legal manual antes de generar la version candidata.")),
        universalTemplates: activeUniversalTemplates,
        objectiveTemplates: activeObjectiveTemplates,
        universalVariables: activeUniversalVariables,
        objectiveVariables: activeObjectiveVariables,
        variables: activeVariables,
        promptTemplateEntries: activePromptTemplateEntries,
        promptTemplateCount: Number(templateCounts.promptCandidate || uniqueTemplateNames(activePromptTemplateEntries).length || 0),
        matcherTemplateCount: Number(templateCounts.matcherDeterministic || activeMatcherTemplateNames.length || 0),
        matcherTemplateNames: activeMatcherTemplateNames,
        matcherLabels: project.matcherVersion?.labels || ["bienvenida", "solicita_informacion", "interesado", "desinteresado", "cita_agendada", "tiene_dudas"],
        locationReferences,
        compilerProfile: String(decisionSummary.compilerProfile || (isAppointments ? "Perfil de citas agendadas" : "Perfil de reuniones agendadas")),
        aiBrainContract: String(decisionSummary.aiBrainContract || "El AI Brain decide en estructura y el compilador construye el prompt final."),
        aiBrainDecisionNotes,
        aiBrainModel: String(aiBrainRuntime.model || "No registrado"),
        aiBrainMode: String(aiBrainRuntime.mode || "No registrado"),
        aiBrainFallback: Boolean(aiBrainRuntime.fallback),
    };
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
        onError: (error) => toast.error(toSpanishError(error.message)),
    });

    return (
        <AppShell>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section>
                    <div className="mb-5">
                        <h1 className="text-2xl font-bold tracking-tight">Proyectos BRE</h1>
                        <p className="mt-1 text-muted-foreground">Cada proyecto mantiene su extracción pública, evidencias y contexto completamente aislados.</p>
                    </div>
                    {projectsQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando proyectos...</div>
                    ) : projectsQuery.error ? (
                        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se pudieron cargar</AlertTitle><AlertDescription>{toSpanishError(projectsQuery.error.message)}</AlertDescription></Alert>
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
                                <Label>Administradores de empresa</Label>
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

type WizardStage =
    | "sources"
    | "processing"
    | "context"
    | "gaps"
    | "internal"
    | "objective"
    | "locations"
    | "agenda"
    | "lead_fields"
    | "style"
    | "generate"
    | "review";
const STAGES: Array<{ key: WizardStage; label: string; number: number }> = [
    { key: "sources", label: "Fuentes", number: 1 },
    { key: "processing", label: "Análisis", number: 2 },
    { key: "context", label: "Contexto", number: 3 },
    { key: "gaps", label: "Faltantes", number: 4 },
    { key: "internal", label: "Datos internos", number: 5 },
    { key: "objective", label: "Objetivo", number: 7 },
    { key: "locations", label: "Sedes", number: 8 },
    { key: "agenda", label: "Agenda", number: 9 },
    { key: "lead_fields", label: "Datos del lead", number: 10 },
    { key: "style", label: "Estilo", number: 11 },
    { key: "generate", label: "Generación", number: 12 },
    { key: "review", label: "Revisión", number: 13 },
];

const WizardProgress = ({
    stage,
    canVisitStage,
    onSelectStage,
}: {
    stage: WizardStage;
    canVisitStage?: (stage: WizardStage) => boolean;
    onSelectStage?: (stage: WizardStage) => void;
}) => {
    const active = STAGES.findIndex((item) => item.key === stage);
    return (
        <div className="mb-8 overflow-x-auto pb-2">
            <div className="flex min-w-[1320px] items-center">
                {STAGES.map((item, index) => {
                    const selectable = Boolean(canVisitStage?.(item.key));
                    const isActive = index === active;
                    const isCompleted = index < active;
                    const circleClass = isActive
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/15 shadow-sm"
                        : isCompleted
                            ? "bg-emerald-600 text-white"
                            : "bg-muted text-muted-foreground";
                    const labelClass = isActive
                        ? "font-semibold text-primary"
                        : isCompleted
                            ? "font-medium text-emerald-700"
                            : "text-muted-foreground";
                    return (
                        <div key={item.key} className="flex flex-1 items-center last:flex-none">
                            <button
                                type="button"
                                disabled={!selectable}
                                onClick={() => onSelectStage?.(item.key)}
                                className={`flex items-center gap-2 rounded-full text-left transition ${selectable ? "cursor-pointer hover:text-primary" : "cursor-default"}`}
                                title={selectable ? `Ir a ${item.label}` : undefined}
                            >
                                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${circleClass}`}>
                                    {isCompleted ? <Check className="h-4 w-4" /> : item.number}
                                </div>
                                <span className={`whitespace-nowrap text-sm transition ${labelClass}`}>{item.label}</span>
                            </button>
                            {index < STAGES.length - 1 && <div className={`mx-3 h-px flex-1 ${index < active ? "bg-emerald-500" : "bg-border"}`} />}
                        </div>
                    );
                })}
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
        onError: (error) => toast.error(toSpanishError(error.message)),
    });

    const discovered = project.sources.filter((source) => source.origin === "discovered");
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Fuentes públicas</h2>
                <p className="mt-1 text-muted-foreground">El sitio web es obligatorio. Las redes pueden omitirse; si registras una, debe producir evidencia pública útil o retirarse antes de continuar.</p>
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
                <Card><CardHeader><CardTitle className="text-lg">Fuentes descubiertas</CardTitle></CardHeader><CardContent className="space-y-2">{discovered.map((source) => <div key={source.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span className="truncate">{source.url}</span><Badge variant="secondary">{sourceTypeLabel(source.type)}</Badge></div>)}</CardContent></Card>
            )}
            <div className="flex justify-end">
                <Button size="lg" disabled={processMutation.isPending || !urls.website?.trim()} onClick={() => processMutation.mutate()}>
                    {processMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe2 className="mr-2 h-4 w-4" />}
                    Guardar e iniciar análisis
                </Button>
            </div>
        </div>
    );
};

const ProcessingStep = ({
    project,
    onBack,
    onContinue,
}: {
    project: OnboardingBreProjectV1;
    onBack: () => void;
    onContinue: () => void;
}) => {
    const queryClient = useQueryClient();
    const retryMutation = useMutation({
        mutationFn: (sourceId: string) => onboardingBreApiClient.retrySource(project.id, sourceId, crypto.randomUUID()),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKey(project.id) }),
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const run = project.latestRun;
    const progress = run?.sourcesTotal ? Math.round((run.sourcesCompleted / run.sourcesTotal) * 100) : 5;
    const website = project.sources.find((source) => source.type === "website");
    const websiteComplete = website?.status === "completed";
    const processing = project.status === "scraping";
    const progressBySource = new Map((run?.sourceProgress || []).map((source) => [source.sourceId, source]));
    const displaySources = project.sources.map((source) => ({
        ...source,
        sourceId: source.id,
        sourceType: source.type,
        ...(source.id ? progressBySource.get(source.id) : {}),
    }));
    const unresolvedProvidedSources = project.sources.filter((source) =>
        source.origin === "user"
        && ["failed", "platform_blocked"].includes(source.status)
        && !source.retryLimitReached
    );
    const canContinueToContext = !processing
        && websiteComplete
        && unresolvedProvidedSources.length === 0
        && project.contextFields.length > 0;
    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="text-center">
                {processing ? <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" /> : websiteComplete ? <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-600" /> : <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />}
                <h2 className="text-2xl font-bold">{processing ? "Construyendo el contexto del negocio" : websiteComplete ? "Fuentes públicas procesadas" : "El sitio web necesita atención"}</h2>
                <p className="mt-2 text-muted-foreground">Rastreo, extracción, deduplicación, evidencias y normalización con IA se ejecutan fuera del navegador.</p>
            </div>
            <Card><CardContent className="space-y-3 pt-6"><div className="flex justify-between text-sm"><span>{run?.pagesProcessed || 0} páginas procesadas</span><span>{progress}%</span></div><Progress value={progress} /></CardContent></Card>
            {!processing && project.contextFields.length > 0 && (
                <Alert><CircleHelp className="h-4 w-4" /><AlertTitle>Este paso muestra el análisis realizado</AlertTitle><AlertDescription>Las fuentes ya fueron procesadas y el contexto fue construido. Si quieres volver a analizar, regresa a Fuentes, ajusta los enlaces y ejecuta nuevamente el análisis.</AlertDescription></Alert>
            )}
            <div className="space-y-3">
                {displaySources.map((source: any) => (
                    <Card key={source.sourceId || source.id}>
                        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2"><p className="font-medium">{sourceTypeLabel(source.sourceType || source.type)}</p><Badge variant={sourceBadgeVariant(source)}>{sourceStatusLabel(source)}</Badge></div>
                                <p className="mt-1 truncate text-sm text-muted-foreground">{sourceProgressMessage(source)}</p>
                            </div>
                            {["failed", "platform_blocked", "partial"].includes(source.status) && source.sourceId && !source.retryLimitReached && (
                                <Button variant="outline" size="sm" disabled={retryMutation.isPending || project.status === "scraping"} onClick={() => retryMutation.mutate(source.sourceId)}><RefreshCw className="mr-2 h-4 w-4" />Reintentar</Button>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
            {website && ["failed", "platform_blocked", "partial"].includes(website.status) && (
                <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>El sitio web es obligatorio</AlertTitle><AlertDescription>Corrige la fuente o reintenta. El sitio oficial debe producir contenido público utilizable.</AlertDescription></Alert>
            )}
            {websiteComplete && unresolvedProvidedSources.length > 0 && (
                <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Hay fuentes proporcionadas sin evidencia</AlertTitle><AlertDescription>Reintenta estas fuentes o vuelve a Fuentes para retirarlas. El sistema no las marcará como procesadas ni avanzará inventando información.</AlertDescription></Alert>
            )}
            {websiteComplete && !processing && project.contextFields.length === 0 && (
                <Alert><Loader2 className="h-4 w-4 animate-spin" /><AlertTitle>Normalizando contexto</AlertTitle><AlertDescription>Las fuentes ya terminaron. Estamos generando el contexto estructurado; en unos segundos podrás revisar el paso 3.</AlertDescription></Alert>
            )}
            {canContinueToContext && (
                <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Contexto listo para revisar</AlertTitle><AlertDescription>Las fuentes ya fueron procesadas. Continúa al resumen editable de identidad, oferta, ICP, comunicación, FAQs, contactos y evidencias.</AlertDescription></Alert>
            )}
            {project.status !== "scraping" && (
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                    <Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Revisar fuentes</Button>
                    {canContinueToContext && <Button onClick={onContinue}>Continuar a contexto <ChevronRight className="ml-2 h-4 w-4" /></Button>}
                </div>
            )}
        </div>
    );
};

const ContextFieldCard = ({ projectId, field }: { projectId: string; field: ContextFieldV1 }) => {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(valueToText(field.value));
    useEffect(() => {
        setText(valueToText(field.value));
    }, [field.value]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveContextField(projectId, field.key, editorValue(field.value, text)),
        onSuccess: (project) => {
            queryClient.setQueryData(projectKey(projectId), project);
            setEditing(false);
            toast.success("Campo actualizado");
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const originLabel = ORIGIN_LABELS[field.origin] || field.origin || "No definido";
    const confidenceLabel = field.confidence ? CONFIDENCE_LABELS[field.confidence] || field.confidence : null;
    const statusLabel = FIELD_STATUS_LABELS[field.status] || field.status || "Pendiente";
    const statusVariant = field.status === "confirmed" || field.status === "corrected" ? "default" : "outline";
    return (
        <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="font-medium">{fieldLabel(field.key)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="gap-1"><span className="text-muted-foreground">Origen:</span> {originLabel}</Badge>
                        {confidenceLabel && <Badge variant="secondary" className="gap-1"><span className="text-muted-foreground">Confianza:</span> {confidenceLabel}</Badge>}
                        <Badge variant={statusVariant} className="gap-1"><span className={statusVariant === "default" ? "text-primary-foreground/80" : "text-muted-foreground"}>Estado:</span> {statusLabel}</Badge>
                    </div>
                </div>
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
    const optionalNotFound = project.contextFields.filter((field) => field.status === "not_found" && !field.requiredForBase).length;
    const grouped = useMemo(() => project.contextFields
        .filter((field) => field.status !== "not_found" || field.requiredForBase)
        .reduce<Record<string, ContextFieldV1[]>>((result, field) => {
        result[field.category] = [...(result[field.category] || []), field];
        return result;
    }, {}), [project.contextFields]);
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Contexto detectado</h2><p className="mt-1 text-muted-foreground">Revisa datos, inferencias y evidencias. Las ubicaciones y horarios son contexto, no configuración final.</p></div>
            <Alert>
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Cómo leer el contexto detectado</AlertTitle>
                <AlertDescription>
                    <span className="font-medium">Origen</span> indica de dónde salió el dato: fuente pública, inferencia de IA o corrección del usuario.{" "}
                    <span className="font-medium">Confianza</span> muestra qué tan sólido parece.{" "}
                    <span className="font-medium">Estado</span> indica si quedó confirmado, corregido, pendiente de validar o solo como hipótesis. Las inferencias nunca se confirman solas.
                </AlertDescription>
            </Alert>
            {optionalNotFound > 0 && <p className="text-sm text-muted-foreground">También se conservaron {optionalNotFound} campos opcionales como no encontrados; no se preguntarán solo por estar ausentes.</p>}
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
    const reviewedFields = project.contextFields.filter((field) => (DYNAMIC_CONTEXT_FIELD_KEYS as readonly string[]).includes(field.key));
    const mutation = useMutation({
        mutationFn: ({ fieldKey, value, action }: { fieldKey: any; value: unknown; action: "confirm" | "correct" }) => onboardingBreApiClient.saveContextAnswer({ projectId: project.id, fieldKey, value, action }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Respuesta guardada");
            if (updated.dynamicQuestions.length === 0) onContinue();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    if (project.dynamicQuestions.length === 0) return (
        <div className="space-y-6">
            <div>
                <div className="mb-3 flex items-center gap-3">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    <div>
                        <h2 className="text-2xl font-bold">Contexto público validado</h2>
                        <p className="mt-1 text-muted-foreground">No quedan campos faltantes, dudosos o contradictorios. Igual puedes revisar y corregir lo que ya se guardó.</p>
                    </div>
                </div>
                <Alert><CircleHelp className="h-4 w-4" /><AlertTitle>Modo revisión del paso 4</AlertTitle><AlertDescription>Estos campos ya fueron confirmados o corregidos. Si editas uno, quedará guardado como corrección del usuario y se mantendrá la trazabilidad.</AlertDescription></Alert>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
                {reviewedFields.map((field) => <ContextFieldCard key={field.key} projectId={project.id} field={field} />)}
            </div>
            <div className="flex justify-end"><Button size="lg" onClick={onContinue}>Continuar a datos internos <ChevronRight className="ml-2 h-4 w-4" /></Button></div>
        </div>
    );
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Completar y validar</h2><p className="mt-1 text-muted-foreground">Solo se muestran campos previstos que la extracción pública no pudo resolver de forma confiable.</p></div>
            <Alert><CircleHelp className="h-4 w-4" /><AlertTitle>Completa estos {project.dynamicQuestions.length} campo(s) para pasar a Datos internos</AlertTitle><AlertDescription>Escribe una respuesta real en cada campo pendiente y presiona Guardar respuesta. Los ejemplos aparecen debajo como guía, pero no se guardan automáticamente.</AlertDescription></Alert>
            {project.dynamicQuestions.map((question) => (
                <Card key={question.fieldKey}>
                    <CardHeader><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-lg">{question.label}</CardTitle><Badge variant="secondary">Pendiente</Badge></div><CardDescription className="mt-1">{question.prompt}</CardDescription></div><InfoSeal info={question.infoSeal} /></div></CardHeader>
                    <CardContent className="space-y-4">
                        {question.alternatives && question.alternatives.length > 0 && <div className="flex flex-wrap gap-2">{question.alternatives.map((alternative, index) => <Button key={index} type="button" variant="outline" size="sm" onClick={() => setAnswers((current) => ({ ...current, [question.fieldKey]: valueToText(alternative.value) }))}>{valueToText(alternative.value)}</Button>)}</div>}
                        <div className="space-y-2">
                            <Label htmlFor={`gap-${question.fieldKey}`}>Tu respuesta</Label>
                            <Textarea id={`gap-${question.fieldKey}`} rows={question.fieldKey === "faqs" ? 6 : 3} value={answers[question.fieldKey] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.fieldKey]: event.target.value }))} placeholder={questionInputPlaceholder(question)} />
                            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                                <p className="font-medium text-foreground">Formato sugerido</p>
                                <p className="mt-1">{question.infoSeal.expectedFormat}</p>
                                {questionFormatHelp(question) && <p className="mt-2 whitespace-pre-wrap">{questionFormatHelp(question)}</p>}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {question.suggestedValue !== null && question.suggestedValue !== undefined && question.reason !== "not_found" && <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ fieldKey: question.fieldKey, value: question.suggestedValue, action: "confirm" })}><Check className="mr-2 h-4 w-4" />Confirmar sugerencia</Button>}
                            <Button disabled={mutation.isPending || !answers[question.fieldKey]?.trim()} onClick={() => mutation.mutate({ fieldKey: question.fieldKey, value: editorValue(question.suggestedValue, answers[question.fieldKey]), action: "correct" })}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar respuesta</Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
            <Card>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="font-medium">Avance del paso 4</p>
                        <p className="text-sm text-muted-foreground">Quedan {project.dynamicQuestions.length} campo(s) por guardar antes de pedir los datos internos obligatorios.</p>
                    </div>
                    <Button disabled><ChevronRight className="mr-2 h-4 w-4" />Continuar a datos internos</Button>
                </CardContent>
            </Card>
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
        mutationFn: async () => {
            const withInternalData = await onboardingBreApiClient.saveInternalData(project.id, data);
            return withInternalData.completionEvent
                ? withInternalData
                : onboardingBreApiClient.finalizeBaseContext(project.id);
        },
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            toast.success("Datos internos guardados. Continuamos al objetivo operativo.");
            onSaved();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const submit = () => {
        const nextErrors = validateInternalBusinessData(data);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) mutation.mutate();
    };
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Datos internos obligatorios</h2><p className="mt-1 text-muted-foreground">Estos datos no se consideran confiables por extracción pública y deben ser ingresados por el negocio.</p></div>
            <div className="grid gap-4 lg:grid-cols-2">
                <MoneyCard label="Ticket promedio" info={INTERNAL_INFO_SEALS.averageTicket} value={data.averageTicket} error={errors.averageTicket} onChange={(averageTicket) => setData((current) => ({ ...current, averageTicket }))} />
                <MoneyCard label="LTV del cliente" info={INTERNAL_INFO_SEALS.ltv} value={data.ltv} error={errors.ltv} onChange={(ltv) => setData((current) => ({ ...current, ltv }))} />
                <MoneyCard label="CAC del negocio" info={INTERNAL_INFO_SEALS.cac} value={data.cac} error={errors.cac} onChange={(cac) => setData((current) => ({ ...current, cac }))} />
                <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-lg">Modelo de negocio</CardTitle><CardDescription>Obligatorio, selección múltiple</CardDescription></div><InfoSeal info={INTERNAL_INFO_SEALS.businessModels} /></div></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2">{BUSINESS_MODEL_OPTIONS.map((model) => <label key={model} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm"><Checkbox checked={data.businessModels.includes(model)} onCheckedChange={(checked) => setData((current) => ({ ...current, businessModels: checked ? [...current.businessModels, model] : current.businessModels.filter((item) => item !== model) }))} /><span>{model}</span></label>)}</div>{data.businessModels.includes("Otro") && <Input placeholder="Describe el otro modelo" value={data.otherBusinessModel || ""} onChange={(event) => setData((current) => ({ ...current, otherBusinessModel: event.target.value }))} />}{(errors.businessModels || errors.otherBusinessModel) && <p className="text-sm text-destructive">{errors.businessModels || errors.otherBusinessModel}</p>}</CardContent></Card>
            </div>
            <div className="flex justify-end"><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar y continuar a objetivo</Button></div>
        </div>
    );
};

const ObjectiveStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: (objective: BreOperationalObjective) => void }) => {
    const queryClient = useQueryClient();
    const [objective, setObjective] = useState<BreOperationalObjective>(project.operationalObjective?.objective || "appointments");
    const [calendarEmail, setCalendarEmail] = useState(project.operationalObjective?.calendarEmail || "");
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveOperationalObjective({
            projectId: project.id,
            objective,
            calendarEmail: objective === "meetings" ? calendarEmail : null,
            locationTerm: objective === "appointments" ? "sedes" : null,
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Objetivo operativo guardado");
            onSaved(objective);
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const canSave = objective === "appointments" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calendarEmail.trim());
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Objetivo operativo</h2><p className="mt-1 text-muted-foreground">Selecciona si el bot debe agendar citas presenciales o reuniones comerciales.</p></div>
            <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>Tipo de agendamiento</CardTitle><CardDescription>Esta decisión bifurca el resto del onboarding.</CardDescription></div><InfoSeal info={OPERATIONAL_INFO_SEALS.objective} /></div></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{OBJECTIVE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setObjective(option.value)} className={`rounded-xl border p-4 text-left transition ${objective === option.value ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}><p className="font-semibold">{option.label}</p><p className="mt-1 text-sm text-muted-foreground">{option.description}</p></button>)}</CardContent></Card>
            {objective === "meetings" && (
                <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-lg">Reuniones con Google Meet</CardTitle><CardDescription>Esta rama tiene un costo único adicional de USD 300.</CardDescription></div><InfoSeal info={OPERATIONAL_INFO_SEALS.calendarEmail} /></div></CardHeader><CardContent className="space-y-3"><Alert><CalendarDays className="h-4 w-4" /><AlertTitle>Configuración técnica pendiente</AlertTitle><AlertDescription>Guardaremos el correo y el equipo técnico se contactará para habilitar permisos de calendario y Google Meet.</AlertDescription></Alert><Input type="email" value={calendarEmail} onChange={(event) => setCalendarEmail(event.target.value)} placeholder="agenda@empresa.com" /></CardContent></Card>
            )}
            <div className="flex justify-end"><Button size="lg" disabled={!canSave || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar objetivo</Button></div>
        </div>
    );
};

const LocationsStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: () => void }) => {
    const queryClient = useQueryClient();
    const locationTerm = "sedes";
    const locationCardLabel = singularLocationLabel(locationTerm);
    const suggestedLocations = project.locations.length
        ? project.locations.map(hydrateLocationForEditor)
        : buildSuggestedLocationsFromContext(project.contextFields).map(hydrateLocationForEditor);
    const [locations, setLocations] = useState<BreLocationV1[]>(suggestedLocations.length ? suggestedLocations : [emptyLocation()]);
    const [errors, setErrors] = useState<string[]>([]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveLocations({
            projectId: project.id,
            locationTerm,
            locations: locations.map((location) => ({
                ...location,
                status: "confirmed",
                hours: formatWeeklyHours(location.weeklyHours || [], location.scheduleNotes),
            })),
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Sedes guardadas y enriquecidas");
            onSaved();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const updateLocation = (index: number, patch: Partial<BreLocationV1>) => setLocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    const submit = () => {
        const nextErrors = validateLocations(locations);
        setErrors(nextErrors);
        if (!nextErrors.length) mutation.mutate();
    };
    const updateLocationHour = (locationIndex: number, hourIndex: number, patch: Partial<NonNullable<BreLocationV1["weeklyHours"]>[number]>) => setLocations((current) => current.map((location, itemIndex) => {
        if (itemIndex !== locationIndex) return location;
        const weeklyHours = location.weeklyHours || emptyAgendaConfig().weeklyHours.map((item) => ({ ...item }));
        return {
            ...location,
            weeklyHours: weeklyHours.map((hour, currentHourIndex) => currentHourIndex === hourIndex ? { ...hour, ...patch } : hour),
        };
    }));
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Sedes para citas</h2><p className="mt-1 text-muted-foreground">Confirma todas las ubicaciones reales. Las detectadas por scraping solo son referencia; aquí se define la operación final.</p></div>
            <Alert><MapPin className="h-4 w-4" /><AlertTitle>AI Geo Enricher</AlertTitle><AlertDescription>Después de guardar, el sistema genera referencias, alias y frases de match para cada sede confirmada.</AlertDescription></Alert>
            {!project.locations.length && suggestedLocations.length > 0 && (
                <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Ubicaciones precargadas desde contexto y Google Maps</AlertTitle>
                    <AlertDescription>Ya te dejamos {suggestedLocations.length} {suggestedLocations.length === 1 ? "ubicación sugerida" : "ubicaciones sugeridas"}. Primero usamos lo detectado por scraping y contexto; si faltaba nombre, dirección, horario o link, completamos con Google Maps cuando había evidencia disponible. Puedes editar, quitar o agregar antes de guardar.</AlertDescription>
                </Alert>
            )}
            {locations.map((location, index) => (
                <Card key={index}>
                    <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="text-lg">{locationCardLabel} {index + 1}</CardTitle><Button variant="outline" size="sm" disabled={locations.length === 1} onClick={() => setLocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</Button></div></CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2"><Label>Nombre</Label><Input value={location.name} onChange={(event) => updateLocation(index, { name: event.target.value })} placeholder="Ej. Sede Norte" /></div>
                        <div className="space-y-2"><Label>Google Maps opcional</Label><Input value={location.googleMapsUrl || ""} onChange={(event) => updateLocation(index, { googleMapsUrl: event.target.value })} placeholder="https://maps.app.goo.gl/..." /></div>
                        <div className="space-y-2 md:col-span-2"><Label>Ubicación</Label><Textarea value={location.address} onChange={(event) => updateLocation(index, { address: event.target.value })} placeholder="Dirección completa, ciudad y referencia" /></div>
                        <div className="space-y-3 md:col-span-2">
                            <div>
                                <Label>Horario de esta sede</Label>
                                <p className="mt-1 text-xs text-muted-foreground">Activa los días que atiende esta sede y define su hora de inicio y fin.</p>
                            </div>
                            {(location.weeklyHours || []).map((item, hourIndex) => (
                                <div key={item.day} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[150px_1fr_1fr]">
                                    <label className="flex items-center gap-2 text-sm font-medium">
                                        <Checkbox checked={item.enabled} onCheckedChange={(checked) => updateLocationHour(index, hourIndex, { enabled: Boolean(checked) })} />
                                        {WEEKDAY_LABELS[item.day]}
                                    </label>
                                    <Input type="time" disabled={!item.enabled} value={item.startTime} onChange={(event) => updateLocationHour(index, hourIndex, { startTime: event.target.value })} />
                                    <Input type="time" disabled={!item.enabled} value={item.endTime} onChange={(event) => updateLocationHour(index, hourIndex, { endTime: event.target.value })} />
                                </div>
                            ))}
                            <Textarea value={location.scheduleNotes || ""} onChange={(event) => updateLocation(index, { scheduleNotes: event.target.value })} placeholder="Notas opcionales por sede: feriados, almuerzo, atención solo con cita previa, etc." />
                        </div>
                    </CardContent>
                </Card>
            ))}
            {errors.length > 0 && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Revisa las sedes</AlertTitle><AlertDescription>{errors.join(" ")}</AlertDescription></Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><Button variant="outline" onClick={() => setLocations((current) => [...current, emptyLocation()])}><Plus className="mr-2 h-4 w-4" />Agregar sede</Button><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar sedes</Button></div>
        </div>
    );
};

const AgendaStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: () => void }) => {
    const queryClient = useQueryClient();
    const isAppointments = project.operationalObjective?.objective === "appointments";
    const inferredTimezone = useMemo(
        () => inferIanaTimezoneFromContext(project.contextFields),
        [project.contextFields],
    );
    const [agenda, setAgenda] = useState<BreAgendaConfigV1>(() => ({
        ...emptyAgendaConfig(),
        timezone: inferredTimezone,
        ...(project.agendaConfig || {}),
    }));
    const [errors, setErrors] = useState<string[]>([]);
    useEffect(() => {
        if (!project.agendaConfig && !isAppointments) {
            setAgenda((current) => ({ ...current, timezone: inferredTimezone }));
        }
    }, [inferredTimezone, isAppointments, project.agendaConfig]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveAgendaConfig({
            projectId: project.id,
            agenda: isAppointments
                ? {
                    ...agenda,
                    timezone: agenda.timezone || inferredTimezone,
                    durationMinutes: 0,
                    weeklyHours: emptyAgendaConfig().weeklyHours,
                }
                : { ...agenda, timezone: agenda.timezone.trim() },
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Agenda guardada");
            onSaved();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const updateHour = (index: number, patch: Partial<BreAgendaConfigV1["weeklyHours"][number]>) => setAgenda((current) => ({ ...current, weeklyHours: current.weeklyHours.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
    const submit = () => {
        const agendaToValidate = isAppointments
            ? { ...agenda, timezone: agenda.timezone || inferredTimezone, durationMinutes: 0, weeklyHours: emptyAgendaConfig().weeklyHours }
            : { ...agenda, timezone: agenda.timezone.trim() };
        const nextErrors = validateAgendaConfig(
            agendaToValidate,
            project.operationalObjective?.objective,
        );
        setErrors(nextErrors);
        if (!nextErrors.length) mutation.mutate();
    };
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Agenda común</h2><p className="mt-1 text-muted-foreground">{isAppointments ? "Define reglas comunes de agendamiento. Los horarios de atención ya se configuran por sede." : "Define horarios, intervalos, duración, cupos y disponibilidad para reuniones."}</p></div>
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between">
                        <div>
                            <CardTitle>Reglas generales</CardTitle>
                            <CardDescription>Estos valores alimentan las plantillas de disponibilidad y conflicto.</CardDescription>
                        </div>
                        <InfoSeal info={OPERATIONAL_INFO_SEALS.agenda} />
                    </div>
                </CardHeader>
                <CardContent className={`grid gap-3 ${isAppointments ? "md:grid-cols-2" : "md:grid-cols-4"}`}>
                    {!isAppointments && (
                        <div className="space-y-2">
                            <Label>Zona horaria del negocio</Label>
                            <Input
                                value={agenda.timezone}
                                onChange={(event) => setAgenda((current) => ({ ...current, timezone: event.target.value }))}
                                placeholder="America/Guayaquil"
                            />
                            <p className="text-xs text-muted-foreground">
                                Se usa para agendar reuniones. Debe estar en formato IANA, por ejemplo America/Guayaquil o Europe/Madrid.
                            </p>
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Intervalo</Label>
                        <Select value={String(agenda.startIntervalMinutes)} onValueChange={(value) => setAgenda((current) => ({ ...current, startIntervalMinutes: Number(value) as 15 | 30 | 60 }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="15">15 minutos</SelectItem>
                                <SelectItem value="30">30 minutos</SelectItem>
                                <SelectItem value="60">60 minutos</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {!isAppointments && (
                        <div className="space-y-2">
                            <Label>Duración</Label>
                            <Select value={String(agenda.durationMinutes)} onValueChange={(value) => setAgenda((current) => ({ ...current, durationMinutes: Number(value) }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {MEETING_DURATION_OPTIONS.map((minutes) => (
                                        <SelectItem key={minutes} value={String(minutes)}>
                                            {minutes === 120 ? "2 horas" : `${minutes} minutos`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Cupos</Label>
                        <Select value={isAppointments && agenda.capacityPerSlot === 0 ? "unlimited" : String(agenda.capacityPerSlot)} onValueChange={(value) => setAgenda((current) => ({ ...current, capacityPerSlot: value === "unlimited" ? 0 : Number(value) }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {isAppointments && <SelectItem value="unlimited">Ilimitado</SelectItem>}
                                {CAPACITY_OPTIONS.map((capacity) => (
                                    <SelectItem key={capacity} value={String(capacity)}>
                                        {capacity} {capacity === 1 ? "cupo" : "cupos"}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
            {isAppointments ? (
                <Alert><MapPin className="h-4 w-4" /><AlertTitle>Horarios configurados por sede</AlertTitle><AlertDescription>Como elegiste citas, cada sede tiene su propio horario y zona horaria. Aquí solo se configuran intervalo, cupos y notas comunes.</AlertDescription></Alert>
            ) : (
                <Card><CardHeader><CardTitle>Horarios semanales para reuniones</CardTitle><CardDescription>Estos horarios aplican a la disponibilidad del calendario de reuniones.</CardDescription></CardHeader><CardContent className="space-y-3">{agenda.weeklyHours.map((item, index) => <div key={item.day} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[150px_1fr_1fr]"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={item.enabled} onCheckedChange={(checked) => updateHour(index, { enabled: Boolean(checked) })} />{WEEKDAY_LABELS[item.day]}</label><Input type="time" disabled={!item.enabled} value={item.startTime} onChange={(event) => updateHour(index, { startTime: event.target.value })} /><Input type="time" disabled={!item.enabled} value={item.endTime} onChange={(event) => updateHour(index, { endTime: event.target.value })} /></div>)}</CardContent></Card>
            )}
            <Textarea value={agenda.notes || ""} onChange={(event) => setAgenda((current) => ({ ...current, notes: event.target.value }))} placeholder="Notas opcionales: días especiales, restricciones comerciales o reglas internas." />
            {errors.length > 0 && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Revisa la agenda</AlertTitle><AlertDescription>{errors.join(" ")}</AlertDescription></Alert>}
            <div className="flex justify-end"><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar agenda</Button></div>
        </div>
    );
};

const LeadFieldsStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: () => void }) => {
    const queryClient = useQueryClient();
    const objective = project.operationalObjective?.objective;
    const isMeetings = objective === "meetings";
    const forceMeetingStandardFieldsActive = (items: BreLeadCaptureFieldV1[]) =>
        items.map((field) => (isMeetings && field.fieldKey !== "custom" ? { ...field, enabled: true } : field));
    const initialFields = useMemo(
        () => normalizeLeadCaptureFieldsForUi(forceMeetingStandardFieldsActive(project.leadCaptureFields.length ? project.leadCaptureFields : DEFAULT_LEAD_FIELDS)),
        [project.leadCaptureFields, isMeetings],
    );
    const [fields, setFields] = useState<BreLeadCaptureFieldV1[]>(initialFields);
    const [errors, setErrors] = useState<string[]>([]);
    useEffect(() => {
        setFields(initialFields);
    }, [initialFields]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveLeadCaptureFields({
            projectId: project.id,
            fields: normalizeLeadCaptureFieldsForUi(forceMeetingStandardFieldsActive(fields)),
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Datos del lead guardados");
            onSaved();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const updateField = (index: number, patch: Partial<BreLeadCaptureFieldV1>) => setFields((current) => current.map((field, fieldIndex) => {
        if (fieldIndex !== index) return field;
        const isForcedMeetingField = isMeetings && field.fieldKey !== "custom";
        const safePatch = isForcedMeetingField && patch.enabled === false ? { ...patch, enabled: true } : patch;
        const next = { ...field, ...safePatch };
        if (isForcedMeetingField) next.enabled = true;
        if (safePatch.enabled === false) {
            next.required = false;
            next.captureTiming = "when_scheduling";
            next.blocksEarlyFlow = false;
        }
        if (patch.required === false) {
            next.blocksEarlyFlow = false;
        }
        if (patch.captureTiming === "when_scheduling") {
            next.blocksEarlyFlow = false;
        }
        return normalizeLeadCaptureFieldLabel(next);
    }));
    const submit = () => {
        const nextErrors = validateLeadCaptureFields(fields, objective);
        setErrors(nextErrors);
        if (!nextErrors.length) mutation.mutate();
    };
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Datos que pedirá el bot al lead</h2><p className="mt-1 text-muted-foreground">Fecha y hora son variables operativas de agenda; aquí se definen datos personales o comerciales del lead.</p></div>
            <Alert><FileText className="h-4 w-4" /><AlertTitle>Regla por canal</AlertTitle><AlertDescription>Si el lead viene de WhatsApp, el bot no pedirá teléfono salvo que lo marques estrictamente obligatorio.</AlertDescription></Alert>
            <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>Campos de captura</CardTitle><CardDescription>Activa campos, define si son obligatorios y cuándo deben bloquear el flujo.</CardDescription></div><InfoSeal info={OPERATIONAL_INFO_SEALS.leadFields} /></div></CardHeader><CardContent className="space-y-3">{fields.map((field, index) => {
                const isCustom = field.fieldKey === "custom";
                const isForcedMeetingField = isMeetings && field.fieldKey !== "custom";
                const showTiming = field.enabled;
                const asksAtStart = field.captureTiming === "conversation_start";
                return (
                    <div key={`${field.fieldKey}-${index}`} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_120px_140px]">
                        <Input
                            value={field.label}
                            readOnly={!isCustom}
                            disabled={!isCustom}
                            onChange={(event) => updateField(index, { label: event.target.value })}
                        />
                        <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.enabled} disabled={isForcedMeetingField} onCheckedChange={(checked) => updateField(index, { enabled: Boolean(checked), required: Boolean(checked) ? field.required : false })} />Activo</label>
                        <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.required} disabled={!field.enabled} onCheckedChange={(checked) => updateField(index, { required: Boolean(checked) })} />Obligatorio</label>
                        <p className="md:col-span-3 text-xs text-muted-foreground">{field.reason}</p>
                        {showTiming && (
                            <div className="md:col-span-3 grid gap-3 rounded-lg bg-muted/35 p-3 md:grid-cols-[minmax(240px,360px)_1fr]">
                                <div className="space-y-1">
                                    <Label>Cuándo pedir este dato</Label>
                                    <Select value={field.captureTiming || "when_scheduling"} onValueChange={(value) => updateField(index, { captureTiming: value as BreLeadCaptureFieldV1["captureTiming"] })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="when_scheduling">Cuando vaya a agendar</SelectItem>
                                            <SelectItem value="conversation_start">Al inicio de la conversación</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Si se pide al agendar, bloquea solo antes de confirmar la cita o reunión.</p>
                                </div>
                                {asksAtStart && field.required ? (
                                    <div className="rounded-lg border bg-background p-3">
                                        <label className="flex items-start gap-2 text-sm">
                                            <Checkbox checked={Boolean(field.blocksEarlyFlow)} onCheckedChange={(checked) => updateField(index, { blocksEarlyFlow: Boolean(checked) })} />
                                            <span>
                                                <span className="font-medium">Bloquear flujo si no entrega este dato al inicio</span>
                                                <span className="mt-1 block text-xs text-muted-foreground">Si queda desactivado, el bot puede responder preguntas del negocio y volverá a pedir el dato antes de confirmar el agendamiento.</span>
                                            </span>
                                        </label>
                                    </div>
                                ) : asksAtStart ? (
                                    <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                                        Este dato se pedirá al inicio como dato opcional. Si el usuario no lo entrega, el bot continuará el flujo y no lo usará como bloqueo.
                                    </div>
                                ) : (
                                    <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                                        Este dato será obligatorio al momento de agendar. No se convertirá en filtro bloqueante de bienvenida.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}</CardContent></Card>
            {errors.length > 0 && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Revisa los campos</AlertTitle><AlertDescription>{errors.join(" ")}</AlertDescription></Alert>}
            <div className="flex justify-end"><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar datos del lead</Button></div>
        </div>
    );
};

const StyleStep = ({ project, onSaved }: { project: OnboardingBreProjectV1; onSaved: () => void }) => {
    const queryClient = useQueryClient();
    const [stylePreference, setStylePreference] = useState<BreStylePreferenceV1>(project.stylePreference || { emojiMode: "moderate" });
    const [errors, setErrors] = useState<string[]>([]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveStylePreference({ projectId: project.id, stylePreference }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            toast.success("Preferencia de estilo guardada");
            onSaved();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const submit = () => {
        const nextErrors = validateStylePreference(stylePreference);
        setErrors(nextErrors);
        if (!nextErrors.length) mutation.mutate();
    };
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Preferencia de emojis</h2><p className="mt-1 text-muted-foreground">Esta decisión afecta la redacción de plantillas, no la estructura de datos.</p></div>
            <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>Estilo final</CardTitle><CardDescription>El AI Brain respetará esta preferencia al generar el bot.</CardDescription></div><InfoSeal info={OPERATIONAL_INFO_SEALS.stylePreference} /></div></CardHeader><CardContent className="grid gap-3 md:grid-cols-3">{EMOJI_MODE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setStylePreference({ emojiMode: option.value })} className={`rounded-xl border p-4 text-left transition ${stylePreference.emojiMode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}><p className="font-semibold">{option.label}</p><p className="mt-1 text-sm text-muted-foreground">{option.description}</p></button>)}</CardContent></Card>
            {errors.length > 0 && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Revisa el estilo</AlertTitle><AlertDescription>{errors.join(" ")}</AlertDescription></Alert>}
            <div className="flex justify-end"><Button size="lg" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar estilo</Button></div>
        </div>
    );
};

const ReviewPillList = ({ items }: { items: string[] }) => (
    <div className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-auto pr-1">
        {items.map((item) => (
            <Badge key={item} variant="outline" className="max-w-full break-all font-mono text-[11px]">
                {item}
            </Badge>
        ))}
    </div>
);

const ReviewMetricCard = ({ title, value, helper }: { title: string; value: string; helper: string }) => (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-2 text-xl font-bold text-foreground">{value}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
);

const ReviewInfoBox = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="rounded-xl border bg-muted/20 p-4">
        <p className="font-semibold">{title}</p>
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
);

const ReviewAccordionItem = ({ value, title, description, children }: { value: string; title: string; description: string; children: ReactNode }) => (
    <AccordionItem value={value} className="rounded-2xl border bg-background px-4 shadow-sm">
        <AccordionTrigger className="gap-4 py-4 text-left hover:no-underline">
            <div>
                <p className="text-base font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-sm font-normal text-muted-foreground">{description}</p>
            </div>
        </AccordionTrigger>
        <AccordionContent className="pb-5">
            {children}
        </AccordionContent>
    </AccordionItem>
);

const AiBrainDecisionPanel = ({ project }: { project: OnboardingBreProjectV1 }) => {
    const review = buildAiBrainReview(project);
    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle>Revisión del AI Brain</CardTitle>
                        <CardDescription>Resumen ejecutivo y secciones desplegables para auditar la versión candidata.</CardDescription>
                    </div>
                    <Badge variant="secondary">{review.objectiveLabel}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5 text-sm">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <ReviewMetricCard title="Prompt candidato" value={`${review.promptTemplateCount} plantillas`} helper="Se tienen estas plantillas de respuesta reales insertadas en el documento final." />
                    <ReviewMetricCard title="Matcher" value={`${review.matcherTemplateCount} plantillas`} helper="Se tienen estas plantillas de respuesta mapeadas desde el prompt para clasificar el pipeline." />
                    <ReviewMetricCard title="Modelo AI Brain" value={review.aiBrainModel} helper={review.aiBrainFallback ? "Fallback determinístico activo." : `Modo ${review.aiBrainMode}.`} />
                    <ReviewMetricCard title="Datos operativos" value={`${review.variables.length} marcadores`} helper="Usados dentro de memoria, agenda y condiciones." />
                </div>

                <Accordion type="multiple" defaultValue={["decisions", "templates"]} className="space-y-3">
                    <ReviewAccordionItem value="decisions" title="Decisiones principales" description="Perfil, protección de datos, modelo y matcher determinístico.">
                        <div className="grid gap-3 lg:grid-cols-2">
                            <ReviewInfoBox title="Perfil del compilador">
                                <p>{review.compilerProfile}</p>
                                <p className="mt-2 text-xs">{review.aiBrainContract}</p>
                            </ReviewInfoBox>
                            <ReviewInfoBox title="Protección de datos">
                                <p>País: {review.country}</p>
                                <Badge className="mt-2" variant={review.lopdpStatus === "generated" ? "default" : "outline"}>{review.lopdpStatus === "generated" ? "Texto listo" : "Pendiente legal"}</Badge>
                                <p className="mt-2">{review.lopdpDecision}</p>
                            </ReviewInfoBox>
                            <ReviewInfoBox title="Matcher determinístico">
                                <p>No usa IA en runtime. Solo puede devolver etiquetas permitidas.</p>
                                <div className="mt-2 flex flex-wrap gap-1">{review.matcherLabels.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}</div>
                            </ReviewInfoBox>
                            <ReviewInfoBox title="Modelo del AI Brain">
                                <p>{review.aiBrainModel}</p>
                                <Badge className="mt-2" variant={review.aiBrainFallback ? "outline" : "default"}>
                                    {review.aiBrainFallback ? "Fallback determinístico" : "OpenAI activo"}
                                </Badge>
                                <p className="mt-2 text-xs">Modo: {review.aiBrainMode}</p>
                            </ReviewInfoBox>
                        </div>
                        {review.aiBrainDecisionNotes.length > 0 && (
                            <div className="mt-3 rounded-xl border bg-muted/20 p-4">
                                <p className="font-semibold">Notas auditables</p>
                                <ul className="mt-2 space-y-1 text-muted-foreground">
                                    {review.aiBrainDecisionNotes.map((note) => (
                                        <li key={note}>• {note}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </ReviewAccordionItem>

                    <ReviewAccordionItem value="rules" title="Filtros y gates" description="Reglas recomendadas y bloqueos que protegen el flujo antes de confirmar una cita o reunión.">
                        <div className="grid gap-3 lg:grid-cols-2">
                            <ReviewInfoBox title="Filtros recomendados">
                                <div className="space-y-3">
                                    {review.filters.map((filter) => (
                                        <div key={filter.rule_key} className="rounded-lg bg-background p-3">
                                            <p className="font-mono text-xs font-semibold text-foreground">{filter.rule_key}</p>
                                            <p>{filter.question}</p>
                                            <p className="mt-1 text-xs">Motivo: {filter.reason}</p>
                                        </div>
                                    ))}
                                    {!review.filters.length && <p>No hay filtros orientativos; el flujo se apoya en gates bloqueantes.</p>}
                                </div>
                            </ReviewInfoBox>
                            <ReviewInfoBox title="Gates bloqueantes">
                                <div className="space-y-3">
                                    {review.gates.map((gate) => (
                                        <div key={gate.rule_key} className="rounded-lg bg-background p-3">
                                            <p className="font-mono text-xs font-semibold text-foreground">{gate.rule_key}</p>
                                            <p>{gate.question}</p>
                                            <p className="mt-1 text-xs">Bloquea en: {gate.placement}</p>
                                        </div>
                                    ))}
                                </div>
                            </ReviewInfoBox>
                        </div>
                    </ReviewAccordionItem>

                    <ReviewAccordionItem value="templates" title="Plantillas del prompt y matcher" description="Listado auditable de plantillas, su tipo y el contenido que se insertó en la versión candidata.">
                        <div className="mb-4 grid gap-3 lg:grid-cols-2">
                            <ReviewInfoBox title="Plantillas universales">
                                <p>Bienvenida, LOPDP, agradecimientos, cierre, dudas y fuera de contexto.</p>
                                <ReviewPillList items={review.universalTemplates} />
                            </ReviewInfoBox>
                            <ReviewInfoBox title={review.objectiveTemplateLabel}>
                                <p>Plantillas específicas del objetivo elegido.</p>
                                <ReviewPillList items={review.objectiveTemplates} />
                            </ReviewInfoBox>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                            {review.promptTemplateEntries.map((template) => (
                                <div key={`${template.group}-${template.name}`} className="rounded-xl border bg-muted/20 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="font-mono text-xs font-semibold">{template.name}</p>
                                        <Badge variant={template.group === "faq" ? "secondary" : "outline"}>
                                            {template.group === "universal" ? "Universal" : template.group === "objective" ? review.objectiveLabel : "FAQ"}
                                        </Badge>
                                    </div>
                                    {template.content ? (
                                        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-relaxed text-foreground">{template.content}</pre>
                                    ) : (
                                        <p className="mt-3 text-xs text-muted-foreground">Esta versión anterior no guardó el contenido individual. Regenera candidato para ver el contenido completo.</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </ReviewAccordionItem>

                    <ReviewAccordionItem value="markers" title="Datos operativos y memoria" description="Marcadores usados por el prompt cuando necesita recordar canal, consentimiento, fechas o disponibilidad.">
                        <div className="grid gap-3 lg:grid-cols-2">
                            <ReviewInfoBox title="Marcadores de memoria">
                                <p>Se usan dentro de condiciones del prompt, no como bloque literal.</p>
                                <ReviewPillList items={review.universalVariables} />
                            </ReviewInfoBox>
                            <ReviewInfoBox title={`${review.objectiveLabel}: datos de operación`}>
                                <p>Disponibilidad, agenda, confirmación y seguimiento del objetivo elegido.</p>
                                <ReviewPillList items={review.objectiveVariables} />
                            </ReviewInfoBox>
                        </div>
                    </ReviewAccordionItem>

                    {review.locationReferences.length > 0 && (
                        <ReviewAccordionItem value="locations" title="Referencias generadas por sede" description="Alias, ciudades, sectores y ficha geográfica enriquecida que alimentan el prompt de ubicación.">
                            <div className="grid gap-3 lg:grid-cols-2">
                                {review.locationReferences.map((location) => (
                                    <div key={location.locationName} className="rounded-xl border bg-muted/20 p-3">
                                        <p className="font-semibold">{location.locationName}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{location.address}</p>
                                        {location.aliases.length > 0 && <><p className="mt-3 text-xs font-semibold text-muted-foreground">Alias operativos</p><ReviewPillList items={location.aliases} /></>}
                                        {location.cities.length > 0 && <><p className="mt-3 text-xs font-semibold text-muted-foreground">Ciudades o zonas</p><ReviewPillList items={location.cities} /></>}
                                        {location.sectors.length > 0 && <><p className="mt-3 text-xs font-semibold text-muted-foreground">Sectores o referencias cortas</p><ReviewPillList items={location.sectors} /></>}
                                        {location.geoProfile.length > 0 && (
                                            <div className="mt-3 rounded-lg bg-background p-3">
                                                <p className="text-xs font-semibold text-muted-foreground">Ficha geográfica enriquecida</p>
                                                <ul className="mt-2 space-y-1 text-sm">
                                                    {location.geoProfile.map((value) => <li key={`${location.locationName}-phrase-${value}`}>• {value}</li>)}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ReviewAccordionItem>
                    )}
                </Accordion>
            </CardContent>
        </Card>
    );
};

const GenerateStep = ({ project, onReady }: { project: OnboardingBreProjectV1; onReady: () => void }) => {
    const queryClient = useQueryClient();
    const legalRecommendation = useMemo(() => dataProtectionRecommendationForProject(project), [project]);
    const showLegalTextCard = !isEcuadorProject(project);
    const [legalTextOverride, setLegalTextOverride] = useState(() => showLegalTextCard ? legalRecommendation?.legalText || "" : "");
    useEffect(() => {
        if (!showLegalTextCard) {
            setLegalTextOverride("");
            return;
        }
        setLegalTextOverride((current) => current.trim() ? current : legalRecommendation?.legalText || "");
    }, [showLegalTextCard, legalRecommendation?.key, legalRecommendation?.legalText]);
    const requiresManualLegalText = showLegalTextCard && legalTextOverride.trim().length < 20;
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.generateBotVersion(project.id, { legalTextOverride: showLegalTextCard ? legalTextOverride.trim() || undefined : undefined }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            toast.success("Versión candidata generada");
            onReady();
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const alreadyReady = project.status === "ready_for_technical_review";
    return (
        <div className="space-y-6">
            <div><h2 className="text-2xl font-bold">Generar bot con AI Brain</h2><p className="mt-1 text-muted-foreground">Se crearán filtros, gates, LOPDP, plantillas, prompt blocks, prompt compilado y matcher determinístico.</p></div>
            <div className="grid gap-4 md:grid-cols-3">
                <Card><CardHeader><CardTitle className="text-lg">Objetivo</CardTitle></CardHeader><CardContent>{project.operationalObjective?.objective === "meetings" ? "Reuniones" : "Citas"}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-lg">Agenda</CardTitle></CardHeader><CardContent>{project.agendaConfig ? `${project.agendaConfig.startIntervalMinutes} min · ${project.agendaConfig.capacityPerSlot === 0 ? "cupos ilimitados" : `${project.agendaConfig.capacityPerSlot} cupo(s)`}${project.operationalObjective?.objective === "meetings" ? ` · ${project.agendaConfig.durationMinutes} min` : ""}` : "Pendiente"}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-lg">Campos</CardTitle></CardHeader><CardContent>{project.leadCaptureFields.filter((field) => field.enabled).length} activos</CardContent></Card>
            </div>
            <AiBrainDecisionPanel project={project} />
            {showLegalTextCard && (
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <CardTitle>Texto de protección de datos personales</CardTitle>
                                <CardDescription>
                                    {legalRecommendation
                                        ? `Detectamos ${legalRecommendation.countryLabel}. Se prellenó una recomendación basada en ${legalRecommendation.lawName}; puede editarla antes de generar.`
                                        : "No encontramos una recomendación automática para el país detectado. Ingrese el aviso legal aplicable antes de generar."}
                                </CardDescription>
                            </div>
                            <ShieldCheck className="h-5 w-5 text-primary" />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {legalRecommendation?.sourceUrl && (
                            <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={legalRecommendation.sourceUrl} target="_blank" rel="noreferrer">
                                Ver referencia normativa <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                        <Textarea
                            rows={5}
                            value={legalTextOverride}
                            onChange={(event) => setLegalTextOverride(event.target.value)}
                            placeholder="Ej. Al compartir sus datos, autoriza su tratamiento para contacto comercial, seguimiento y agendamiento conforme a la normativa aplicable de su país. Puede solicitar acceso, corrección o eliminación de sus datos por los canales oficiales del negocio."
                        />
                        <p className="text-xs text-muted-foreground">Este texto se insertará en el bloque de protección de datos y quedará auditado dentro de la versión candidata. Debe revisarse legalmente antes de publicar en producción.</p>
                    </CardContent>
                </Card>
            )}
            <Alert><Bot className="h-4 w-4" /><AlertTitle>Autoaprobación controlada</AlertTitle><AlertDescription>El AI Brain autoaprueba su salida, pero todo queda auditado y la publicación queda pendiente de revisión técnica. No se toca n8n automáticamente.</AlertDescription></Alert>
            <div className="flex justify-end">{alreadyReady ? <Button size="lg" onClick={onReady}>Ver revisión técnica</Button> : <Button size="lg" disabled={mutation.isPending || (requiresManualLegalText && legalTextOverride.trim().length < 20)} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}Generar versión candidata</Button>}</div>
        </div>
    );
};

const ReviewStep = ({ project }: { project: OnboardingBreProjectV1 }) => {
    const queryClient = useQueryClient();
    const canRegenerate = Boolean(isEcuadorProject(project) || dataProtectionRecommendationForProject(project));
    const review = buildAiBrainReview(project);
    const currentPrompt = project.promptVersion?.compiledPrompt || "";
    const currentMatcher = project.matcherVersion?.matcherCode || "";
    const [isEditingPrompt, setIsEditingPrompt] = useState(false);
    const [promptDraft, setPromptDraft] = useState(currentPrompt);
    const [isEditingMatcher, setIsEditingMatcher] = useState(false);
    const [matcherDraft, setMatcherDraft] = useState(currentMatcher);
    useEffect(() => {
        if (!isEditingPrompt) setPromptDraft(currentPrompt);
    }, [currentPrompt, isEditingPrompt]);
    useEffect(() => {
        if (!isEditingMatcher) setMatcherDraft(currentMatcher);
    }, [currentMatcher, isEditingMatcher]);
    const mutation = useMutation({
        mutationFn: () => onboardingBreApiClient.generateBotVersion(project.id),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            toast.success("Nueva versión candidata generada");
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const savePromptMutation = useMutation({
        mutationFn: () => onboardingBreApiClient.savePromptCandidate({
            projectId: project.id,
            promptVersionId: project.promptVersion?.id || "",
            compiledPrompt: promptDraft,
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            setIsEditingPrompt(false);
            toast.success("Prompt candidato guardado");
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const saveMatcherMutation = useMutation({
        mutationFn: () => onboardingBreApiClient.saveMatcherCandidate({
            projectId: project.id,
            matcherVersionId: project.matcherVersion?.id || "",
            matcherCode: matcherDraft,
        }),
        onSuccess: (updated) => {
            queryClient.setQueryData(projectKey(project.id), updated);
            queryClient.invalidateQueries({ queryKey: ["onboarding-bre", "projects"] });
            setIsEditingMatcher(false);
            toast.success("Matcher determinístico guardado");
        },
        onError: (error) => toast.error(toSpanishError(error.message)),
    });
    const promptHasChanges = promptDraft !== currentPrompt;
    const matcherHasChanges = matcherDraft !== currentMatcher;
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-2xl font-bold">Listo para revisión técnica</h2><p className="mt-1 text-muted-foreground">El onboarding operativo quedó completo. Prompt y matcher están versionados como candidatos; n8n no se publica automáticamente.</p></div>
                <Button variant="outline" disabled={mutation.isPending || !canRegenerate} onClick={() => mutation.mutate()} title={canRegenerate ? "Crear una nueva versión candidata con el compilador actual" : "Regresa al paso Generación para ingresar el texto legal manual antes de regenerar."}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}Regenerar candidato</Button>
            </div>
            <AiBrainDecisionPanel project={project} />
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <CardTitle>Prompt candidato</CardTitle>
                                <CardDescription>Documento final versionado {project.promptVersion?.versionNumber || "-"} · {(isEditingPrompt ? promptDraft : currentPrompt).length} caracteres · se tienen {review.promptTemplateCount} plantilla(s) de respuesta</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {isEditingPrompt ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={savePromptMutation.isPending}
                                            onClick={() => {
                                                setPromptDraft(currentPrompt);
                                                setIsEditingPrompt(false);
                                            }}
                                        >
                                            Cancelar
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={!project.promptVersion || !promptHasChanges || promptDraft.trim().length < 100 || savePromptMutation.isPending}
                                            onClick={() => savePromptMutation.mutate()}
                                        >
                                            {savePromptMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            Guardar
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!project.promptVersion}
                                        onClick={() => setIsEditingPrompt(true)}
                                    >
                                        Editar
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <Textarea
                            readOnly={!isEditingPrompt}
                            rows={24}
                            value={promptDraft}
                            onChange={(event) => setPromptDraft(event.target.value)}
                            className={isEditingPrompt ? "font-mono" : undefined}
                        />
                        {isEditingPrompt && (
                            <p className="text-xs text-muted-foreground">
                                Esta edición actualiza la versión candidata actual y queda auditada. Si cambias plantillas o lógica, revisa también el matcher.
                            </p>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <CardTitle>Matcher determinístico</CardTitle>
                                <CardDescription>Versión {project.matcherVersion?.versionNumber || "-"} · {(isEditingMatcher ? matcherDraft : currentMatcher).length} caracteres · se tienen {review.matcherTemplateCount} plantilla(s) de respuesta mapeada(s)</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {isEditingMatcher ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={saveMatcherMutation.isPending}
                                            onClick={() => {
                                                setMatcherDraft(currentMatcher);
                                                setIsEditingMatcher(false);
                                            }}
                                        >
                                            Cancelar
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={!project.matcherVersion || !matcherHasChanges || matcherDraft.trim().length < 100 || saveMatcherMutation.isPending}
                                            onClick={() => saveMatcherMutation.mutate()}
                                        >
                                            {saveMatcherMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            Guardar
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!project.matcherVersion}
                                        onClick={() => setIsEditingMatcher(true)}
                                    >
                                        Editar
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <p>Labels: {project.matcherVersion?.labels.join(", ") || "-"}</p>
                        <Textarea
                            readOnly={!isEditingMatcher}
                            rows={24}
                            value={matcherDraft}
                            onChange={(event) => setMatcherDraft(event.target.value)}
                            className={isEditingMatcher ? "font-mono" : undefined}
                        />
                        {isEditingMatcher && (
                            <p className="text-xs text-muted-foreground">
                                Esta edición actualiza el matcher candidato actual y queda auditada. Úsalo para alinear etiquetas, plantillas y condiciones con el prompt editado.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

const ProjectWizard = ({ projectId }: { projectId: string }) => {
    const [stage, setStage] = useState<WizardStage>("sources");
    const [stageHydrated, setStageHydrated] = useState(false);
    const projectQuery = useQuery({
        queryKey: projectKey(projectId),
        queryFn: () => onboardingBreApiClient.getProject(projectId),
        refetchInterval: (query) => query.state.data?.status === "scraping" ? 2500 : false,
    });
    const project = projectQuery.data;
    const sourcesReady = project ? areProvidedSourcesReady(project.sources) : false;
    useEffect(() => {
        setStageHydrated(false);
    }, [projectId]);
    useEffect(() => {
        if (!project) return;
        if (!stageHydrated) {
            if (project.status === "ready_for_technical_review") setStage("review");
            else if (project.status === "generating_bot" || project.currentStep === "generate") setStage("generate");
            else if (project.currentStep === "style") setStage("style");
            else if (project.currentStep === "lead_fields") setStage("lead_fields");
            else if (project.currentStep === "agenda") setStage("agenda");
            else if (project.currentStep === "locations") setStage("locations");
            else if (project.currentStep === "objective") setStage("objective");
            else if (project.status === "base_context_complete") setStage("objective");
            else if (project.status === "scraping") setStage("processing");
            else if (project.currentStep === "internal") setStage("internal");
            else if (project.currentStep === "gaps") setStage("gaps");
            else if (["review_context", "collecting_answers"].includes(project.status) && project.contextFields.length > 0) setStage("context");
            setStageHydrated(true);
            return;
        }
        if (project.status === "scraping") setStage("processing");
        else if (stage === "processing" && sourcesReady && project.contextFields.length > 0) setStage("context");
        else if (stage === "gaps" && project.currentStep === "internal" && project.dynamicQuestions.length === 0) setStage("internal");
    }, [project?.id, project?.status, project?.currentStep, project?.contextFields.length, project?.dynamicQuestions.length, sourcesReady, stage, stageHydrated]);

    if (projectQuery.isLoading) return <AppShell><div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Cargando onboarding...</div></AppShell>;
    if (projectQuery.error || !project) return <AppShell><Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se pudo abrir el proyecto</AlertTitle><AlertDescription>{toSpanishError(projectQuery.error?.message || "Proyecto no encontrado")}</AlertDescription></Alert></AppShell>;

    const canVisitStage = (target: WizardStage) => {
        const baseDone = Boolean(project.completionEvent);
        if (target === "sources") return true;
        if (target === "processing") return project.sources.length > 0;
        if (target === "context") return project.contextFields.length > 0;
        if (target === "gaps") return project.contextFields.length > 0 && project.status !== "scraping";
        if (target === "internal") return project.dynamicQuestions.length === 0 || project.currentStep === "internal" || Boolean(project.internalData) || baseDone;
        if (target === "objective") return baseDone;
        if (target === "locations") return project.operationalObjective?.objective === "appointments";
        if (target === "agenda") return Boolean(project.operationalObjective);
        if (target === "lead_fields") return Boolean(project.agendaConfig);
        if (target === "style") return project.leadCaptureFields.length > 0;
        if (target === "generate") return Boolean(project.stylePreference);
        if (target === "review") return project.status === "ready_for_technical_review" || Boolean(project.promptVersion);
        return false;
    };

    return (
        <AppShell projectName={project.name}>
            <div className="mb-5 flex items-center justify-between gap-3"><Button variant="ghost" asChild><Link to="/onboarding-bre"><ArrowLeft className="mr-2 h-4 w-4" />Volver</Link></Button><Badge variant={["base_context_complete", "ready_for_technical_review"].includes(project.status) ? "default" : "secondary"}>{STATUS_LABELS[project.status]}</Badge></div>
            <WizardProgress stage={stage} canVisitStage={canVisitStage} onSelectStage={setStage} />
            {stage === "sources" && <SourcesStep project={project} onStarted={() => setStage("processing")} />}
            {stage === "processing" && <ProcessingStep project={project} onBack={() => setStage("sources")} onContinue={() => setStage("context")} />}
            {stage === "context" && <ContextStep project={project} onContinue={() => setStage(project.dynamicQuestions.length ? "gaps" : "internal")} />}
            {stage === "gaps" && <GapsStep project={project} onContinue={() => setStage("internal")} />}
            {stage === "internal" && <InternalStep project={project} onSaved={() => setStage("objective")} />}
            {stage === "objective" && <ObjectiveStep project={project} onSaved={(savedObjective) => setStage(savedObjective === "meetings" ? "agenda" : "locations")} />}
            {stage === "locations" && (project.operationalObjective?.objective === "appointments" ? <LocationsStep project={project} onSaved={() => setStage("agenda")} /> : <AgendaStep project={project} onSaved={() => setStage("lead_fields")} />)}
            {stage === "agenda" && <AgendaStep project={project} onSaved={() => setStage("lead_fields")} />}
            {stage === "lead_fields" && <LeadFieldsStep project={project} onSaved={() => setStage("style")} />}
            {stage === "style" && <StyleStep project={project} onSaved={() => setStage("generate")} />}
            {stage === "generate" && <GenerateStep project={project} onReady={() => setStage("review")} />}
            {stage === "review" && <ReviewStep project={project} />}
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
