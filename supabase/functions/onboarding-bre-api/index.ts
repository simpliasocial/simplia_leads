/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bre-worker-secret",
};

const dynamicFieldKeys = new Set([
    "commercial_name",
    "business_description",
    "industry",
    "country",
    "value_proposition",
    "primary_offers",
    "benefits",
    "general_restrictions",
    "ideal_customer_profile",
    "communication_tone",
    "faqs",
]);

const sourceTypes = new Set([
    "website", "instagram", "facebook", "tiktok", "linkedin", "youtube", "other",
]);

const MAX_OPTIONAL_SOURCE_RETRIES = 3;
const retryLimitedStatuses = new Set(["failed", "platform_blocked", "partial"]);

const sourceHosts: Record<string, string[]> = {
    instagram: ["instagram.com"],
    facebook: ["facebook.com", "fb.com"],
    tiktok: ["tiktok.com"],
    linkedin: ["linkedin.com"],
    youtube: ["youtube.com", "youtu.be"],
};

const json = (payload: unknown, status = 200) => {
    const versionedPayload = payload && typeof payload === "object" && !Array.isArray(payload)
        ? { apiVersion: 1, ...(payload as Record<string, unknown>) }
        : payload;
    return new Response(JSON.stringify(versionedPayload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
};

const errorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};
const assert = (condition: unknown, message: string, status = 400): asserts condition => {
    if (!condition) {
        const error = new Error(message) as Error & { status?: number };
        error.status = status;
        throw error;
    }
};

const assertDb = (result: { error?: unknown }) => {
    if (result.error) throw result.error;
    return result;
};

const isPrivateIpv4 = (host: string) => {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10
        || parts[0] === 127
        || parts[0] === 0
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        || parts[0] >= 224;
};

const normalizePublicUrl = (value: unknown) => {
    const raw = String(value || "").trim();
    assert(raw, "La URL es obligatoria.");
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
        url = new URL(withProtocol);
    } catch {
        throw new Error("La URL no tiene un formato válido.");
    }
    assert(url.protocol === "https:" || url.protocol === "http:", "Solo se permiten URLs HTTP o HTTPS.");
    assert(!url.username && !url.password, "La URL no puede incluir credenciales.");
    assert(!url.port || url.port === "80" || url.port === "443", "El puerto de la URL no está permitido.");
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const blockedNames = ["localhost", "metadata.google.internal", "metadata.azure.internal"];
    assert(!blockedNames.includes(host), "La dirección local o de metadata no está permitida.");
    assert(!host.endsWith(".local") && !host.endsWith(".internal") && !host.endsWith(".localhost"), "La dirección privada no está permitida.");
    assert(host !== "::1" && !host.startsWith("fe80:") && !host.startsWith("fc") && !host.startsWith("fd"), "La dirección IPv6 privada no está permitida.");
    assert(!isPrivateIpv4(host), "La dirección IP privada no está permitida.");
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.hostname = host;
    return url.toString();
};

const hostMatches = (host: string, domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

const assertSourceUrlMatchesType = (sourceType: string, normalizedUrl: string) => {
    const host = new URL(normalizedUrl).hostname.toLowerCase();
    if (sourceHosts[sourceType]) {
        assert(hostMatches(host, sourceHosts[sourceType]), `La URL no corresponde a ${sourceType}.`);
    }
    if (sourceType === "website") {
        const social = Object.values(sourceHosts).some((domains) => hostMatches(host, domains));
        assert(!social, "El sitio web oficial no puede ser una URL de red social.");
    }
};

const validateMoney = (metric: any, label: string) => {
    assert(metric && typeof metric === "object", `${label} es obligatorio.`);
    assert(String(metric.currency || "").trim(), `${label} requiere moneda.`);
    assert(metric.mode === "single" || metric.mode === "range", `${label} tiene un formato inválido.`);
    if (metric.mode === "single") {
        assert(Number.isFinite(metric.value) && metric.value > 0, `${label} debe ser mayor que cero.`);
    } else {
        assert(Number.isFinite(metric.min) && metric.min > 0, `${label} requiere un mínimo mayor que cero.`);
        assert(Number.isFinite(metric.max) && metric.max > 0, `${label} requiere un máximo mayor que cero.`);
        assert(metric.max >= metric.min, `${label} tiene un rango inválido.`);
    }
};

const validateInternalData = (data: any) => {
    validateMoney(data?.averageTicket, "El ticket promedio");
    validateMoney(data?.ltv, "El LTV");
    validateMoney(data?.cac, "El CAC");
    assert(Array.isArray(data?.businessModels) && data.businessModels.length > 0, "Selecciona al menos un modelo de negocio.");
    if (data.businessModels.includes("Otro")) assert(String(data.otherBusinessModel || "").trim(), "Describe el otro modelo de negocio.");
};

const isOptionalSourceRetryLimitReached = (source: any, retryCount: number) =>
    source?.source_type !== "website"
    && retryLimitedStatuses.has(String(source?.status || ""))
    && retryCount >= MAX_OPTIONAL_SOURCE_RETRIES;

const getSourceAttemptMeta = async (bre: any, sources: any[]) => {
    const ids = (sources || []).map((source: any) => String(source.id || "")).filter(Boolean);
    const meta = new Map<string, { attemptCount: number; retryCount: number; retryLimitReached: boolean }>();
    if (!ids.length) return meta;
    const { data, error } = await bre.from("scrape_source_runs").select("source_id,attempt").in("source_id", ids);
    if (error) throw error;
    const maxAttemptBySource = new Map<string, number>();
    for (const row of data || []) {
        const sourceId = String(row.source_id || "");
        const attempt = Math.max(0, Number(row.attempt || 0));
        maxAttemptBySource.set(sourceId, Math.max(maxAttemptBySource.get(sourceId) || 0, attempt));
    }
    for (const source of sources || []) {
        const sourceId = String(source.id || "");
        const attemptCount = maxAttemptBySource.get(sourceId) || 0;
        const retryCount = Math.max(attemptCount - 1, 0);
        meta.set(sourceId, {
            attemptCount,
            retryCount,
            retryLimitReached: isOptionalSourceRetryLimitReached(source, retryCount),
        });
    }
    return meta;
};

const operationalStatuses = new Set([
    "base_context_complete",
    "objective_selected",
    "locations_configured",
    "agenda_configured",
    "lead_fields_configured",
    "style_configured",
    "generating_bot",
    "ready_for_technical_review",
]);

const assertBaseNotCompleted = (project: any) => {
    assert(!project.completion_payload && !operationalStatuses.has(String(project.status)), "La etapa base ya fue finalizada.");
};

const assertBaseCompleted = (project: any) => {
    assert(project.completion_payload || operationalStatuses.has(String(project.status)), "Completa primero los puntos 1 al 9.");
};

const invalidateGeneratedArtifacts = async (bre: any, projectId: string) => {
    assertDb(await bre.from("technical_review_queue").delete().eq("project_id", projectId));
    assertDb(await bre.from("matcher_versions").delete().eq("project_id", projectId));
    assertDb(await bre.from("prompt_versions").delete().eq("project_id", projectId));
    assertDb(await bre.from("filter_rules").delete().eq("project_id", projectId));
    assertDb(await bre.from("lopdp_config").delete().eq("project_id", projectId));
    assertDb(await bre.from("projects").update({
        operational_completion_payload: null,
        operational_completed_at: null,
    }).eq("id", projectId));
};

const invalidateFromStyle = async (bre: any, projectId: string) => {
    await invalidateGeneratedArtifacts(bre, projectId);
};

const invalidateFromLeadFields = async (bre: any, projectId: string) => {
    await invalidateGeneratedArtifacts(bre, projectId);
    assertDb(await bre.from("style_preferences").delete().eq("project_id", projectId));
};

const invalidateFromAgenda = async (bre: any, projectId: string) => {
    await invalidateFromLeadFields(bre, projectId);
    assertDb(await bre.from("lead_capture_fields").delete().eq("project_id", projectId));
};

const invalidateFromLocations = async (bre: any, projectId: string) => {
    await invalidateFromAgenda(bre, projectId);
    assertDb(await bre.from("agenda_configs").delete().eq("project_id", projectId));
};

const invalidateFromObjective = async (bre: any, projectId: string) => {
    await invalidateFromLocations(bre, projectId);
    assertDb(await bre.from("locations").delete().eq("project_id", projectId));
};

const invalidateBaseCompletion = async (bre: any, projectId: string, options: { clearInternalData?: boolean } = {}) => {
    await invalidateFromObjective(bre, projectId);
    assertDb(await bre.from("operational_objectives").delete().eq("project_id", projectId));
    if (options.clearInternalData) {
        assertDb(await bre.from("section_answers").delete().eq("project_id", projectId).eq("section_key", "internal_data"));
    }
    assertDb(await bre.from("projects").update({
        completion_payload: null,
        completed_at: null,
        operational_completion_payload: null,
        operational_completed_at: null,
    }).eq("id", projectId));
};

const validateEmail = (value: unknown, label = "El correo") => {
    const email = String(value || "").trim().toLowerCase();
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), `${label} debe tener un formato válido.`);
    return email;
};

const validateLocationsPayload = (locations: any[]) => {
    assert(Array.isArray(locations) && locations.length > 0, "Agrega al menos una sede real.");
    return locations.map((location, index) => {
        const name = String(location?.name || "").trim();
        const address = String(location?.address || "").trim();
        const hours = String(location?.hours || "").trim();
        assert(name, `La sede ${index + 1} requiere nombre.`);
        assert(address, `La sede ${index + 1} requiere ubicación.`);
        assert(hours, `La sede ${index + 1} requiere horario.`);
        const googleMapsUrl = String(location?.googleMapsUrl || "").trim();
        if (googleMapsUrl) normalizePublicUrl(googleMapsUrl);
        return {
            name,
            address,
            hours,
            googleMapsUrl: googleMapsUrl || null,
            appointmentTimezone: String(location?.appointmentTimezone || location?.appointment_timezone || "").trim() || null,
            status: location?.status === "suggested" ? "suggested" : "confirmed",
        };
    });
};

const normalizeTimezoneLookupText = (value: unknown) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isValidIanaTimezone = (value: unknown) => {
    const timezone = String(value || "").trim();
    if (!timezone) return false;
    try {
        Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
        return true;
    } catch {
        return false;
    }
};

const timezoneHints: Array<{ timezone: string; terms: string[] }> = [
    { timezone: "America/Guayaquil", terms: ["ecuador", "quito", "guayaquil", "cuenca", "santo domingo", "sangolqui", "tumbaco", "pichincha"] },
    { timezone: "Europe/Madrid", terms: ["espana", "españa", "madrid", "barcelona", "valencia", "sevilla", "zaragoza"] },
    { timezone: "Europe/London", terms: ["reino unido", "united kingdom", "london", "londres", "england"] },
    { timezone: "America/New_York", terms: ["new york", "nueva york", "miami", "florida", "washington", "boston"] },
    { timezone: "America/Chicago", terms: ["chicago", "texas", "houston", "dallas"] },
    { timezone: "America/Denver", terms: ["denver", "colorado", "phoenix", "arizona"] },
    { timezone: "America/Los_Angeles", terms: ["los angeles", "san francisco", "california", "seattle", "las vegas"] },
    { timezone: "America/Mexico_City", terms: ["mexico", "ciudad de mexico", "cdmx", "guadalajara", "monterrey"] },
    { timezone: "America/Bogota", terms: ["colombia", "bogota", "medellin", "cali"] },
    { timezone: "America/Lima", terms: ["peru", "lima", "arequipa"] },
    { timezone: "America/Santiago", terms: ["chile", "santiago"] },
    { timezone: "America/Argentina/Buenos_Aires", terms: ["argentina", "buenos aires", "cordoba"] },
    { timezone: "America/Panama", terms: ["panama"] },
    { timezone: "America/Costa_Rica", terms: ["costa rica", "san jose"] },
    { timezone: "America/Santo_Domingo", terms: ["republica dominicana", "santo domingo"] },
];

const resolveAppointmentTimezone = (location: any, contextFields: any[] = [], fallbackTimezone = "America/Guayaquil") => {
    const explicit = String(location?.appointment_timezone || location?.appointmentTimezone || "").trim();
    if (isValidIanaTimezone(explicit)) return explicit;
    const fallback = isValidIanaTimezone(fallbackTimezone) ? fallbackTimezone : "America/Guayaquil";
    const contextText = (contextFields || [])
        .map((field: any) => `${field?.key || ""} ${field?.value || ""}`)
        .join(" ");
    const haystack = normalizeTimezoneLookupText([
        location?.name,
        location?.address,
        location?.hours,
        location?.google_maps_url,
        location?.googleMapsUrl,
        contextText,
    ].filter(Boolean).join(" "));
    const match = timezoneHints.find((hint) => hint.terms.some((term) => haystack.includes(normalizeTimezoneLookupText(term))));
    return match?.timezone || fallback;
};

const weekdayValues = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const validateAgendaPayload = (agenda: any, objective: string) => {
    assert(agenda && typeof agenda === "object", "La agenda es obligatoria.");
    const isAppointments = objective === "appointments";
    const timezone = String(agenda.timezone || "America/Guayaquil").trim();
    const startIntervalMinutes = Number(agenda.startIntervalMinutes);
    const durationMinutes = Number(agenda.durationMinutes);
    const capacityPerSlot = Number(agenda.capacityPerSlot);
    if (!isAppointments) {
        assert(isValidIanaTimezone(timezone), "La zona horaria debe estar en formato IANA, por ejemplo America/Guayaquil o Europe/Madrid.");
    }
    assert([15, 30, 60].includes(startIntervalMinutes), "El intervalo debe ser 15, 30 o 60 minutos.");
    if (isAppointments) {
        assert(Number.isFinite(durationMinutes) && durationMinutes >= 0 && durationMinutes <= 480, "La duración para citas no puede ser negativa.");
        assert(Number.isFinite(capacityPerSlot) && capacityPerSlot >= 0 && capacityPerSlot <= 500, "Los cupos por bloque deben ser cero o mayores.");
    } else {
        assert([15, 30, 60, 120].includes(durationMinutes), "La duración debe ser 15, 30, 60 o 120 minutos.");
        assert(Number.isFinite(capacityPerSlot) && capacityPerSlot > 0 && capacityPerSlot <= 500, "Los cupos por bloque deben ser mayores que cero.");
    }
    const weeklyHours = Array.isArray(agenda.weeklyHours) ? agenda.weeklyHours : [];
    const normalizedHours = weeklyHours.map((item: any) => ({
        day: String(item?.day || ""),
        enabled: Boolean(item?.enabled),
        startTime: String(item?.startTime || "").trim(),
        endTime: String(item?.endTime || "").trim(),
    })).filter((item: any) => weekdayValues.has(item.day));
    assert(normalizedHours.some((item: any) => item.enabled), "Activa al menos un día de atención.");
    for (const item of normalizedHours.filter((row: any) => row.enabled)) {
        assert(timePattern.test(item.startTime) && timePattern.test(item.endTime), "Uno o más horarios tienen formato inválido.");
        assert(item.startTime < item.endTime, "Cada horario debe terminar después de iniciar.");
    }
    return {
        timezone,
        startIntervalMinutes,
        durationMinutes,
        capacityPerSlot,
        weeklyHours: normalizedHours,
        notes: String(agenda.notes || "").trim() || null,
    };
};

const leadFieldKeys = new Set(["full_name", "phone", "email", "national_id", "age", "city", "custom"]);

const normalizeLeadFieldLabel = (fieldKey: string, label: unknown) => {
    if (fieldKey === "full_name") return "Nombre completo";
    if (fieldKey === "phone") return "Número Celular";
    if (fieldKey === "email") return "Correo Electrónico";
    if (fieldKey === "national_id") return "Identificación";
    return String(label || "").trim();
};

const normalizeLeadFieldCaptureTiming = (field: any) =>
    String(field?.captureTiming ?? field?.capture_timing ?? "") === "conversation_start"
        ? "conversation_start"
        : "when_scheduling";

const normalizeLeadFieldBlocksEarlyFlow = (field: any, required: boolean, captureTiming: string) =>
    Boolean(required && captureTiming === "conversation_start" && (field?.blocksEarlyFlow ?? field?.blocks_early_flow));

const validateLeadFieldsPayload = (fields: any[], objective: string) => {
    assert(Array.isArray(fields), "Los datos del lead son obligatorios.");
    const normalized = fields.map((field: any, index: number) => {
        const fieldKey = leadFieldKeys.has(field?.fieldKey) ? field.fieldKey : "custom";
        const label = normalizeLeadFieldLabel(fieldKey, field?.label);
        const customKey = String(field?.customKey || "").trim() || null;
        const enabled = objective === "meetings" && fieldKey !== "custom" ? true : Boolean(field?.enabled);
        const required = Boolean(enabled && field?.required);
        const captureTiming = enabled ? normalizeLeadFieldCaptureTiming(field) : "when_scheduling";
        const blocksEarlyFlow = normalizeLeadFieldBlocksEarlyFlow(field, required, captureTiming);
        assert(!enabled || label, `El campo ${index + 1} requiere etiqueta.`);
        assert(fieldKey !== "custom" || !enabled || customKey, "El campo personalizado requiere una clave interna.");
        return {
            fieldKey,
            label,
            enabled,
            required,
            captureTiming,
            blocksEarlyFlow,
            reason: String(field?.reason || "").trim() || null,
            customKey,
        };
    });
    const enabled = normalized.filter((field: any) => field.enabled);
    assert(enabled.length > 0, "Activa al menos un dato para capturar.");
    return normalized;
};

const leadCaptureFieldRowToDto = (field: any) => {
    const required = Boolean(field.required);
    const captureTiming = Boolean(field.enabled) ? normalizeLeadFieldCaptureTiming(field) : "when_scheduling";
    return {
        fieldKey: field.field_key,
        label: normalizeLeadFieldLabel(field.field_key, field.label),
        enabled: Boolean(field.enabled),
        required,
        captureTiming,
        blocksEarlyFlow: normalizeLeadFieldBlocksEarlyFlow(field, required, captureTiming),
        reason: field.reason,
        customKey: field.custom_key,
    };
};

const normalizeEmojiMode = (value: unknown) => {
    const mode = String(value || "");
    assert(["moderate", "none", "commercial_only"].includes(mode), "Selecciona una preferencia de emojis.");
    return mode;
};

const plainValue = (value: unknown) => {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "").trim();
};

const getContextValue = (fields: any[], key: string) => plainValue(fields.find((field) => (field.field_key || field.key) === key)?.value);

const normalizeForMatch = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isEcuadorCountry = (country: string) => normalizeForMatch(country).includes("ecuador");

type DataProtectionRecommendation = {
    key: string;
    countryLabel: string;
    lawName: string;
    sourceUrl: string;
    legalText: string;
    aliases: string[];
};

const DATA_PROTECTION_RECOMMENDATIONS: DataProtectionRecommendation[] = [
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
        lawName: "Reglamento General de Protección de Datos (RGPD/GDPR) y Ley Orgánica 3/2018 (LOPDGDD)",
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
        lawName: "Ley N.° 29733, Ley de Protección de Datos Personales",
        sourceUrl: "https://www.gob.pe/institucion/minjus/informes-publicaciones/315948-ley-de-proteccion-de-datos-personales-y-su-reglamento",
        aliases: ["peru", "perú", "lima", "arequipa"],
        legalText: "Al facilitar sus datos, autoriza su tratamiento para gestionar su solicitud, agendar la atención y realizar seguimiento relacionado, conforme a la Ley N.° 29733 de Protección de Datos Personales de Perú. Puede solicitar acceso, rectificación, cancelación u oposición por los canales oficiales del negocio.",
    },
    {
        key: "brazil",
        countryLabel: "Brasil",
        lawName: "Lei Geral de Proteção de Dados Pessoais (LGPD), Lei N.º 13.709/2018",
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
        lawName: "Ley 19.628 sobre Protección de la Vida Privada y normativa vigente aplicable",
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

const resolveDataProtectionRecommendation = (fields: any[]) => {
    const haystack = normalizeForMatch([
        getContextValue(fields, "country"),
        getContextValue(fields, "applicable_legal_country"),
        getContextValue(fields, "visible_cities"),
        getContextValue(fields, "possible_locations"),
    ].filter(Boolean).join(" "));
    return DATA_PROTECTION_RECOMMENDATIONS.find((item) =>
        item.aliases.some((alias) => haystack.includes(normalizeForMatch(alias))),
    ) || null;
};

const formatJsonBlock = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const sourceText = (value: string, fallback: string) => value && value.trim() ? value.trim() : fallback;

const splitReferenceWords = (value: string) => Array.from(new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4)
    .slice(0, 8)));

const buildBaselineLocationReferences = (location: { name: string; address: string }) => {
    const words = splitReferenceWords(`${location.name} ${location.address}`);
    return [
        { reference_type: "alias", value: location.name, confidence: "high" },
        ...words.slice(0, 2).map((word) => ({ reference_type: "city", value: word, confidence: "medium" })),
        ...words.slice(2, 5).map((word) => ({ reference_type: "sector", value: word, confidence: "medium" })),
        { reference_type: "phrase", value: `cerca de ${location.name}`, confidence: "medium" },
    ];
};

const stringifyUnknownError = (error: unknown) => {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const normalizeGeoReferenceLines = (values: unknown) => {
    const lines = Array.isArray(values) ? values : [];
    return lines
        .map((value) => String(value || "").trim())
        .filter(Boolean);
};

const buildGeoProfilePhraseReferences = (profile: any) => {
    const phrases: string[] = [];
    const parishOrNeighborhood = String(profile?.parishOrNeighborhood || "").trim();
    const exactIntersection = String(profile?.exactIntersection || "").trim();
    const shoppingCenterOrPlaza = String(profile?.shoppingCenterOrPlaza || "").trim();
    const nearbyLandmarks = normalizeGeoReferenceLines(profile?.nearbyLandmarks);
    const geoSummary = String(profile?.geoSummary || "").trim();
    if (parishOrNeighborhood) phrases.push(`Parroquia o barrio: ${parishOrNeighborhood}`);
    if (exactIntersection) phrases.push(`Intersección exacta: ${exactIntersection}`);
    if (shoppingCenterOrPlaza) phrases.push(`Centro comercial o plaza: ${shoppingCenterOrPlaza}`);
    if (nearbyLandmarks.length) phrases.push(`Establecimientos reconocidos cercanos: ${nearbyLandmarks.join("; ")}`);
    if (geoSummary) phrases.push(`Resumen geográfico: ${geoSummary}`);
    return phrases;
};

const normalizeReferenceValue = (value: unknown) => String(value || "").trim();

const mergeLocationReferencesIntoRows = (locations: any[], referenceRows: any[]) => {
    const referencesByLocation = new Map<string, any[]>();
    referenceRows.forEach((reference: any) => {
        const locationId = String(reference.location_id || reference.locationId || "").trim();
        if (!locationId) return;
        referencesByLocation.set(locationId, [
            ...(referencesByLocation.get(locationId) || []),
            {
                id: reference.id || `${locationId}:${reference.reference_type}:${reference.value}`,
                locationId,
                referenceType: reference.reference_type,
                value: reference.value,
                confidence: reference.confidence || "medium",
            },
        ]);
    });
    return locations.map((location: any) => ({
        ...location,
        references: referencesByLocation.get(location.id) || [],
    }));
};

const buildLocationReferencePromptLines = (references: any[]) => {
    const grouped = {
        alias: references.filter((reference) => reference.referenceType === "alias").map((reference) => normalizeReferenceValue(reference.value)),
        city: references.filter((reference) => reference.referenceType === "city").map((reference) => normalizeReferenceValue(reference.value)),
        sector: references.filter((reference) => reference.referenceType === "sector").map((reference) => normalizeReferenceValue(reference.value)),
        phrase: references.filter((reference) => reference.referenceType === "phrase").map((reference) => normalizeReferenceValue(reference.value)),
    };
    return [
        grouped.alias.length ? `Alias operativos: ${grouped.alias.join(", ")}` : "",
        grouped.city.length ? `Ciudades o zonas de match: ${grouped.city.join(", ")}` : "",
        grouped.sector.length ? `Sectores o referencias cortas: ${grouped.sector.join(", ")}` : "",
        grouped.phrase.length ? `Ficha geográfica enriquecida:\n${grouped.phrase.map((line) => `- ${line}`).join("\n")}` : "",
    ].filter(Boolean);
};

const locationSearchText = (location: any) => normalizeForMatch([
    location?.name,
    location?.address,
    location?.hours,
    location?.appointment_timezone,
    location?.appointmentTimezone,
    location?.google_maps_url,
    location?.googleMapsUrl,
    ...(Array.isArray(location?.references) ? location.references.map((reference: any) => reference?.value) : []),
].filter(Boolean).join(" "));

const COUNTRY_LOCATION_HINTS: Array<{ label: string; timezone: string; terms: string[] }> = [
    { label: "Ecuador", timezone: "America/Guayaquil", terms: ["ecuador", "quito", "guayaquil", "cuenca", "pichincha", "guayas", "sangolqui", "sangolquí", "tumbaco", "tsachilas", "tsáchilas", "santo domingo de los tsachilas", "santo domingo de los tsáchilas"] },
    { label: "España", timezone: "Europe/Madrid", terms: ["espana", "españa", "madrid", "barcelona", "valencia", "sevilla", "zaragoza", "malaga", "málaga", "europe/madrid"] },
    { label: "Reino Unido", timezone: "Europe/London", terms: ["reino unido", "united kingdom", "uk", "inglaterra", "england", "london", "londres", "europe/london"] },
    { label: "Estados Unidos", timezone: "America/New_York", terms: ["estados unidos", "united states", "usa", "eeuu", "ee.uu", "miami", "florida", "new york", "nueva york", "california", "texas", "america/new_york", "america/chicago", "america/los_angeles"] },
    { label: "México", timezone: "America/Mexico_City", terms: ["mexico", "méxico", "ciudad de mexico", "ciudad de méxico", "cdmx", "guadalajara", "monterrey", "america/mexico_city"] },
    { label: "Colombia", timezone: "America/Bogota", terms: ["colombia", "bogota", "bogotá", "medellin", "medellín", "cali", "america/bogota"] },
    { label: "Perú", timezone: "America/Lima", terms: ["peru", "perú", "lima", "arequipa", "america/lima"] },
    { label: "Chile", timezone: "America/Santiago", terms: ["chile", "santiago", "america/santiago"] },
    { label: "Argentina", timezone: "America/Argentina/Buenos_Aires", terms: ["argentina", "buenos aires", "cordoba", "córdoba", "america/argentina"] },
    { label: "Brasil", timezone: "America/Sao_Paulo", terms: ["brasil", "brazil", "sao paulo", "são paulo", "rio de janeiro", "america/sao_paulo"] },
    { label: "Panamá", timezone: "America/Panama", terms: ["panama", "panamá", "america/panama"] },
    { label: "Costa Rica", timezone: "America/Costa_Rica", terms: ["costa rica", "san jose", "san josé", "america/costa_rica"] },
    { label: "Uruguay", timezone: "America/Montevideo", terms: ["uruguay", "montevideo", "america/montevideo"] },
    { label: "República Dominicana", timezone: "America/Santo_Domingo", terms: ["republica dominicana", "república dominicana", "santo domingo", "america/santo_domingo"] },
];

const normalizeCountryLabel = (country: string) => {
    const normalized = normalizeForMatch(country);
    const directHint = COUNTRY_LOCATION_HINTS.find((hint) =>
        normalizeForMatch(hint.label) === normalized
        || hint.terms.some((term) => normalized.includes(normalizeForMatch(term))),
    );
    if (directHint) return directHint.label;
    const dataProtectionMatch = DATA_PROTECTION_RECOMMENDATIONS.find((item) =>
        normalizeForMatch(item.countryLabel) === normalized
        || item.aliases.some((alias) => normalized.includes(normalizeForMatch(alias))),
    );
    return dataProtectionMatch?.countryLabel || country.trim();
};

const inferLocationCountryLabel = (location: any, fallbackCountry = "") => {
    const haystack = locationSearchText(location);
    const fallbackLabel = normalizeCountryLabel(String(fallbackCountry || "").trim());
    const fallbackNormalized = normalizeForMatch(fallbackLabel);
    const matchedHints = COUNTRY_LOCATION_HINTS.filter((hint) =>
        hint.terms.some((term) => haystack.includes(normalizeForMatch(term))),
    );
    const fallbackHint = matchedHints.find((hint) => normalizeForMatch(hint.label) === fallbackNormalized);
    if (fallbackHint) return fallbackHint.label;
    if (matchedHints.length) return matchedHints[0].label;
    const dataProtectionMatch = DATA_PROTECTION_RECOMMENDATIONS.find((item) =>
        item.aliases.some((alias) => haystack.includes(normalizeForMatch(alias))),
    );
    if (dataProtectionMatch) return dataProtectionMatch.countryLabel;
    return fallbackLabel || "País no determinado";
};

const defaultTimezoneForCountry = (country: string) => {
    const normalized = normalizeForMatch(normalizeCountryLabel(country));
    const hint = COUNTRY_LOCATION_HINTS.find((item) => normalizeForMatch(item.label) === normalized);
    return hint?.timezone || "America/Guayaquil";
};

const locationReferenceValuesByType = (location: any, types: string[], limit = 10) => {
    const normalizedTypes = new Set(types.map((type) => normalizeForMatch(type)));
    return Array.from(new Set((Array.isArray(location?.references) ? location.references : [])
        .filter((reference: any) => {
            const referenceType = normalizeForMatch(String(reference?.referenceType || reference?.reference_type || ""));
            return normalizedTypes.has(referenceType);
        })
        .map((reference: any) => normalizeReferenceValue(reference?.value))
        .filter(Boolean)))
        .slice(0, limit);
};

const buildLocationCoverageSummaryLine = (location: any, country: string) => {
    const cityTerms = locationReferenceValuesByType(location, ["city"], 8);
    const sectorTerms = locationReferenceValuesByType(location, ["sector", "alias"], 10);
    const timezone = resolveAppointmentTimezone(location, [], defaultTimezoneForCountry(country));
    return [
        `  - ${String(location?.name || "Sede sin nombre").trim()}`,
        location?.address ? `    Ubicación: ${String(location.address).trim()}` : "",
        timezone ? `    Zona horaria IANA: ${timezone}` : "",
        cityTerms.length ? `    Ciudades o zonas de match: ${cityTerms.join(", ")}` : "",
        sectorTerms.length ? `    Sectores, alias o referencias: ${sectorTerms.join(", ")}` : "",
    ].filter(Boolean).join("\n");
};

const confirmedLocationNamesByTerms = (locations: any[], terms: string[]) => {
    const normalizedTerms = terms.map((term) => normalizeForMatch(term)).filter(Boolean);
    return Array.from(new Set((locations || [])
        .filter((location) => {
            const haystack = locationSearchText(location);
            return normalizedTerms.some((term) => haystack.includes(term));
        })
        .map((location) => String(location?.name || "").trim())
        .filter(Boolean)));
};

const buildNearestLocationTarget = (
    locations: any[],
    targetArea: string,
    terms: string[],
    fallbackTerms: string[] = [],
) => {
    const primary = confirmedLocationNamesByTerms(locations, terms);
    const fallback = primary.length ? primary : confirmedLocationNamesByTerms(locations, fallbackTerms);
    if (!fallback.length) return null;
    return `${targetArea} (${fallback.join(", ")})`;
};

const buildEcuadorNearestLocationReferenceBlock = (locations: any[]) => {
    if (!locations.length) return "";
    const targets = {
        quito: buildNearestLocationTarget(locations, "Quito", ["quito", "amazonas", "marianitas", "ofelia", "quitumbe", "villaflora", "atahualpa"]),
        quitoNorth: buildNearestLocationTarget(locations, "Quito Norte", ["quito norte", "norte de quito", "marianitas", "amazonas", "ofelia", "calderon", "calderón", "la carolina", "la ofelia"], ["quito"]),
        quitoSouth: buildNearestLocationTarget(locations, "Quito Sur", ["quito sur", "sur de quito", "quitumbe", "villaflora", "atahualpa"], ["quito"]),
        santoDomingo: buildNearestLocationTarget(locations, "Santo Domingo", ["santo domingo", "tsachilas", "tsáchilas"]),
        sangolqui: buildNearestLocationTarget(locations, "Valle de Los Chillos", ["sangolqui", "sangolquí", "valle de los chillos", "chillos"], ["valle", "valles"]),
        valles: buildNearestLocationTarget(locations, "Valles", ["sangolqui", "sangolquí", "tumbaco", "valle", "valles", "valle de los chillos", "valle de tumbaco"]),
    };
    const rows = [
        { province: "Azuay", cities: "Cuenca", target: targets.quito, distance: "~440 km" },
        { province: "Bolívar", cities: "Guaranda", target: targets.quitoSouth || targets.quito, distance: "~180 km" },
        { province: "Cañar", cities: "Azogues", target: targets.quito, distance: "~410 km" },
        { province: "Carchi", cities: "Tulcán", target: targets.quitoNorth || targets.quito, distance: "~240 km" },
        { province: "Chimborazo", cities: "Riobamba", target: targets.quitoSouth || targets.quito, distance: "~180 km" },
        { province: "Cotopaxi", cities: "Latacunga", target: targets.quitoSouth || targets.quito, distance: "~90 km" },
        { province: "El Oro", cities: "Machala / Pasaje / Santa Rosa", target: targets.quito, distance: "~500 km" },
        { province: "Esmeraldas", cities: "Esmeraldas / Quinindé / La Concordia", target: targets.santoDomingo || targets.quito, distance: "~140-215 km hacia Santo Domingo" },
        { province: "Galápagos", cities: "Puerto Ayora / San Cristóbal", target: targets.quito, distance: "referencia continental" },
        { province: "Guayas", cities: "Guayaquil / Durán / Daule / Samborondón", target: targets.quito, distance: "~420-430 km" },
        { province: "Guayas", cities: "Playas", target: targets.quito, distance: "~470 km" },
        { province: "Imbabura", cities: "Ibarra / Otavalo / Cotacachi / Atuntaqui", target: targets.quitoNorth || targets.quito, distance: "~115-125 km" },
        { province: "Loja", cities: "Loja", target: targets.quito, distance: "~650 km" },
        { province: "Los Ríos", cities: "Quevedo / Babahoyo / Valencia / Mocache", target: targets.quitoSouth || targets.quito, distance: "~180-200 km" },
        { province: "Manabí", cities: "Manta / Portoviejo / Chone / Bahía / Jipijapa", target: targets.quito, distance: "~350-400 km" },
        { province: "Morona-Santiago", cities: "Macas", target: targets.quitoSouth || targets.quito, distance: "~200 km" },
        { province: "Napo", cities: "Tena", target: targets.sangolqui || targets.valles || targets.quito, distance: "~100 km hacia Valle de Los Chillos" },
        { province: "Orellana", cities: "Coca / Francisco de Orellana", target: targets.sangolqui || targets.valles || targets.quito, distance: "~180 km hacia Valle de Los Chillos" },
        { province: "Pastaza", cities: "Puyo", target: targets.quitoSouth || targets.quito, distance: "~150 km" },
        { province: "Santa Elena", cities: "Salinas / La Libertad", target: targets.quito, distance: "~500 km" },
        { province: "Sucumbíos", cities: "Nueva Loja / Lago Agrio", target: targets.sangolqui || targets.valles || targets.quito, distance: "~190 km hacia Valle de Los Chillos" },
        { province: "Tungurahua", cities: "Ambato", target: targets.quitoSouth || targets.quito, distance: "~120 km" },
        { province: "Zamora-Chinchipe", cities: "Zamora", target: targets.quito, distance: "~670 km" },
    ].filter((row) => row.target);
    if (!rows.length) return "";
    const grouped = rows.reduce((acc: Record<string, string[]>, row) => {
        acc[row.province] = acc[row.province] || [];
        acc[row.province].push(`  - ${row.cities} -> ${row.target}${row.distance ? ` (${row.distance})` : ""}`);
        return acc;
    }, {});
    return [
        "### Ecuador: provincias y ciudades sin sede propia y sede confirmada más cercana",
        "Usa este mapa solo si el usuario está en Ecuador o menciona una provincia/ciudad ecuatoriana.",
        "Solo recomienda sedes ecuatorianas confirmadas. Si no hay coincidencia confiable, muestra las sedes disponibles o pide aclaración.",
        "",
        ...Object.entries(grouped).flatMap(([province, lines]) => [
            "",
            `- ${province}`,
            ...lines,
        ]),
    ].join("\n");
};

const buildNearestLocationReferenceBlock = (params: { country: string; locations: any[] }) => {
    const locations = (params.locations || []).filter((location: any) => String(location?.name || "").trim());
    if (!locations.length) return "";

    const countryMap = locations.reduce((acc: Map<string, any[]>, location: any) => {
        const countryLabel = inferLocationCountryLabel(location, params.country);
        acc.set(countryLabel, [...(acc.get(countryLabel) || []), location]);
        return acc;
    }, new Map<string, any[]>());

    const countrySections = Array.from(countryMap.entries()).map(([countryLabel, countryLocations]) => [
        `### ${countryLabel}`,
        ...countryLocations.map((location) => buildLocationCoverageSummaryLine(location, countryLabel)),
    ].join("\n"));
    const confirmedCountries = Array.from(countryMap.keys())
        .filter((countryLabel) => countryLabel && countryLabel !== "País no determinado");
    const confirmedCountriesLine = confirmedCountries.length
        ? confirmedCountries.join(", ")
        : "No determinado";

    const ecuadorLocations = Array.from(countryMap.entries())
        .filter(([countryLabel]) => normalizeForMatch(countryLabel).includes("ecuador"))
        .flatMap(([, countryLocations]) => countryLocations);
    const nationalMaps = [
        buildEcuadorNearestLocationReferenceBlock(ecuadorLocations),
    ].filter(Boolean);

    return [
        "# INFORMACIÓN INTERNA (NO mostrar al usuario)",
        "Este contenido sirve únicamente para determinar cobertura y sede cercana cuando el usuario menciona una ciudad, provincia, estado, región o país.",
        "Nunca recites este listado completo. Úsalo como base de decisión interna y luego responde con la plantilla de ubicación o sede que corresponda.",
        "",
        "## Reglas de cobertura multipaís",
        `- Países con sedes confirmadas: ${confirmedCountriesLine}.`,
        "- Cercanía NO significa cobertura internacional. La sede más cercana solo se calcula dentro de un país donde existan sedes confirmadas.",
        "- Primero identifica el país del usuario si lo menciona directa o indirectamente por ciudad, provincia, estado, región, código telefónico, referencia geográfica o texto explícito.",
        "- Si el usuario solo menciona una ciudad ambigua que existe en varios países, pide país o estado/provincia antes de recomendar sede.",
        "- Si el país del usuario tiene sedes confirmadas, recomienda únicamente sedes de ese mismo país.",
        "- Si el usuario menciona una ciudad, provincia, estado o región sin sede propia pero el país sí tiene sedes confirmadas, usa el país detectado y las sedes confirmadas de ese país para sugerir la sede más razonable.",
        "- Si existe un mapa nacional específico para ese país, úsalo como apoyo interno. Si no existe mapa nacional, usa ciudades, sectores, alias, referencias, direcciones y zona horaria confirmada de las sedes de ese mismo país.",
        "- Si el país del usuario NO tiene sedes confirmadas, no recomiendes una sede de otro país por defecto, aunque geográficamente parezca cercana.",
        "- Si el país del usuario NO tiene sedes confirmadas, responde que actualmente las sedes confirmadas están en los países listados y pregunta si desea revisar atención en alguno de esos países. Usa PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA o PLANTILLA_UBICACION_DESCONOCIDA, pero NO digas 'la más cercana' ni sugieras una sede transfronteriza.",
        "- Solo cruza países si el usuario indica explícitamente que puede viajar, que desea revisar una sede en otro país o que acepta ser atendido en uno de los países confirmados.",
        "- Nunca inventes sedes, distancias, horarios, Google Maps ni cobertura no confirmada.",
        "",
        "## Algoritmo obligatorio de decisión",
        "1. Extrae pais_usuario_detectado, region_usuario_detectada y ciudad_usuario_detectada desde el mensaje y memoria.",
        "2. Si pais_usuario_detectado está vacío y la ciudad o región es ambigua, pide aclaración de país antes de recomendar sede.",
        "3. Si pais_usuario_detectado no está dentro de los países con sedes confirmadas, no calcules sede cercana. Responde con países/sedes confirmadas y pregunta si desea atención en alguno de ellos.",
        "4. Si pais_usuario_detectado sí está dentro de países confirmados, filtra sedes por ese país.",
        "5. Dentro del país filtrado, busca coincidencia por sede exacta, ciudad, zona, sector, alias, referencia o mapa nacional.",
        "6. Si hay match confiable dentro del mismo país, muestra solo esa sede o las sedes compatibles usando la plantilla de ubicación correspondiente.",
        "7. Si no hay match confiable dentro del mismo país, muestra las sedes confirmadas de ese país y pide elegir.",
        "8. Si el usuario luego acepta otro país confirmado, repite el proceso usando únicamente sedes de ese otro país.",
        "",
        "## Resultado permitido por escenario",
        "- País confirmado + ciudad/sede con match: mostrar sede compatible del mismo país.",
        "- País confirmado + ciudad sin sede directa: recomendar sede del mismo país usando mapa nacional o referencias confirmadas.",
        "- País confirmado + sin match suficiente: listar sedes de ese país y pedir elección.",
        "- País no confirmado: no recomendar sede cercana; listar países/sedes confirmadas y pedir si desea revisar uno.",
        "- País ambiguo o ciudad ambigua: pedir aclaración antes de recomendar.",
        "",
        "## Sedes confirmadas por país",
        ...countrySections,
        nationalMaps.length ? [
            "",
            "## Mapas nacionales disponibles",
            ...nationalMaps,
        ].join("\n") : "",
    ].filter(Boolean).join("\n");
};

const buildDetailedLocationReferencesWithAi = async (params: {
    projectId: string;
    projectName: string;
    objective: string;
    contextFields: any[];
    locations: any[];
}) => {
    const baselineRows = params.locations.flatMap((location: any) => buildBaselineLocationReferences({
        name: location.name,
        address: location.address,
    }).map((reference) => ({
        locationId: location.id,
        reference_type: reference.reference_type,
        value: reference.value,
        confidence: reference.confidence,
    })));
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
    const model = Deno.env.get("BRE_GEO_ENRICHER_MODEL") || "gpt-5.4-mini";
    const fallback = (mode: string, errorMessage?: string) => ({
        rows: baselineRows,
        model: errorMessage ? model : "deterministic-geo-enricher-v1",
        status: "completed",
        outputPayload: {
            mode,
            fallback: true,
            error: errorMessage || null,
            locationCount: params.locations.length,
            referenceCount: baselineRows.length,
        },
        errorMessage: errorMessage || null,
    });
    if (!params.locations.length) return fallback("no_locations");
    if (!openAiKey) return fallback("deterministic_no_openai_key");
    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                input: [{
                    role: "user",
                    content: [
                        "Eres un Geo Enricher para onboarding BRE.",
                        "Debes enriquecer sedes fisicas de un negocio con referencias geograficas utiles para prompts conversacionales y matcher deterministico.",
                        "No inventes datos fuera de lo razonablemente deducible por nombre, direccion, horarios, Google Maps, ciudad, sector y contexto comercial.",
                        "Devuelve texto en español.",
                        "Para cada sede genera alias utiles, terminos de ciudad, terminos de sector y una ficha rica con: parroquia o barrio, interseccion exacta, centro comercial o plaza, establecimientos reconocidos cercanos y un breve resumen geografico.",
                        "El nivel de detalle debe parecerse a una ficha comercial-geografica usable dentro de un prompt, no a una frase corta.",
                        "Si la direccion permite inferir una avenida, plaza, centro comercial, parroquia o punto de referencia conocido, incluyelo.",
                        "En nearbyLandmarks intenta devolver entre 2 y 6 referencias concretas cuando sea razonable.",
                        "En geoSummary redacta entre 2 y 4 frases breves con contexto suficiente para que un agente conversacional entienda la sede y la use para ubicar al lead.",
                        "Si un dato no es confiable, dejalo vacio en lugar de inventarlo.",
                        JSON.stringify({
                            project: { id: params.projectId, name: params.projectName, objective: params.objective },
                            contextFields: (params.contextFields || []).map((field: any) => ({
                                key: field.field_key || field.key,
                                value: field.value,
                            })),
                            locations: params.locations.map((location: any) => ({
                                id: location.id,
                                name: location.name,
                                address: location.address,
                                hours: location.hours,
                                googleMapsUrl: location.google_maps_url || location.googleMapsUrl || null,
                            })),
                            expectedGeoProfileExample: {
                                parishOrNeighborhood: "Se encuentra en la parroquia urbana Sangolquí, dentro del centro comercial principal de la zona.",
                                exactIntersection: "Av. General Enríquez y Calle García Moreno.",
                                shoppingCenterOrPlaza: "Centro Comercial Santa María Sangolquí.",
                                nearbyLandmarks: ["KFC de la esquina", "Parque Infantil Turismo", "Supermercado Santa María"],
                                geoSummary: "La sede está en una zona comercial céntrica del Valle de Los Chillos. El punto funciona bien para referencias como KFC, parque infantil y Mega Santa María.",
                            },
                        }),
                    ].join("\n\n"),
                }],
                text: {
                    format: {
                        type: "json_schema",
                        name: "bre_geo_enricher",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                locations: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            locationId: { type: "string" },
                                            aliases: { type: "array", items: { type: "string" } },
                                            cityTerms: { type: "array", items: { type: "string" } },
                                            sectorTerms: { type: "array", items: { type: "string" } },
                                            geoProfile: {
                                                type: "object",
                                                properties: {
                                                    parishOrNeighborhood: { type: "string" },
                                                    exactIntersection: { type: "string" },
                                                    shoppingCenterOrPlaza: { type: "string" },
                                                    nearbyLandmarks: { type: "array", items: { type: "string" } },
                                                    geoSummary: { type: "string" },
                                                },
                                                required: ["parishOrNeighborhood", "exactIntersection", "shoppingCenterOrPlaza", "nearbyLandmarks", "geoSummary"],
                                                additionalProperties: false,
                                            },
                                        },
                                        required: ["locationId", "aliases", "cityTerms", "sectorTerms", "geoProfile"],
                                        additionalProperties: false,
                                    },
                                },
                            },
                            required: ["locations"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });
        if (!response.ok) return fallback("openai_failed_fallback", `OpenAI Geo Enricher HTTP ${response.status}`);
        const payload = await response.json();
        const aiOutput = parseOpenAiStructuredOutput(payload);
        if (!aiOutput || !Array.isArray(aiOutput.locations)) return fallback("openai_invalid_output_fallback", "OpenAI Geo Enricher no devolvió JSON estructurado válido.");
        const rows = [
            ...baselineRows,
            ...aiOutput.locations.flatMap((location: any) => {
                const locationId = String(location.locationId || "").trim();
                if (!locationId) return [];
                const aliases = normalizeGeoReferenceLines(location.aliases).map((value) => ({
                    locationId,
                    reference_type: "alias",
                    value,
                    confidence: "high",
                }));
                const cityTerms = normalizeGeoReferenceLines(location.cityTerms).map((value) => ({
                    locationId,
                    reference_type: "city",
                    value,
                    confidence: "medium",
                }));
                const sectorTerms = normalizeGeoReferenceLines(location.sectorTerms).map((value) => ({
                    locationId,
                    reference_type: "sector",
                    value,
                    confidence: "medium",
                }));
                const geoPhrases = buildGeoProfilePhraseReferences(location.geoProfile).map((value) => ({
                    locationId,
                    reference_type: "phrase",
                    value,
                    confidence: "medium",
                }));
                return [...aliases, ...cityTerms, ...sectorTerms, ...geoPhrases];
            }),
        ];
        const dedupedRows = Array.from(new Map(rows.map((row) => [`${row.locationId}::${row.reference_type}::${row.value}`, row])).values());
        return {
            rows: dedupedRows,
            model,
            status: "completed",
            outputPayload: {
                mode: "openai_structured_outputs",
                fallback: false,
                locationCount: params.locations.length,
                referenceCount: dedupedRows.length,
                usage: payload.usage || null,
            },
            errorMessage: null,
        };
    } catch (error) {
        return fallback("openai_exception_fallback", stringifyUnknownError(error));
    }
};

const buildMatcherCode = (matcherConfig: Record<string, unknown>) => `// =====================================================
// TRANSCRIPT_TO_PIPELINE_STAGE_MATCHER - SIMPLIA BRE
// Mode: Run Once for All Items
//
// PURPOSE:
// Detectar la ultima respuesta del AI Agent y devolver SOLO:
//
// {
//   pipeline_stage: "bienvenida" |
//                   "solicita_informacion" |
//                   "interesado" |
//                   "desinteresado" |
//                   "cita_agendada" |
//                   "tiene_dudas",
//   matched_template: "PLANTILLA_..."
// }
//
// IMPORTANT:
// - Este nodo NO llama IA ni herramientas.
// - Este nodo clasifica usando TODAS las plantillas del prompt candidato.
// - TEMPLATE_GROUPS se genera desde el prompt: nombre de plantilla + frases de su contenido.
// - Si nada coincide claramente, clasifica como solicita_informacion.
// - Para cambiar etiquetas, editar SOLO STAGES.
// =====================================================


// =====================================================
// 0) GLOBAL CONFIGURATION
// =====================================================

const STAGES = {
  WELCOME: "bienvenida",
  REQUESTS_INFORMATION: "solicita_informacion",
  INTERESTED: "interesado",
  NOT_INTERESTED: "desinteresado",
  APPOINTMENT_SCHEDULED: "cita_agendada",
  HAS_DOUBTS: "tiene_dudas"
};

// CLASIFICACIÓN OFICIAL:
// - bienvenida: aplica para citas y reuniones. SOLO PLANTILLA_BIENVENIDA, PLANTILLA_BIENVENIDA_CON_DATOS, PLANTILLA_BIENVENIDA_FALTAN_DATOS y PLANTILLA_BIENVENIDA_SIN_DATOS.
// - solicita_informacion: aplica para citas y reuniones. Va toda la información del negocio, preguntas FAQ, guía del usuario hacia agendamiento, consultas/respuestas sobre preguntas del usuario y PLANTILLA_AGRADECIMIENTO_LIMITADO. También es el fallback cuando no hay match claro.
// - solicita_informacion solo citas: PLANTILLA_SIN_CITAS, PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR, PLANTILLA_NUMERO_OBLIGATORIO, PLANTILLA_MIS_CITAS.
// - solicita_informacion solo reuniones: PLANTILLA_CONSULTA_UNA_REUNION, PLANTILLA_CONSULTA_VARIAS_REUNIONES, PLANTILLA_CONSULTA_SIN_REUNIONES, PLANTILLA_LISTADO_REUNIONES_PARA_CANCELAR, PLANTILLA_NUMERO_OBLIGATORIO, PLANTILLA_CANCELACION_ABORTADA.
// - interesado común: PLANTILLA_CLIENTE_INTERESADO, PLANTILLA_AGRADECIMIENTO_UTIL y plantillas de recolección/datos incompletos de cita o reunión.
// - interesado solo citas: cuando se muestra una sede con detalle (nombre, dirección, horario, maps o ubicación concreta) y se invita a agendar; además PLANTILLA_INTERES_CON_CIUDAD, PLANTILLA_INTERES_CON_AGENCIA, PLANTILLA_CIUDADES, PLANTILLA_SECTOR_MATCH_CIUDAD_DEDUCIDA, PLANTILLA_UBICACIONES_CON_CIUDAD, PLANTILLA_DATOS_CITA, PLANTILLA_DATOS_INCOMPLETOS, PLANTILLA_FECHA_PASADA, PLANTILLA_HORA_INTERVALO, PLANTILLA_HORA_FUERA_DE_ATENCION, PLANTILLA_HORA_OCUPADA, PLANTILLA_NO_AGENDAR_HOY.
// - interesado solo reuniones: cuando se muestran horarios disponibles; además PLANTILLA_NO_AGENDAR_HOY, PLANTILLA_FECHA_PASADA, PLANTILLA_DIA_NO_HABIL, PLANTILLA_HORA_NO_EN_PUNTO, PLANTILLA_HORA_FUERA_DE_ATENCION, PLANTILLA_HORA_OCUPADA, PLANTILLA_MOSTRAR_HORARIOS, PLANTILLA_DATOS_REUNION, PLANTILLA_DATOS_REUNION_INCOMPLETOS, PLANTILLA_PEDIR_UBICACION_REUNION.
// - desinteresado común: SOLO PLANTILLA_NO_INTERES, PLANTILLA_NO_APLICA, PLANTILLA_LENGUAJE_OFENSIVO_CIERRE, PLANTILLA_NO_AYUDA o PLANTILLA_EQUIVOCACION_CHAT.
// - desinteresado solo citas: PLANTILLA_UBICACION_DESCONOCIDA, PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA, PLANTILLA_CIUDAD_SIN_AGENCIA, PLANTILLA_CIUDAD_SIN_AGENCIA_INSISTE, PLANTILLA_UBICACIONES_SIN_CIUDAD, PLANTILLA_REFERENCIA_CERCANA_SIN_CIUDAD.
// - cita_agendada: SOLO PLANTILLA_CONFIRMACION o PLANTILLA_CONFIRMACION_REUNION.
// - tiene_dudas: solo PLANTILLA_CLIENTE_TIENE_DUDAS.

const DEFAULT_STAGE_WHEN_NO_MATCH = STAGES.REQUESTS_INFORMATION;
const ALLOWED_STAGES = new Set(Object.values(STAGES));

const STAGE_ALIASES = {
  bienvenida: STAGES.WELCOME,
  welcome: STAGES.WELCOME,

  solicita_informacion: STAGES.REQUESTS_INFORMATION,
  solicita_inforamcion: STAGES.REQUESTS_INFORMATION,
  solicitud_informacion: STAGES.REQUESTS_INFORMATION,
  solicitud_de_informacion: STAGES.REQUESTS_INFORMATION,
  pedir_datos: STAGES.REQUESTS_INFORMATION,

  interesado: STAGES.INTERESTED,
  interes: STAGES.INTERESTED,
  lead_calificado: STAGES.INTERESTED,
  marcar_interesado: STAGES.INTERESTED,

  desinteresado: STAGES.NOT_INTERESTED,
  no_interesado: STAGES.NOT_INTERESTED,
  no_interes: STAGES.NOT_INTERESTED,
  no_aplica: STAGES.NOT_INTERESTED,

  cita_agendada: STAGES.APPOINTMENT_SCHEDULED,
  agenda_cita: STAGES.APPOINTMENT_SCHEDULED,
  agendar_cita: STAGES.APPOINTMENT_SCHEDULED,
  reunion_agendada: STAGES.APPOINTMENT_SCHEDULED,
  reunion_registrada: STAGES.APPOINTMENT_SCHEDULED,
  agendado: STAGES.APPOINTMENT_SCHEDULED,

  tiene_dudas: STAGES.HAS_DOUBTS,
  dudas: STAGES.HAS_DOUBTS,
  cliente_tiene_dudas: STAGES.HAS_DOUBTS,
  derivacion_humano: STAGES.HAS_DOUBTS,
  asesor: STAGES.HAS_DOUBTS
};

const TEMPLATE_GROUPS = ${JSON.stringify(matcherConfig, null, 2)};


// =====================================================
// 1) BUILD TRANSCRIPT FROM INPUT ITEMS
// =====================================================

let transcript = "";
let currentUserMessage = "";

for (const inputItem of items) {
  const json = inputItem.json ?? {};
  const messageObject = json.message ?? json;

  const content =
    messageObject.content ??
    json.content ??
    json.text ??
    json.output ??
    json.response ??
    json.respuesta ??
    json.ai_response ??
    json.agent_response ??
    json.transcript ??
    "";

  if (!content) continue;

  const type =
    messageObject.type ??
    messageObject.role ??
    json.type ??
    json.role ??
    json.message_type ??
    "";

  const normalizedType = String(type || "").toLowerCase();

  const role =
    ["human", "user", "usuario", "cliente", "incoming"].includes(normalizedType) ? "User" :
    ["ai", "assistant", "asistente", "bot", "outgoing"].includes(normalizedType) ? "AI Agent" :
    "Other";

  transcript += role + ": " + String(content) + "\\n";
  if (role === "User") currentUserMessage = String(content);
}

if (!transcript.trim()) {
  const firstItem = items?.[0]?.json ?? {};
  transcript = String(
    firstItem.transcript ??
    firstItem.transcript_original ??
    firstItem.conversation_transcript ??
    firstItem.text ??
    firstItem.output ??
    firstItem.response ??
    firstItem.respuesta ??
    ""
  );
  currentUserMessage = String(
    firstItem.current_user_message ??
    firstItem.mensaje ??
    firstItem.user_message ??
    firstItem.last_user_message ??
    firstItem.body?.content ??
    firstItem.body?.conversation?.messages?.[0]?.content ??
    ""
  );
}


// =====================================================
// 2) NORMALIZATION HELPERS
// =====================================================

function normalizeText(text) {
  return String(text || "")
    .replace(/\\\\n/g, "\\n")
    .replace(/\\\\t/g, " ")
    .replace(/\\r/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/\\[\\[[\\s\\S]*?\\]\\]/g, " ")
    .replace(/\\[[^\\]]*?\\]/g, " ")
    .replace(/\\{\\{[\\s\\S]*?\\}\\}/g, " ")
    .replace(/\\{[^}]*?\\}/g, " ")
    .replace(/[^a-z0-9\\s:\\/\\-\\.,;!?\\(\\)\\$@_]/gi, " ")
    .replace(/[ \\t]+/g, " ")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
}

function normalizeKey(text) {
  return normalizeText(text).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function resolveStage(value) {
  const text = String(value || "");
  if (ALLOWED_STAGES.has(text)) return text;
  return STAGE_ALIASES[normalizeKey(text)] || null;
}

function containsAnyPhrase(text, phrases) {
  const normalized = normalizeText(text);
  return (phrases || []).some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase && normalized.includes(normalizedPhrase);
  });
}

function countPhraseHits(text, phrases) {
  const normalized = normalizeText(text);
  return (phrases || []).reduce((count, phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase && normalized.includes(normalizedPhrase) ? count + 1 : count;
  }, 0);
}

function returnPipelineStage(stage, matchedTemplate = null) {
  const resolved = resolveStage(stage);
  if (!resolved || !ALLOWED_STAGES.has(resolved)) {
    return [{
      json: {
        pipeline_stage: DEFAULT_STAGE_WHEN_NO_MATCH,
        matched_template: matchedTemplate
      }
    }];
  }
  return [{
    json: {
      pipeline_stage: resolved,
      matched_template: matchedTemplate
    }
  }];
}

function returnEmptyOutput() {
  return returnPipelineStage(DEFAULT_STAGE_WHEN_NO_MATCH, null);
}

function extractLastAIAgentMessage(transcriptText) {
  const text = String(transcriptText || "").replace(/\\r/g, "");
  const regex = /(?:^|\\n)\\s*(AI Agent|Assistant|Asistente|Bot)\\s*:\\s*([\\s\\S]*?)(?=(?:\\n\\s*(?:User|Usuario|Human|Cliente|AI Agent|Assistant|Asistente|Bot)\\s*:)|$)/gi;
  let match;
  let lastMessage = null;
  while ((match = regex.exec(text)) !== null) {
    lastMessage = match[2];
  }
  return String(lastMessage || "").trim();
}

function findTemplateNameInText(text) {
  const match = String(text || "").match(/PLANTILLA_[A-Z0-9_]+/);
  return match ? match[0] : null;
}

function flattenTemplateGroups(templateGroups) {
  const rules = [];
  for (const [stage, entries] of Object.entries(templateGroups || {})) {
    const resolvedStage = resolveStage(stage);
    if (!resolvedStage || !ALLOWED_STAGES.has(resolvedStage)) continue;
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      if (!entry || !entry.template) continue;
      rules.push({
        stage: resolvedStage,
        template: entry.template,
        phrases: Array.isArray(entry.phrases) ? entry.phrases : [],
        minHits: Number(entry.minHits || 1),
        priority: Number(entry.priority || 0)
      });
    }
  }
  return rules;
}

function buildTemplateStageMap(rules) {
  return rules.reduce((acc, rule) => {
    acc[normalizeKey(rule.template)] = rule.stage;
    return acc;
  }, {});
}


// =====================================================
// 3) TEMPLATE GROUPS BY PIPELINE STAGE
// =====================================================

const RULES = flattenTemplateGroups(TEMPLATE_GROUPS);
const TEMPLATE_STAGE_MAP = buildTemplateStageMap(RULES);
const firstJson = items?.[0]?.json ?? {};
const lastAiMessage = extractLastAIAgentMessage(transcript) || String(
  firstJson.ai_response ??
  firstJson.agent_response ??
  firstJson.last_ai_message ??
  firstJson.output ??
  firstJson.response ??
  firstJson.respuesta ??
  ""
);
const candidateText = [
  lastAiMessage,
  currentUserMessage,
  firstJson.template_name,
  firstJson.templateName,
  firstJson.matched_template,
  firstJson.last_template,
  firstJson.message,
  firstJson.text
].filter(Boolean).join("\\n");


// =====================================================
// 4) DIRECT MATCH BY EXPLICIT TEMPLATE NAME
// =====================================================

for (const inputItem of items) {
  const json = inputItem.json ?? {};
  const directTemplate = [
    json.template_name,
    json.templateName,
    json.matched_template,
    json.last_template,
    json.output_template
  ].map((value) => findTemplateNameInText(value)).find(Boolean);
  if (directTemplate && TEMPLATE_STAGE_MAP[normalizeKey(directTemplate)]) {
    return returnPipelineStage(TEMPLATE_STAGE_MAP[normalizeKey(directTemplate)], directTemplate);
  }
}

const templateFromTranscript = findTemplateNameInText(lastAiMessage || transcript);
if (templateFromTranscript && TEMPLATE_STAGE_MAP[normalizeKey(templateFromTranscript)]) {
  return returnPipelineStage(TEMPLATE_STAGE_MAP[normalizeKey(templateFromTranscript)], templateFromTranscript);
}


// =====================================================
// 5) PHRASE-BASED TEMPLATE SCORING
// =====================================================

let bestMatch = null;

for (const rule of RULES) {
  const hits = countPhraseHits(lastAiMessage || candidateText, rule.phrases);
  if (hits >= rule.minHits) {
    const score = hits * 100 + rule.priority;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        stage: rule.stage,
        template: rule.template,
        hits,
        priority: rule.priority,
        score
      };
    }
  }
}

if (bestMatch) {
  return returnPipelineStage(bestMatch.stage, bestMatch.template);
}

return returnEmptyOutput();`;

const rebuildCompiledPrompt = (blocks: Array<{ blockKey: string; content: string }>) => [
    ...blocks
        .filter((block) => block.blockKey !== "compiled_prompt")
        .filter((block) => block.blockKey !== "objective_config")
        .map((block) => block.content.trim())
        .filter(Boolean),
].join("\n\n");

const renderNamedItems = (items: Array<{ name: string; content: string }>) => items
    .map((item) => `${item.name}\n${item.content.trim()}`)
    .join("\n\n");

const isResponseTemplateName = (name: string) => /^PLANTILLA_[A-Z0-9_]+$/.test(String(name || "").trim());

const countUniqueTemplateNames = (items: Array<{ name: string }>) =>
    Array.from(new Set(items
        .map((item) => String(item.name || "").trim())
        .filter((name) => name && isResponseTemplateName(name)))).length;

const splitPromptLines = (value: unknown) => String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

const sentenceFallback = (value: string, fallback: string) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text || fallback;
};

const buildFaqPromptText = (params: {
    businessName: string;
    faqs: string;
    valueProposition: string;
    services: string;
    benefits: string;
    isAppointments: boolean;
}) => {
    const normalizedExisting = splitPromptLines(params.faqs)
        .map((line) => {
            const trimmed = line.replace(/^[-*•]\s*/, "").trim();
            if (!trimmed) return "";
            if (/respuesta\s*:/i.test(trimmed)) return trimmed;
            if (trimmed.includes("?")) {
                return `${trimmed} Respuesta: responder con la información pública confirmada y regresar al flujo de ${params.isAppointments ? "cita" : "reunión"}.`;
            }
            return "";
        })
        .filter(Boolean);
    const fallbackEntries = [
        `¿Qué hace ${params.businessName}? Respuesta: ${sentenceFallback(params.valueProposition || params.services, "El negocio atiende consultas comerciales y guía al usuario hacia el siguiente paso correcto.")}`,
        `¿Qué servicios ofrecen? Respuesta: ${sentenceFallback(params.services, "Los servicios principales deben explicarse con la información confirmada del contexto del negocio.")}`,
        params.isAppointments
            ? "¿Cómo puedo agendar una cita? Respuesta: Primero se confirma la sede o ubicación, luego se solicitan los datos obligatorios del lead, la fecha y la hora."
            : "¿Cómo puedo agendar una reunión? Respuesta: Primero se valida la necesidad del lead, luego el consentimiento de datos, nombre, correo, fecha y hora.",
        `¿Cuál es el principal beneficio? Respuesta: ${sentenceFallback(params.benefits, "El beneficio principal debe comunicarse de forma clara, breve y sin inventar garantías.")}`,
    ];
    return Array.from(new Set([...normalizedExisting, ...fallbackEntries])).slice(0, 20).join("\n");
};

const buildMemoryAndStyleBlock = (params: { tone: string; emojiRule: string; isAppointments: boolean }) => [
    "MEMORIA Y CONTEXTO",
    "",
    "* Usa la memoria conversacional activamente para recordar datos ya entregados.",
    "* No repitas preguntas si el usuario ya respondió un dato.",
    "* Si el usuario corrige un dato, usa siempre el dato más reciente.",
    "* Si el usuario responde con un número, interpreta ese número según la última lista de opciones enviada.",
    "* Guarda internamente la última plantilla enviada para resolver agradecimientos, dudas, cancelaciones o continuidad del flujo.",
    "* Solo personaliza con [nombre] cuando el usuario haya escrito explícitamente su nombre durante la conversación.",
    "* No repitas el nombre más de una vez por mensaje.",
    "",
    "ESTILO DE COMUNICACIÓN",
    "",
    `* Tono base: ${params.tone}.`,
    `* Las plantillas ya fueron redactadas respetando la decisión de emojis del onboarding. No agregues emojis extra fuera de las plantillas.`,
    "* Responde con calidez, claridad, profesionalismo y orientación comercial.",
    "* Prioriza preguntas cerradas con opciones concretas cuando el flujo lo permita.",
    "* Si el usuario necesita más tiempo, respeta su ritmo y deja la conversación abierta sin presión.",
    "* No conviertas la conversación en un asistente informativo infinito; responde dudas y vuelve al flujo.",
    params.isAppointments
        ? "* Mantén el foco en resolver dudas, elegir sede y agendar la cita."
        : "* Mantén el foco en calificar el lead y agendar una reunión comercial útil.",
].join("\n");

const buildRuntimeDateInstructions = (timezone: string, isAppointments: boolean) => [
    "FUENTE ÚNICA DE TIEMPO",
    "",
    isAppointments ? "No existe una zona horaria global para confirmar citas: la zona horaria se decide por la sede elegida." : `business_timezone oficial del negocio: ${timezone}.`,
    isAppointments
        ? "Cuando exista sede elegida, usa la fecha_base_oficial y hora_base_oficial de la zona horaria IANA de esa sede."
        : "Para reuniones, fecha_base_oficial y hora_base_oficial se calculan siempre en business_timezone, porque la disponibilidad pertenece al calendario del negocio.",
    isAppointments
        ? "La zona horaria de cada sede aparece en ZONAS HORARIAS IANA POR SEDE y debe usarse para validar fecha/hora local."
        : "Antes de pedir fecha y hora, debes conocer la ubicación del usuario e inferir requester_timezone en formato IANA. La hora escrita por el usuario se interpreta en requester_timezone y luego se convierte a business_timezone.",
    "Si fecha_base_oficial u hora_base_oficial no están disponibles como valores concretos, no confirmes agenda; pide fecha/hora concreta al usuario.",
    "Antes de validar una fecha, convierte expresiones como hoy, mañana, pasado mañana, este viernes o el día 18 a una fecha concreta.",
    "Nunca escribas en respuestas al usuario expresiones {{ ... }}, $now, setZone, plus, toFormat ni código JavaScript.",
    isAppointments
        ? "Para citas, no se agenda para el mismo día: siempre debe ser desde mañana o una fecha posterior. Valida la fecha y hora contra la sede elegida, su horario de atención, el intervalo configurado y los cupos disponibles."
        : "Para reuniones, valida fecha pasada, no agendar hoy, día hábil, hora exacta, horario permitido y conflictos de calendario siempre en business_timezone. Conserva requester_timezone para confirmar y consultar la hora local del usuario.",
    "Nunca confirmes usando una fecha u hora relativa sin normalizar.",
].join("\n");

const buildAppointmentFlowBlock = (params: { businessName: string; locationTerm: string; hasLocations: boolean; locationStrategyInstruction?: string }) => [
    "FLUJO PRINCIPAL PARA CITAS AGENDADAS",
    "",
    "0. ORQUESTADOR PRINCIPAL",
    "Evalúa siempre en este orden:",
    "1. Lenguaje ofensivo o agresivo.",
    "2. Equivocación de chat.",
    "3. Desinterés o rechazo claro.",
    "4. Pregunta directa sobre el negocio.",
    "5. Ubicación, ciudad, sector, referencia o sede.",
    "6. Intención de agendar cita.",
    "7. Consulta, cancelación, eliminación o reprogramación de citas existentes.",
    "8. Datos obligatorios del lead.",
    "9. Fecha, hora, horario de sede, cupos y confirmación.",
    "10. Agradecimiento o cierre.",
    "",
    "1. PRIMERA INTERACCIÓN",
    `Inicia como asistente oficial de ${params.businessName}. Si el usuario solo saluda y existen datos configurados para capturar al inicio, usa únicamente la plantilla de bienvenida de captura inicial. No mezcles ciudad, sede, sector, fecha ni hora en esa misma respuesta.`,
    `Si no hay captura inicial pendiente, usa la bienvenida universal y luego aplica la estrategia de sedes: ${params.locationStrategyInstruction || "confirma la sede necesaria para agendar sin pedir datos innecesarios."}`,
    "Si el usuario abre con pregunta directa, responde con la plantilla específica cuando exista y luego vuelve al flujo de cita.",
    "",
    "2. DETECCIÓN DE UBICACIÓN",
    `Si el usuario menciona ciudad, sector, barrio, parroquia, referencia cercana o nombre de ${params.locationTerm}, usa las referencias enriquecidas por sede para mapear la opción correcta. Si solo existe una sede, no preguntes ciudad: confirma esa sede y avanza a datos de cita.`,
    "Si hay match exacto de sede, continúa a datos para agendar.",
    "Si hay match de zona o ciudad, muestra solo las sedes compatibles cuando sea posible.",
    "Si no hay match confiable, muestra las sedes disponibles y pide elección.",
    "",
    "3. CONSULTA, CANCELACIÓN O ELIMINACIÓN DE CITAS",
    "Si el usuario pregunta por sus citas, quiere cancelar, eliminar, posponer o reprogramar, revisa LISTA_MIS_CITAS antes de responder.",
    "Si no hay citas, usa PLANTILLA_SIN_CITAS.",
    "Si hay citas y quiere cancelar o eliminar, usa PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR y pide únicamente el número.",
    "No canceles ni elimines si el usuario no eligió un número válido.",
    "Para reprogramar, primero debe cancelar la cita existente y luego iniciar un nuevo agendamiento.",
    "",
    "4. DATOS PARA AGENDAR",
    "Pide únicamente los datos obligatorios configurados para el lead, más fecha y hora como variables operativas.",
    "No pidas datos que ya existan en memoria.",
    "No confirmes cita sin sede confirmada, fecha normalizada y hora normalizada.",
    "",
    "5. VALIDACIÓN DE DISPONIBILIDAD",
    "Antes de confirmar, valida día hábil de la sede, horario semanal confirmado, intervalo, cupos y conflictos contra CITAS_AGENDADAS.",
    "Si la fecha cae en un día no atendido por esa sede, ofrece el siguiente día hábil válido.",
    "Si la hora está fuera del horario de la sede, usa PLANTILLA_HORA_FUERA_DE_ATENCION.",
    "Si el cupo está lleno, usa PLANTILLA_HORA_OCUPADA y ofrece alternativas.",
    "",
    "6. CONFIRMACIÓN",
    "Solo confirma cuando sede, datos obligatorios, fecha, hora y disponibilidad estén validados.",
    "Usa PLANTILLA_CONFIRMACION y no agregues texto adicional.",
    "",
    params.hasLocations
        ? "MAPA OPERATIVO DE SEDES: usa SEDES Y UBICACIONES para responder al usuario y REFERENCIAS GEOGRÁFICAS PARA MATCH INTERNO para deducir zonas o sedes."
        : "MAPA OPERATIVO DE SEDES: no hay sedes confirmadas; no se debe confirmar cita.",
].join("\n");

const buildMeetingFlowBlock = (params: { businessName: string; timezone: string; durationMinutes: number; intervalMinutes: number }) => [
    "FLUJO PRINCIPAL PARA REUNIONES AGENDADAS",
    "",
    "0. ORQUESTADOR PRINCIPAL",
    "Evalúa siempre en este orden:",
    "1. Lenguaje ofensivo, amenaza, acoso o insulto.",
    "2. Equivocación de chat.",
    "3. Consulta de reuniones agendadas.",
    "4. Cancelación, eliminación, posposición o reprogramación.",
    "5. Desinterés o rechazo claro.",
    "6. Consentimiento rechazado.",
    "7. Solicitud directa de humano.",
    "8. Agradecimiento.",
    "9. Pregunta frecuente o interrupción.",
    "10. Flujo principal de producto, calificación, consentimiento, datos y agenda.",
    "",
    "1. IDENTIFICACIÓN Y CALIFICACIÓN",
    `Primero identifica la necesidad del lead para ${params.businessName}.`,
    "Antes de pedir datos personales, completa las preguntas filtro definidas por el AI Brain: necesidad principal, volumen o frecuencia y rango de inversión cuando aplique.",
    "Si el usuario quiere agendar directamente, explica que primero se necesitan preguntas rápidas para que la reunión sea útil.",
    "",
    "2. CONSENTIMIENTO Y DATOS",
    "Antes de pedir nombre, correo o teléfono, solicita consentimiento de tratamiento de datos.",
    "Si no acepta, no pidas datos personales ni agendes.",
    "Nombre y apellido, correo válido, ubicación del usuario, fecha y hora son obligatorios para reunión.",
    "El teléfono puede ser opcional por canal cuando así esté indicado por las variables dinámicas.",
    "",
    "3. UBICACIÓN Y ZONA HORARIA DEL USUARIO PARA REUNIONES",
    "Antes de pedir fecha y hora, debe conocerse obligatoriamente desde qué ciudad, estado/provincia si aplica y país se conectará el usuario.",
    "No preguntes directamente por zona horaria técnica como America/Guayaquil, Europe/Madrid o UTC-5.",
    "Pregunta con PLANTILLA_PEDIR_UBICACION_REUNION.",
    "Si el usuario responde solo país y ese país tiene varios husos horarios, pide ciudad y estado/provincia.",
    "Si la ciudad es ambigua, pide aclaración.",
    "Una vez identificada la ubicación, infiere requester_timezone en formato IANA.",
    "Ejemplos: Quito, Ecuador = America/Guayaquil; Madrid, España = Europe/Madrid; Miami, Florida, Estados Unidos = America/New_York; Londres, Reino Unido = Europe/London.",
    "",
    "4. FECHA, HORA Y DISPONIBILIDAD",
    `business_timezone oficial: ${params.timezone}.`,
    `Duración de reunión: ${params.durationMinutes} minutos.`,
    `Intervalo operativo: ${params.intervalMinutes} minutos.`,
    "Interpreta la fecha y hora del usuario en requester_timezone.",
    "Convierte esa fecha y hora a business_timezone antes de validar disponibilidad, día hábil, horario permitido, bloque e intervalos.",
    "Guarda appointment_date y appointment_time siempre en horario del negocio, junto con business_timezone.",
    "Conserva requester_timezone para mostrar la reunión en hora local del usuario cuando consulte o confirme.",
    "No confirmes fechas pasadas, reuniones para hoy, fuera del horario permitido ni horarios ocupados sin revisar REUNIONES_AGENDADAS.",
    "",
    "5. CONFIRMACIÓN",
    "Cuando todo esté validado, prepara inicio_evento, fin_evento y descripcion_evento.",
    "PLANTILLA_CONFIRMACION_REUNION debe mostrar fecha/hora del usuario y fecha/hora del negocio.",
    "Usa PLANTILLA_CONFIRMACION_REUNION y no agregues texto adicional.",
].join("\n");

const buildNoHallucinationBlock = () => [
    "REGLAS DE NO ALUCINACIÓN",
    "",
    "Prohibido:",
    "- Inventar precios exactos, descuentos, garantías, promociones o resultados.",
    "- Inventar sedes, links, mapas, horarios o canales no confirmados.",
    "- Inventar disponibilidad sin revisar las variables operativas de agenda.",
    "- Prometer resultados comerciales exactos.",
    "- Dar asesoría legal, financiera o técnica definitiva.",
    "- Confirmar una cita o reunión sin validar los gates definidos.",
    "- Escribir en la respuesta final expresiones de n8n o código como {{ ... }}, $now, setZone, plus, toFormat, JavaScript, funciones o variables sin resolver.",
    "- Confirmar usando fechas relativas o fórmulas. En confirmaciones, [fecha] siempre debe ser una fecha concreta YYYY-MM-DD y [hora] siempre debe ser HH:mm.",
    "",
    "Respuestas correctas cuando no sabes:",
    "- Puedo revisarlo con el equipo.",
    "- Para orientarle mejor, necesito confirmar un dato.",
    "- Esa información no aparece confirmada; puedo ayudarle a avanzar con una opción disponible.",
].join("\n");

const buildPriorityRuleBlock = (isAppointments: boolean) => [
    "REGLA SUPREMA DE PRIORIDAD",
    "",
    "Evalúa siempre en este orden:",
    "1. Lenguaje ofensivo, amenaza, acoso o insulto.",
    "2. Equivocación de chat.",
    `3. ${isAppointments ? "Consulta, cancelación o cambio de cita cuando aplique." : "Consultar reuniones agendadas del usuario."}`,
    `4. ${isAppointments ? "Rechazo claro o desinterés." : "Cancelar, eliminar, posponer o reprogramar reunión."}`,
    "5. Consentimiento rechazado o protección de datos pendiente.",
    "6. Solicitud directa de humano.",
    "7. Agradecimiento.",
    "8. Pregunta frecuente o interrupción.",
    `9. Flujo principal de ${isAppointments ? "ubicación, datos y cita" : "producto, calificación, consentimiento, datos y agenda"}.`,
    "10. Confirmación o cierre.",
    "",
    "Si existe conflicto entre reglas, siempre prevalece la regla con número menor.",
].join("\n");

const buildChannelConditionSnippet = () => [
    "{{",
    "  (function () {",
    "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
    "    const channel = raw.replace('Channel::', '').toLowerCase();",
    "    const shouldAskPhone = ['facebookpage', 'instagram', 'webwidget', 'tiktok'].includes(channel);",
    "    return (!$json.celular && !$json.telefono && shouldAskPhone) ? '• Número celular\\n' : '';",
    "  })()",
    "}}",
].join("\n");

const buildChannelPhoneMissingSnippet = () => [
    "{{",
    "  (function () {",
    "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
    "    const channel = raw.replace('Channel::', '').toLowerCase();",
    "    const shouldAskPhone = ['facebookpage', 'instagram', 'webwidget', 'tiktok'].includes(channel);",
    "    return (!$json.celular && !$json.telefono && shouldAskPhone) ? '• Su número celular\\n' : '';",
    "  })()",
    "}}",
].join("\n");

const buildRequiredPhoneMissingSnippet = () => [
    "{{",
    "  (!$json.celular && !$json.telefono) ? '• Su número celular\\n' : ''",
    "}}",
].join("\n");

const buildLeadFieldRequestLine = (field: any) =>
    field?.fieldKey === "phone"
        ? (field?.required ? "• Número celular\\n" : buildChannelConditionSnippet())
        : `• ${leadFieldRequestLabel(field)}\\n`;

const buildLeadFieldMissingLine = (field: any) => {
    if (field?.fieldKey === "phone") {
        return field?.required ? buildRequiredPhoneMissingSnippet() : "";
    }
    return `{{ !$json.${leadFieldJsonKey(field)} ? '• ${leadFieldMissingLabel(field)}\\n' : '' }}`;
};

const buildLeadFieldPendingRequestLine = (field: any) => {
    if (field?.fieldKey === "phone") {
        return field?.required
            ? [
                "{{",
                "  (!$json.celular && !$json.telefono) ? '• Número celular\\n' : ''",
                "}}",
            ].join("\n")
            : buildChannelConditionSnippet();
    }
    return `{{ !$json.${leadFieldJsonKey(field)} ? '• ${leadFieldRequestLabel(field)}\\n' : '' }}`;
};

const emojiForTemplate = (mode: unknown, token: "welcome" | "location" | "calendar" | "ok" | "warning" | "info") => {
    const normalized = String(mode || "moderate");
    if (normalized === "none") return "";
    if (normalized === "commercial_only" && !["welcome", "ok", "calendar"].includes(token)) return "";
    const icons: Record<string, string> = {
        welcome: "👋",
        location: "📍",
        calendar: "📅",
        ok: "✅",
        warning: "⚠️",
        info: "ℹ️",
    };
    return icons[token] || "";
};

const withTemplateEmoji = (mode: unknown, token: "welcome" | "location" | "calendar" | "ok" | "warning" | "info", text: string) => {
    const icon = emojiForTemplate(mode, token);
    return icon ? `${icon} ${text}` : text;
};

const templateEmojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2139}]/u;
const templateEmojiStripPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2139}\uFE0F]/gu;

const stripTemplateEmojis = (value: string) => String(value || "")
    .replace(templateEmojiStripPattern, "")
    .replace(/^[ \t]+/gm, "")
    .trimStart();

const emojiForTemplateName = (name: string) => {
    const normalized = String(name || "").toUpperCase();
    if (/CONFIRMACION/.test(normalized)) return "✅ 📅";
    if (/DATOS_CITA|DATOS_REUNION/.test(normalized)) return "📝 📅";
    if (/CITA|REUNION|FECHA|HORA|AGENDA|HORARIO/.test(normalized)) return "📅";
    if (/UBICACION|CIUDAD|SEDE|REFERENCIA|MAPA|DIRECCION/.test(normalized)) return "📍";
    if (/LOPDP|DATOS|CONSENTIMIENTO|IDENTIFICACION|CORREO|TELEFONO/.test(normalized)) return "🔒";
    if (/NO_APLICA|DESINTERESADO|NO_INTERES|LENGUAJE|ERROR|INVALIDO|FUERA|PASADA/.test(normalized)) return "⚠️";
    if (/AGRADECIMIENTO|ACEPTADO|CLIENTE_INTERESADO|INTERES/.test(normalized)) return "✅";
    if (/FAQ|DUDA|INFORMACION|PREGUNTA|ASESOR|HUMANO/.test(normalized)) return "💬";
    if (/BIENVENIDA|SALUDO/.test(normalized)) return "👋";
    return "✨";
};

const shouldAddStrategicEmojiPrefix = (name: string) => /BIENVENIDA|CONFIRMACION|DATOS_CITA|DATOS_REUNION|CIUDADES|UBICACIONES|MOSTRAR_HORARIOS|FAQ/.test(String(name || "").toUpperCase());

const applyEmojiPolicyToTemplates = <T extends { name: string; content: string }>(templates: T[], mode: unknown): T[] => {
    const normalized = String(mode || "moderate");
    if (normalized === "none") {
        return templates.map((template) => ({
            ...template,
            content: stripTemplateEmojis(template.content),
        }));
    }
    if (normalized !== "moderate") return templates;
    return templates.map((template) => {
        const content = String(template.content || "");
        const prefix = emojiForTemplateName(template.name);
        const startsWithEmoji = templateEmojiPattern.test(content.trimStart().slice(0, 6));
        if (templateEmojiPattern.test(content) && (!shouldAddStrategicEmojiPrefix(template.name) || startsWithEmoji)) return template;
        return {
            ...template,
            content: `${prefix} ${content}`,
        };
    });
};

const extractLocationCityTerms = (locations: any[]) => Array.from(new Set(locations
    .flatMap((location: any) => Array.isArray(location.references) ? location.references : [])
    .filter((reference: any) => reference.referenceType === "city")
    .map((reference: any) => normalizeReferenceValue(reference.value))
    .filter(Boolean)
    .map((value: string) => value.toLowerCase())));

const buildAppointmentLocationStrategy = (locations: any[]) => {
    const locationCount = locations.length;
    const cityTerms = extractLocationCityTerms(locations);
    const firstLocationName = String(locations[0]?.name || "la sede").trim();
    if (locationCount <= 0) {
        return {
            mode: "no_locations",
            locationCount,
            promptQuestion: "No hay sedes confirmadas; no se puede confirmar una cita.",
            instruction: "No confirmes citas porque no existe ninguna sede configurada.",
        };
    }
    if (locationCount === 1) {
        return {
            mode: "single_location",
            locationCount,
            promptQuestion: `¿Desea agendar su cita en ${firstLocationName}?`,
            instruction: `Existe una sola sede confirmada: ${firstLocationName}. No preguntes ciudad ni sector para iniciar el agendamiento. Invita directamente a agendar en esa sede. Si el usuario pregunta si hay otras sedes, explica que por ahora solo está confirmada ${firstLocationName}.`,
        };
    }
    if (locationCount <= 3 || cityTerms.length <= 1) {
        return {
            mode: locationCount <= 3 ? "direct_few_locations" : "same_city_locations",
            locationCount,
            promptQuestion: "¿En cuál de estas sedes le gustaría agendar su cita?",
            instruction: locationCount <= 3
                ? "Hay tres sedes o menos. No preguntes primero la ciudad: lista las sedes disponibles con dirección, horario y Google Maps cuando exista, y pide que elija una."
                : "Las sedes parecen pertenecer a una misma ciudad o zona. No preguntes primero la ciudad: muestra las sedes y pide elegir la más conveniente.",
        };
    }
    return {
        mode: "ask_city_first",
        locationCount,
        promptQuestion: "¿Me indica desde qué ciudad nos escribe para guiarle mejor?",
        instruction: "Hay más de tres sedes en distintas ciudades o zonas. Primero pregunta ciudad, zona o referencia para filtrar y luego muestra solo las sedes compatibles.",
    };
};

const STANDARD_LEAD_FIELD_KEYS = ["full_name", "phone", "email", "national_id", "age", "city"];

const forceMeetingLeadFieldEnabled = (field: any) =>
    STANDARD_LEAD_FIELD_KEYS.includes(String(field?.fieldKey || "").trim())
        ? { ...field, enabled: true }
        : field;

const leadFieldJsonKey = (field: any) => {
    const fieldKey = String(field?.fieldKey || "").trim();
    if (fieldKey === "full_name") return "nombre";
    if (fieldKey === "phone") return "celular";
    if (fieldKey === "email") return "correo";
    if (fieldKey === "national_id") return "identificacion";
    if (fieldKey === "city") return "ciudad";
    if (fieldKey === "age") return "edad";
    return String(field?.customKey || fieldKey || "dato").replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase();
};

const leadFieldRequestLabel = (field: any) => {
    const fieldKey = String(field?.fieldKey || "").trim();
    if (fieldKey === "full_name") return "Nombre y Apellido";
    if (fieldKey === "phone") return "Número celular";
    if (fieldKey === "email") return "Correo electrónico";
    if (fieldKey === "national_id") return "Identificación";
    if (fieldKey === "age") return "Edad";
    if (fieldKey === "city") return "Ciudad";
    return String(field?.label || "Dato adicional").trim();
};

const leadFieldMissingLabel = (field: any) => {
    const fieldKey = String(field?.fieldKey || "").trim();
    if (fieldKey === "full_name") return "Su nombre y apellido";
    if (fieldKey === "phone") return "Su número celular";
    if (fieldKey === "email") return "Su correo electrónico";
    if (fieldKey === "national_id") return "Su identificación";
    if (fieldKey === "age") return "Su edad";
    if (fieldKey === "city") return "Su ciudad";
    return String(field?.label || "El dato adicional").trim();
};

const leadFieldConfirmationLabel = (field: any) => {
    const fieldKey = String(field?.fieldKey || "").trim();
    if (fieldKey === "phone") return "Número celular";
    if (fieldKey === "email") return "Correo electrónico";
    if (fieldKey === "national_id") return "Identificación";
    if (fieldKey === "age") return "Edad";
    if (fieldKey === "city") return "Ciudad";
    return String(field?.label || "Dato adicional").trim();
};

const leadFieldConfirmationPlaceholder = (field: any) => {
    const key = leadFieldJsonKey(field);
    if (key === "identificacion") return "identificación";
    return key;
};

const leadFieldCaptureTimingLabel = (field: any) =>
    field?.captureTiming === "conversation_start" ? "al inicio de la conversación" : "cuando vaya a agendar";

const leadFieldBlockingLabel = (field: any) => {
    if (!field?.required) return "no bloquea";
    if (field?.captureTiming === "conversation_start") {
        return field?.blocksEarlyFlow
            ? "bloquea el flujo inicial hasta recibirlo"
            : "no bloquea el flujo inicial; si falta, se vuelve a pedir antes de confirmar";
    }
    return "bloquea solo antes de confirmar el agendamiento";
};

const buildUniversalVariableBlock = (timezone: string, includeTime = true) => [
    includeTime ? "MARCADORES DE MEMORIA, CANAL Y TIEMPO" : "MARCADORES DE MEMORIA Y CANAL",
    "",
    "IMPORTANTE PARA N8N:",
    "Estas variables deben quedar escritas literalmente en el prompt candidato para que el workflow de n8n las transforme antes de llamar al AI Agent.",
    "Si por cualquier razón una variable llega sin transformar al AI Agent, no la copies al usuario: pide confirmar fecha u hora concreta antes de responder.",
    "",
    ...(includeTime ? [
        "fecha_base_oficial:",
        `{{ $now.setZone('${timezone}').toFormat('yyyy-MM-dd') }}`,
        "traducido: YYYY-MM-DD",
        "",
        "hora_base_oficial:",
        `{{ $now.setZone('${timezone}').toFormat('HH:mm') }}`,
        "traducido: HH:mm",
        "",
        `zona_horaria: ${timezone}`,
    ] : [
        "Para citas presenciales no uses una zona horaria global: fecha_base_oficial, hora_base_oficial y time_zone se toman de la sede elegida en el bloque de citas.",
    ]),
    "canal: canal de origen de la conversacion.",
    "nombre, apellido, nombre_apellido: datos del lead cuando existan.",
    "telefono, correo: datos de contacto cuando existan o sean requeridos por canal.",
    "consentimiento_datos: true o false.",
    "lopdp_enviado: true o false para no duplicar el aviso legal.",
    "ultima_plantilla_enviada: nombre logico interno de la ultima plantilla.",
    "intencion_pendiente: intencion guardada cuando el lead hace una pregunta directa antes de entregar datos.",
    "",
    "REGLA DINAMICA POR CANAL",
    "Usa este bloque cuando una condicion o plantilla deba cambiar si el lead no viene de WhatsApp:",
    buildChannelConditionSnippet(),
].join("\n");

const buildLocationTimezoneBlock = (locations: any[] = [], fallbackTimezone = "America/Guayaquil") => {
    const rows = locations.length
        ? locations.map((location: any) => ({
            name: String(location?.name || "Sede sin nombre").trim(),
            timezone: resolveAppointmentTimezone(location, [], fallbackTimezone),
        }))
        : [{ name: "sede seleccionada", timezone: fallbackTimezone }];
    return [
        "ZONAS HORARIAS IANA POR SEDE",
        "",
        "Regla: para citas, la fecha_base_oficial y hora_base_oficial se evalúan según la zona horaria IANA de la sede elegida, no según una zona global si hay varias sedes.",
        "Usa estas expresiones literalmente en el prompt para que n8n las transforme antes del AI Agent.",
        "",
        ...rows.flatMap((row) => [
            `Para sede ${row.name}:`,
            `tienes que saber que time zone es '${row.timezone}'`,
            "",
            "entonces hoy es:",
            `{{ $now.setZone('${row.timezone}').toFormat('yyyy-MM-dd') }}`,
            "",
            "entonces la hora es:",
            `{{ $now.setZone('${row.timezone}').toFormat('HH:mm') }}`,
            "",
            "Con el fin de evaluar disponibilidad, fecha pasada, no agendar hoy, horario local de sede, cupos y confirmación.",
            "",
        ]),
    ].join("\n");
};

const buildAppointmentsVariableBlock = (timezone = "America/Guayaquil", locations: any[] = []) => [
    "DATOS OPERATIVOS PARA AGENDAR CITAS",
    "",
    "fecha_base_oficial:",
    "Usa la expresión literal de la sede elegida en ZONAS HORARIAS IANA POR SEDE.",
    "traducido: YYYY-MM-DD",
    "",
    "hora_base_oficial:",
    "Usa la expresión literal de la sede elegida en ZONAS HORARIAS IANA POR SEDE.",
    "traducido: HH:mm",
    "",
    "Regla dura de salida:",
    "Estas expresiones deben ser transformadas por n8n antes de llegar al AI Agent.",
    "Si una expresión {{ ... }} llega sin transformar al AI Agent, nunca la respondas al usuario; pide o calcula una fecha concreta primero.",
    "Si el usuario dice mañana, pasado mañana, hoy o un día de la semana, primero conviértelo a fecha_cita_normalizada con formato YYYY-MM-DD usando la fecha_base_oficial de la sede elegida.",
    "Si no puedes obtener una fecha concreta, pide confirmación y no uses PLANTILLA_CONFIRMACION.",
    "",
    buildLocationTimezoneBlock(locations, timezone),
    "",
    "CONDICION_CANAL_NO_WHATSAPP:",
    "Usa esta condición cuando una línea, dato o regla deba existir solo si el lead no viene de WhatsApp.",
    "{{",
    "  (function () {",
    "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
    "    const channel = raw.replace('Channel::', '').toLowerCase();",
    "    const isWhatsapp = channel.includes('whatsapp');",
    "    if (isWhatsapp) return '';",
    "    return 'Esta condición aplica porque el lead no viene de WhatsApp.';",
    "  })()",
    "}}",
    "",
    "ORDEN_DATOS_POR_CANAL:",
    "{{",
    "  (function () {",
    "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
    "    const channel = raw.replace('Channel::', '').toLowerCase();",
    "    const isWhatsapp = channel.includes('whatsapp');",
    "    if (isWhatsapp) {",
    "      return 'Pedir solo el dato faltante, en este orden: nombre y apellido, fecha, hora.';",
    "    }",
    "    return 'Pedir solo el dato faltante, en este orden: nombre y apellido, teléfono cuando aplique por canal, fecha, hora.';",
    "  })()",
    "}}",
    "",
    "sede_confirmada: sede, agencia o sucursal elegida por el lead.",
    "ciudad_o_zona: ciudad, zona, sector o referencia detectada.",
    "referencia_ubicacion: texto libre de referencia geografica.",
    "fecha_cita, hora_cita: valores entregados por el lead.",
    "fecha_cita_normalizada: fecha concreta en formato YYYY-MM-DD.",
    "hora_cita_normalizada: hora concreta en formato HH:mm.",
    "dia_semana: dia calculado para validar horario de la sede.",
    "horario_sede_texto: horario confirmado de la sede seleccionada.",
    "appointment_timezone o time_zone: zona horaria IANA de la sede elegida, por ejemplo America/Guayaquil, Europe/Madrid o America/New_York.",
    "",
    "CITAS_AGENDADAS:",
    "{{",
    "  (() => {",
    "    const items = $('Bring records of all appointments already scheduled from the current date onwards').all();",
    "    const citasRaw = items.map(i => i.json ?? {});",
    "    const pad2 = (n) => String(n).padStart(2, '0');",
    "    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];",
    "    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];",
    "    const clean = (value, fallback = '') => {",
    "      const text = String(value ?? '').trim();",
    "      if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return fallback;",
    "      return text;",
    "    };",
    "    const formatFecha = (fechaISO) => {",
    "      const ymd = String(fechaISO ?? '').slice(0, 10);",
    "      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(ymd)) return null;",
    "      const [y, m, d] = ymd.split('-').map(Number);",
    "      if (!y || !m || !d) return null;",
    "      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));",
    "      if (Number.isNaN(dt.getTime())) return null;",
    "      return `${dias[dt.getUTCDay()]}, ${d} de ${meses[m - 1]} de ${y}`;",
    "    };",
    "    const formatHora = (hora) => {",
    "      const text = String(hora ?? '').trim();",
    "      if (!text || text.toLowerCase() === 'null') return null;",
    "      const match = text.match(/^(\\d{1,2}):(\\d{2})/);",
    "      return match ? `${pad2(match[1])}:${match[2]}` : null;",
    "    };",
    "    const citas = citasRaw",
    "      .map(c => ({",
    "        sede: clean(c.agency || c.sede || c.Sede || c.agencia, 'Sede no registrada'),",
    "        fecha: formatFecha(c.appointment_date || c.fecha_cita || c.fecha || c.fechaCita),",
    "        hora: formatHora(c.appointment_time || c.hora_cita || c.hora || c.horaCita),",
    "        timezone: clean(c.appointment_timezone || c.time_zone, 'Zona horaria no registrada'),",
    "      }))",
    "      .filter(c => c.sede && c.fecha && c.hora);",
    "    if (!citas.length) return 'No existen citas agendadas por el momento.';",
    "    const timezones = [...new Set(citas.map(c => c.timezone).filter(tz => tz && tz !== 'Zona horaria no registrada'))];",
    "    const hasMultipleTimezones = timezones.length > 1;",
    "    return citas.map((c, i) => `${i + 1}. ${c.sede}\\n   Fecha: ${c.fecha}\\n   Hora local de la sede: ${c.hora}` + (hasMultipleTimezones ? `\\n   Zona horaria: ${c.timezone}` : '')).join('\\n\\n');",
    "  })()",
    "}}",
    "",
    "LISTA_MIS_CITAS:",
    "{{",
    "(() => {",
    "// 1) Variables actuales",
    "const variables = $('Variables').first().json;",
    "",
    "const normalize = (value) => String(value ?? '')",
    ".replace(/\\s+/g, '')",
    ".trim();",
    "",
    "const getConversationIdOnly = (value) => {",
    "const text = normalize(value);",
    "",
    "// Si viene como project_id::conversation_id, toma solo conversation_id",
    "if (text.includes('::')) {",
    "return text.split('::').pop();",
    "}",
    "",
    "return text;",
    "};",
    "",
    "const currentProjectId = normalize(variables.project_id);",
    "const currentConversationId = getConversationIdOnly(variables.conversation_id);",
    "",
    "// 2) Traer y filtrar citas SOLO de ese usuario/conversation_id",
    "const citas = $('Bring records of all appointments already scheduled from the current date onwards')",
    ".all()",
    ".map(i => i.json ?? {})",
    ".filter(c => {",
    "const rowProjectId = normalize(c.project_id);",
    "const rowConversationId = getConversationIdOnly(c.conversation_id);",
    "",
    "const sameProject =",
    "!rowProjectId || !currentProjectId || rowProjectId === currentProjectId;",
    "",
    "const sameConversation =",
    "rowConversationId === currentConversationId;",
    "",
    "return c && c.id && sameProject && sameConversation;",
    "});",
    "",
    "// 3) Si no hay citas",
    "if (!citas.length) {",
    "return 'Actualmente no tienes citas agendadas.';",
    "}",
    "",
    "// 4) Helpers de formato",
    "const diasLong = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];",
    "const mesesLong = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];",
    "",
    "const clean = (value, fallback = 'No registrado') => {",
    "const text = String(value ?? '').trim();",
    "",
    "if (",
    "!text ||",
    "text.toLowerCase() === 'null' ||",
    "text.toLowerCase() === 'undefined'",
    ") {",
    "return fallback;",
    "}",
    "",
    "return text;",
    "};",
    "",
    "const formatFechaLong = (fechaISO) => {",
    "const ymd = String(fechaISO ?? '').slice(0, 10);",
    "",
    "if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(ymd)) {",
    "return 'Fecha no registrada';",
    "}",
    "",
    "const [y, m, d] = ymd.split('-').map(Number);",
    "",
    "// UTC al mediodía para evitar desfase",
    "const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));",
    "const dow = diasLong[dt.getUTCDay()];",
    "",
    "return `${dow}, ${String(d).padStart(2, '0')} de ${mesesLong[m - 1]} de ${y}`;",
    "};",
    "",
    "const formatHora = (hora) => {",
    "const text = String(hora ?? '').trim();",
    "",
    "if (!text) return 'Hora no registrada';",
    "",
    "const match = text.match(/\\b(\\d{1,2}):(\\d{2})/);",
    "",
    "if (!match) return text;",
    "",
    "return `${String(match[1]).padStart(2, '0')}:${match[2]}`;",
    "};",
    "",
    "// 5) Detectar si este usuario tiene citas en más de una zona horaria",
    "const timezones = [",
    "...new Set(",
    "citas",
    ".map(c => clean(c.appointment_timezone, ''))",
    ".filter(Boolean)",
    ")",
    "];",
    "",
    "const hasMultipleTimezones = timezones.length > 1;",
    "",
    "// 6) Construir salida",
    "return citas",
    ".map((c, idx) => {",
    "const sede = clean(c.agency || c.sede || c.agencia, 'Sede no registrada');",
    "const fecha = formatFechaLong(c.appointment_date || c.fecha_cita || c.fecha);",
    "const hora = formatHora(c.appointment_time || c.hora_cita || c.hora);",
    "const timezone = clean(c.appointment_timezone, 'Zona horaria no registrada');",
    "",
    "return `${idx + 1}. ${sede}\\n` +",
    "`   Fecha: ${fecha}\\n` +",
    "`   Hora local de la sede: ${hora}` +",
    "(hasMultipleTimezones ? `\\n   Zona horaria: ${timezone}` : '');",
    "})",
    ".join('\\n\\n');",
    "})()",
    "}}",
].join("\n");

const buildMeetingsVariableBlock = (businessTimezone = "America/Guayaquil") => [
    "DATOS OPERATIVOS PARA AGENDAR REUNIONES",
    "",
    "IMPORTANTE PARA REUNIONES:",
    "business_timezone representa la zona horaria oficial del negocio o calendario comercial.",
    "requester_timezone representa la zona horaria IANA del usuario que agenda, inferida desde ciudad, estado/provincia si aplica y país.",
    "La hora que escriba el usuario se interpreta en requester_timezone y luego se convierte a business_timezone para validar disponibilidad y guardar la reunión.",
    "appointment_date y appointment_time se guardan siempre en horario del negocio, junto con business_timezone.",
    "requester_timezone se conserva para mostrar al usuario la reunión en su hora local.",
    "",
    `business_timezone: ${businessTimezone}`,
    "requester_timezone: zona horaria IANA inferida desde la ubicación del usuario.",
    "requester_city, requester_region, requester_country: ubicación natural indicada por el usuario.",
    "",
    "fecha_base_oficial:",
    `{{ $now.setZone('${businessTimezone}').toFormat('yyyy-MM-dd') }}`,
    "traducido: YYYY-MM-DD",
    "",
    "hora_base_oficial:",
    `{{ $now.setZone('${businessTimezone}').toFormat('HH:mm') }}`,
    "traducido: HH:mm",
    "",
    "producto_interes, necesidad_principal, volumen_o_frecuencia, rango_inversion: filtros comerciales previos a la reunion.",
    "lead_clasificacion: A, B o C segun fit comercial. No mostrar al usuario.",
    "fecha_reunion, hora_reunion: valores entregados por el lead, interpretados primero en requester_timezone.",
    "fecha_reunion_normalizada_usuario, hora_reunion_normalizada_usuario: fecha/hora concretas en requester_timezone.",
    "fecha_reunion_normalizada, hora_reunion_normalizada: fecha/hora convertidas a business_timezone para validar y guardar.",
    "fecha_usuario, hora_usuario: fecha/hora que se muestran al usuario en requester_timezone.",
    "fecha_negocio, hora_negocio: fecha/hora que se guardan y validan en business_timezone.",
    "inicio_evento, fin_evento: datetimes ISO en business_timezone para calendario.",
    "descripcion_evento: resumen interno para calendario y equipo comercial.",
    "",
    "CONDICION_CANAL_NO_WHATSAPP:",
    "{{",
    "  (function () {",
    "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
    "    const channel = raw.replace('Channel::', '').toLowerCase();",
    "    const isWhatsapp = channel.includes('whatsapp');",
    "    if (isWhatsapp) return '';",
    "    return 'Esta condicion aplica porque el lead no viene de WhatsApp.';",
    "  })()",
    "}}",
    "",
    "REUNIONES_AGENDADAS:",
    "{{",
    "  (function () {",
    "    const rows = $('Bring records of all appointments already scheduled from the current date onwards')",
    "      .all()",
    "      .map(item => item.json ?? {})",
    "      .filter(row => row && row.id);",
    "",
    "    if (!rows.length) {",
    "      return 'Actualmente no existen reuniones futuras agendadas en la base de datos.';",
    "    }",
    "",
    "    function clean(value, fallback = '') {",
    "      const text = String(value ?? '').trim();",
    "      if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return fallback;",
    "      return text;",
    "    }",
    "",
    "    function hasValue(value) {",
    "      return clean(value, '') !== '';",
    "    }",
    "",
    "    function isValidTimeZone(timeZone) {",
    "      try {",
    "        new Intl.DateTimeFormat('en-US', { timeZone });",
    "        return true;",
    "      } catch (e) {",
    "        return false;",
    "      }",
    "    }",
    "",
    "    function getDateParts(value) {",
    "      const raw = String(value ?? '').slice(0, 10);",
    "      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return null;",
    "      const [year, month, day] = raw.split('-').map(Number);",
    "      return { year, month, day };",
    "    }",
    "",
    "    function getTimeParts(value) {",
    "      const text = String(value ?? '').trim();",
    "      const match = text.match(/\\b(\\d{1,2}):(\\d{2})/);",
    "      if (!match) return null;",
    "      return { hour: Number(match[1]), minute: Number(match[2]) };",
    "    }",
    "",
    "    function getOffsetMs(timeZone, date) {",
    "      const parts = new Intl.DateTimeFormat('en-CA', {",
    "        timeZone,",
    "        year: 'numeric',",
    "        month: '2-digit',",
    "        day: '2-digit',",
    "        hour: '2-digit',",
    "        minute: '2-digit',",
    "        second: '2-digit',",
    "        hour12: false,",
    "        hourCycle: 'h23'",
    "      }).formatToParts(date);",
    "      const get = (type) => parts.find(p => p.type === type)?.value;",
    "      const localAsUtc = Date.UTC(",
    "        Number(get('year')),",
    "        Number(get('month')) - 1,",
    "        Number(get('day')),",
    "        Number(get('hour')),",
    "        Number(get('minute')),",
    "        Number(get('second'))",
    "      );",
    "      return localAsUtc - date.getTime();",
    "    }",
    "",
    "    function businessLocalToUtcDate(dateValue, timeValue, businessTimezone) {",
    "      const dateParts = getDateParts(dateValue);",
    "      const timeParts = getTimeParts(timeValue);",
    "      if (!dateParts || !timeParts || !isValidTimeZone(businessTimezone)) return null;",
    "      const localAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute, 0);",
    "      let utcMs = localAsUtc;",
    "      for (let i = 0; i < 2; i++) {",
    "        const offsetMs = getOffsetMs(businessTimezone, new Date(utcMs));",
    "        utcMs = localAsUtc - offsetMs;",
    "      }",
    "      return new Date(utcMs);",
    "    }",
    "",
    "    function formatDateInZone(date, timeZone) {",
    "      if (!date || !isValidTimeZone(timeZone)) return 'Fecha no registrada';",
    "      return new Intl.DateTimeFormat('es-EC', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);",
    "    }",
    "",
    "    function formatTimeInZone(date, timeZone) {",
    "      if (!date || !isValidTimeZone(timeZone)) return 'Hora no registrada';",
    "      return new Intl.DateTimeFormat('es-EC', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' }).format(date);",
    "    }",
    "",
    "    return rows.map((r, index) => {",
    "      const businessTimezone = clean(r.business_timezone);",
    "      const requesterTimezone = clean(r.requester_timezone);",
    "      const meetingUtcDate = businessLocalToUtcDate(r.appointment_date, r.appointment_time, businessTimezone);",
    "      const fechaNegocio = formatDateInZone(meetingUtcDate, businessTimezone);",
    "      const horaNegocio = formatTimeInZone(meetingUtcDate, businessTimezone);",
    "      const fechaUsuario = requesterTimezone ? formatDateInZone(meetingUtcDate, requesterTimezone) : '';",
    "      const horaUsuario = requesterTimezone ? formatTimeInZone(meetingUtcDate, requesterTimezone) : '';",
    "",
    "      const lines = [",
    "        `${index + 1}. Reunión comercial`,",
    "        `   ID: ${clean(r.id, 'No registrado')}`,",
    "        `   Project ID: ${clean(r.project_id, 'No registrado')}`,",
    "        `   Conversation ID: ${clean(r.conversation_id, 'No registrado')}`,",
    "        `   Fecha negocio: ${fechaNegocio}`,",
    "        `   Hora negocio: ${horaNegocio}`,",
    "        `   Zona horaria negocio: ${clean(businessTimezone, 'No registrada')}`",
    "      ];",
    "",
    "      if (fechaUsuario && horaUsuario) {",
    "        lines.push(`   Fecha usuario: ${fechaUsuario}`);",
    "        lines.push(`   Hora usuario: ${horaUsuario}`);",
    "      }",
    "      if (hasValue(requesterTimezone)) lines.push(`   Zona horaria usuario: ${requesterTimezone}`);",
    "      if (hasValue(r.full_name || r.nombre || r.NombreCompleto)) lines.push(`   Nombre: ${clean(r.full_name || r.nombre || r.NombreCompleto)}`);",
    "      if (hasValue(r.email || r.correo)) lines.push(`   Correo: ${clean(r.email || r.correo)}`);",
    "      if (hasValue(r.product || r.producto)) lines.push(`   Producto: ${clean(r.product || r.producto)}`);",
    "      if (hasValue(r.phone || r.telefono || r.celular)) lines.push(`   Teléfono: ${clean(r.phone || r.telefono || r.celular)}`);",
    "      if (hasValue(r.identification || r.identificacion)) lines.push(`   Identificación: ${clean(r.identification || r.identificacion)}`);",
    "      if (hasValue(r.age || r.edad)) lines.push(`   Edad: ${clean(r.age || r.edad)}`);",
    "      return lines.join('\\n');",
    "    }).join('\\n\\n');",
    "  })()",
    "}}",
    "",
    "LISTA_MIS_REUNIONES_CONSULTA:",
    "{{",
    "  (function () {",
    "    const variables = $('Variables').first().json;",
    "    const normalize = (value) => String(value ?? '').replace(/\\s+/g, '').trim();",
    "    const getRawConversationId = (value) => {",
    "      const text = normalize(value);",
    "      if (text.includes('::')) return text.split('::').pop();",
    "      return text;",
    "    };",
    "    const currentProjectId = normalize(variables.project_id);",
    "    const currentConversationId = getRawConversationId(variables.conversation_id);",
    "    const rows = $('Bring records of all appointments already scheduled from the current date onwards')",
    "      .all()",
    "      .map(item => item.json ?? {})",
    "      .filter(row => {",
    "        const rowProjectId = normalize(row.project_id);",
    "        const rowConversationId = getRawConversationId(row.conversation_id);",
    "        const sameProject = !rowProjectId || !currentProjectId || rowProjectId === currentProjectId;",
    "        const sameConversation = rowConversationId === currentConversationId;",
    "        return row && row.id && sameProject && sameConversation;",
    "      });",
    "    if (!rows.length) return 'Actualmente no tiene reuniones agendadas.';",
    "",
    "    function clean(value, fallback = '') {",
    "      const text = String(value ?? '').trim();",
    "      if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return fallback;",
    "      return text;",
    "    }",
    "    function hasValue(value) { return clean(value, '') !== ''; }",
    "    function isValidTimeZone(timeZone) { try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch (e) { return false; } }",
    "    function getDateParts(value) {",
    "      const raw = String(value ?? '').slice(0, 10);",
    "      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return null;",
    "      const [year, month, day] = raw.split('-').map(Number);",
    "      return { year, month, day };",
    "    }",
    "    function getTimeParts(value) {",
    "      const text = String(value ?? '').trim();",
    "      const match = text.match(/\\b(\\d{1,2}):(\\d{2})/);",
    "      if (!match) return null;",
    "      return { hour: Number(match[1]), minute: Number(match[2]) };",
    "    }",
    "    function getOffsetMs(timeZone, date) {",
    "      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, hourCycle: 'h23' }).formatToParts(date);",
    "      const get = (type) => parts.find(p => p.type === type)?.value;",
    "      const localAsUtc = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')), Number(get('minute')), Number(get('second')));",
    "      return localAsUtc - date.getTime();",
    "    }",
    "    function businessLocalToUtcDate(dateValue, timeValue, businessTimezone) {",
    "      const dateParts = getDateParts(dateValue);",
    "      const timeParts = getTimeParts(timeValue);",
    "      if (!dateParts || !timeParts || !isValidTimeZone(businessTimezone)) return null;",
    "      const localAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute, 0);",
    "      let utcMs = localAsUtc;",
    "      for (let i = 0; i < 2; i++) utcMs = localAsUtc - getOffsetMs(businessTimezone, new Date(utcMs));",
    "      return new Date(utcMs);",
    "    }",
    "    function formatDateInZone(date, timeZone) {",
    "      if (!date || !isValidTimeZone(timeZone)) return 'Fecha no registrada';",
    "      return new Intl.DateTimeFormat('es-EC', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);",
    "    }",
    "    function formatTimeInZone(date, timeZone) {",
    "      if (!date || !isValidTimeZone(timeZone)) return 'Hora no registrada';",
    "      return new Intl.DateTimeFormat('es-EC', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' }).format(date);",
    "    }",
    "    return rows.map((r, index) => {",
    "      const businessTimezone = clean(r.business_timezone);",
    "      const requesterTimezone = clean(r.requester_timezone);",
    "      const meetingUtcDate = businessLocalToUtcDate(r.appointment_date, r.appointment_time, businessTimezone);",
    "      const fechaUsuario = requesterTimezone ? formatDateInZone(meetingUtcDate, requesterTimezone) : 'Fecha no registrada';",
    "      const horaUsuario = requesterTimezone ? formatTimeInZone(meetingUtcDate, requesterTimezone) : 'Hora no registrada';",
    "      const lines = [`${index + 1}. Reunión comercial`, `   📅 Fecha: ${fechaUsuario}`, `   🕒 Hora: ${horaUsuario}`];",
    "      if (hasValue(r.email || r.correo)) lines.push(`   📩 Correo: ${clean(r.email || r.correo)}`);",
    "      if (hasValue(r.product || r.producto)) lines.push(`   Producto: ${clean(r.product || r.producto)}`);",
    "      if (hasValue(r.phone || r.telefono || r.celular)) lines.push(`   Número celular: ${clean(r.phone || r.telefono || r.celular)}`);",
    "      if (hasValue(r.identification || r.identificacion)) lines.push(`   Identificación: ${clean(r.identification || r.identificacion)}`);",
    "      if (hasValue(r.age || r.edad)) lines.push(`   Edad: ${clean(r.age || r.edad)}`);",
    "      return lines.join('\\n');",
    "    }).join('\\n\\n');",
    "  })()",
    "}}",
].join("\n");

const buildUniversalTemplates = (
    businessName: string,
    valueProposition: string,
    lopdpText: string,
    options?: { isAppointments?: boolean; locationTerm?: string; emojiMode?: string; appointmentLocationInstruction?: string; appointmentLocationQuestion?: string },
) => {
    const isAppointments = Boolean(options?.isAppointments);
    const locationTerm = options?.locationTerm || "sedes";
    const valueText = sourceText(valueProposition, "Podemos ayudarle con información y agendamiento según su necesidad.").replace(/\n/g, " ");
    const locationQuestion = options?.appointmentLocationQuestion || `¿En cuál de nuestras ${locationTerm} le gustaría agendar su cita?`;
    const personalizedLopdp = lopdpText.includes("[nombre]")
        ? lopdpText
        : lopdpText.replace("¡Recuerde!", "¡Recuerde [nombre]!");
    const interestedContent = isAppointments
        ? `${withTemplateEmoji(options?.emojiMode, "ok", "¡Qué bueno saber que le interesa [nombre]!")}\\n\n${valueText}\\n\n${options?.appointmentLocationInstruction || `Para ayudarle a agendar correctamente, necesito confirmar la ${locationTerm} donde desea atenderse.`}\\n\n${locationQuestion}\\n`
        : `${withTemplateEmoji(options?.emojiMode, "ok", "¡Qué bueno saber que le interesa [nombre]!")}\\n\nPara orientarle mejor, puedo hacerle unas preguntas rápidas y luego ayudarle a agendar una reunión comercial.\\n`;

    return [
        {
            name: "PLANTILLA_LOPDP",
            content: `${personalizedLopdp}\\n`,
        },
        {
            name: "PLANTILLA_NO_INTERES",
            content: `Apreciamos mucho su tiempo [nombre].\\n\nSi en otra ocasión desea conocer más sobre nuestros servicios, será un placer atenderle.\\n\n${businessName} siempre estará a su disposición.\\n`,
        },
        {
            name: "PLANTILLA_CLIENTE_INTERESADO",
            content: interestedContent,
        },
        {
            name: "PLANTILLA_AGRADECIMIENTO_UTIL",
            content: `${withTemplateEmoji(options?.emojiMode, "ok", "Con mucho gusto [nombre].")}\\n\nMe alegra haberle podido ayudar con la información que necesita.\\n\nSi en algún momento desea más detalles o tiene nuevas preguntas, no dude en volver a contactarnos.\\n\nEstaremos listos para ayudarle.\\n`,
        },
        {
            name: "PLANTILLA_AGRADECIMIENTO_LIMITADO",
            content: `Agradecemos su contacto [nombre].\\n\nSi en algún momento desea más detalles o tiene nuevas preguntas, no dude en volver a contactarnos.\\n\nEstaremos listos para ayudarle.\\n`,
        },
        {
            name: "PLANTILLA_LENGUAJE_OFENSIVO_CIERRE",
            content: `Disculpe [nombre], esperamos poder servirle en otra ocasión.\\n\nGracias por contactar a ${businessName}. Hasta luego.\\n`,
        },
        {
            name: "PLANTILLA_EQUIVOCACION_CHAT",
            content: `Agradecemos su contacto [nombre].\\n\nNo se preocupe, entendemos que pudo ser una equivocación.\\n\nSi en otro momento necesita información sobre ${businessName}, estaremos listos para ayudarle.\\n`,
        },
        {
            name: "PLANTILLA_NO_APLICA",
            content: `¡Hola [nombre]! Gracias por su mensaje.\\n\nLe contamos que ${valueText}\\n\nParece que su consulta no corresponde a los servicios de ${businessName}, pero si desea información relacionada con nuestra atención o agendamiento, estaremos listos para ayudarle.\\n\n¡Hasta pronto!\\n`,
        },
        {
            name: "PLANTILLA_NO_AYUDA",
            content: `Estimad@ [nombre], entendemos que está pasando una situación difícil.\\n\nLamentamos no poder ayudarle por el momento. Sin embargo, si necesita información adicional con gusto podemos ayudarle.\\n\nSaludos.\\n`,
        },
        {
            name: "PLANTILLA_CLIENTE_TIENE_DUDAS",
            content: `Entiendo [nombre] que tiene dudas y prefiere conversar con un asesor.\\n\nUno de nuestros agentes se pondrá en contacto con usted muy pronto para asistirle directamente.\\n\nGracias por su paciencia y confianza en ${businessName}.\\n`,
        },
    ];
};

const buildAppointmentTemplates = (
    businessName: string,
    locationTerm: string,
    leadFields: any[],
    lopdpText: string,
    options?: {
        agenda?: any;
        emojiMode?: string;
        locationListingLines?: string;
        locationStrategy?: ReturnType<typeof buildAppointmentLocationStrategy>;
    },
) => {
    const enabledFields = leadFields.filter((field: any) => field.enabled);
    const phoneField = enabledFields.find((field: any) => field.fieldKey === "phone");
    const welcomeFields = enabledFields.filter((field: any) => field.captureTiming === "conversation_start");
    const welcomeBlockingFields = welcomeFields.filter((field: any) => field.required && field.blocksEarlyFlow);
    const welcomeFieldLines = welcomeFields.map(buildLeadFieldRequestLine).filter(Boolean).join("");
    const welcomeBlockingMissingLines = welcomeBlockingFields.map(buildLeadFieldMissingLine).filter(Boolean).join("");
    const appointmentDataFieldLines = enabledFields
        .map(buildLeadFieldRequestLine)
        .filter(Boolean)
        .join("");
    const requiredMissingLines = enabledFields
        .filter((field: any) => field.required)
        .map(buildLeadFieldMissingLine)
        .filter(Boolean)
        .join("");
    const confirmationExtraLines = enabledFields
        .filter((field: any) => !["full_name", "phone"].includes(field.fieldKey))
        .map((field: any) => `• ${leadFieldConfirmationLabel(field)}: [${leadFieldConfirmationPlaceholder(field)}] \\n`)
        .join("");
    const phoneConfirmationLine = phoneField ? (phoneField.required ? "• Número celular: [celular] \\n" : [
        "{{",
        "  (function () {",
        "    const raw = $('Webhook').first().json.body?.conversation?.channel ?? '';",
        "    const channel = raw.replace('Channel::', '').toLowerCase();",
        "    const shouldAskPhone = ['facebookpage', 'instagram', 'webwidget', 'tiktok'].includes(channel);",
        "    return ($json.celular && shouldAskPhone) ? '• Número celular: [celular] \\\\n' : '';",
        "  })()",
        "}}",
    ].join("\n")) : "";
    const agenda = options?.agenda || {};
    const interval = Number(agenda.start_interval_minutes || agenda.startIntervalMinutes || 30);
    const timezone = agenda.timezone || "America/Guayaquil";
    const locationListing = options?.locationListingLines || "{listado_agencias_con_formato}";
    const strategy = options?.locationStrategy || buildAppointmentLocationStrategy([]);
    const locationQuestion = strategy.promptQuestion || `¿En cuál de nuestras ${locationTerm} le gustaría agendar su cita?`;
    const shouldAskCity = strategy.mode === "ask_city_first";
    const cityTemplateContent = shouldAskCity
        ? `Es un gusto atenderle [nombre] desde ${businessName}.\\n\nContamos con varias ${locationTerm} para su mayor comodidad.\\n\n¿Me indica desde qué ciudad nos escribe para guiarle mejor?\\n`
        : `Es un gusto atenderle [nombre] desde ${businessName}.\\n\nTenemos estas ${locationTerm} para su mayor comodidad:\\n\n${locationListing}\\n\n${locationQuestion}\\n`;
    const locationsWithoutCityContent = shouldAskCity
        ? `Con mucho gusto [nombre]. Contamos con varias ${locationTerm}.\\n\nPara ayudarle mejor, ¿desde qué ciudad, sector o referencia nos escribe?\\n`
        : `Con mucho gusto [nombre]. Estas son nuestras ${locationTerm} disponibles:\\n\n${locationListing}\\n\n${locationQuestion}\\n`;
    const appointmentDataLines = `${appointmentDataFieldLines}• Fecha de Visita\\n• Hora de Visita\\n`;
    const incompleteDataLines = `${requiredMissingLines}{{ !$json.fecha_cita && !$json.fecha ? '• La fecha en que desea visitarnos\\n' : '' }}{{ !$json.hora_cita && !$json.hora ? '• La hora en que desea visitarnos\\n' : '' }}`;
    const welcomeContent = welcomeFields.length
        ? `${withTemplateEmoji(options?.emojiMode, "welcome", `Bienvenido a ${businessName}.`)}\\n\nPara brindarle información detallada y una atención personalizada, necesitamos los siguientes datos:\\n\n${welcomeFieldLines}`
        : `${withTemplateEmoji(options?.emojiMode, "welcome", `Bienvenido a ${businessName}.`)}\\n\nPuedo ayudarle a elegir la ${locationTerm} más conveniente y dejar encaminada su cita de forma rápida y ordenada.\\n\n${locationQuestion}\\n`;
    const welcomeMissingContent = welcomeBlockingFields.length
        ? `¡Gracias por compartir su información!\\n\nPara dejar todo listo, aún necesito:\\n\n${welcomeBlockingMissingLines}\\nCuando tenga esa información, compártala por aquí.\\n`
        : `¡Gracias por compartir su información!\\n\nNo existen datos bloqueantes pendientes al inicio. Puedo continuar con información del negocio y volver a pedir los datos obligatorios antes de confirmar la cita.\\n`;
    return [
        { name: "PLANTILLA_BIENVENIDA", content: welcomeContent },
        { name: "PLANTILLA_BIENVENIDA_FALTAN_DATOS", content: welcomeMissingContent },
        { name: "PLANTILLA_BIENVENIDA_CON_DATOS", content: `${lopdpText}\\n\n${withTemplateEmoji(options?.emojiMode, "ok", "Perfecto [nombre], ya tengo sus datos iniciales.")}\\n\nAhora puedo ayudarle a elegir la ${locationTerm} y revisar una fecha y hora disponible para su cita.\\n\n${locationQuestion}\\n` },
        { name: "PLANTILLA_BIENVENIDA_SIN_DATOS", content: `${withTemplateEmoji(options?.emojiMode, "welcome", `¡Qué gusto saludarle! Muchas gracias por ponerse en contacto con ${businessName}.`)}\\n\nPuedo ayudarle con información del negocio y guiarle hacia el agendamiento de su cita.\\n\n${locationQuestion}\\n` },
        { name: "PLANTILLA_INTERES_CON_CIUDAD", content: `¡Excelente! Me alegra que le interese [nombre].\\n\nComo ya tenemos su ciudad o zona, puedo mostrarle las ${locationTerm} disponibles para que elija la que le quede mejor.\\n\n¿Desea que le muestre las ${locationTerm} ahora?\\n` },
        { name: "PLANTILLA_INTERES_CON_AGENCIA", content: `¡Perfecto! Me alegra que le interese [nombre] y que ya tengamos su ${locationTerm}.\\n\nSi está listo, puedo tomar sus datos para agendar su cita de inmediato.\\n\n¿Desea que avancemos con el agendamiento?\\n` },
        { name: "PLANTILLA_CIUDADES", content: cityTemplateContent },
        { name: "PLANTILLA_SECTOR_MATCH_CIUDAD_DEDUCIDA", content: `Gracias por compartir su ubicación [nombre].\\n\nPor la referencia indicada, su zona corresponde a {zona_deducida}.\\n\nEstas son nuestras ${locationTerm} en esa zona:\\n\n{listado_agencias_con_formato}\\n\n¿En cuál ${locationTerm} prefiere agendar?\\n` },
        { name: "PLANTILLA_UBICACION_DESCONOCIDA", content: `Gracias por compartir su ubicación [nombre].\\n\nActualmente no identifico una ${locationTerm} exacta para esa referencia.\\n\n{listado_agencias_con_formato}\\n\n¿En cuál de estas ${locationTerm} le gustaría agendar su cita?\\n` },
        { name: "PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA", content: `Gracias por compartir su ubicación [nombre].\\n\nPor ahora no contamos con una ${locationTerm} registrada directamente en esa ciudad o sector.\\n\n{listado_agencias_con_formato}\\n\n¿En cuál de estas ${locationTerm} le gustaría agendar su cita?\\n` },
        { name: "PLANTILLA_CIUDAD_SIN_AGENCIA", content: `Gracias por compartir su ubicación [nombre].\\n\nActualmente no tenemos una ${locationTerm} registrada directamente en {ciudad_no_cubierta}.\\n\n{listado_agencias_con_formato}\\n\n¿En cuál de estas ${locationTerm} le gustaría agendar su cita?\\n` },
        { name: "PLANTILLA_CIUDAD_SIN_AGENCIA_INSISTE", content: `Gracias por confirmar que se encuentra en {ciudad_no_cubierta} [nombre].\\n\nPor ahora no contamos con una ${locationTerm} registrada directamente en esa ciudad.\\n\n{listado_agencias_con_formato}\\n\nEsperamos pronto poder estar en su ciudad.\\n\n${businessName} siempre a su disposición.\\n` },
        { name: "PLANTILLA_UBICACIONES_SIN_CIUDAD", content: locationsWithoutCityContent },
        { name: "PLANTILLA_UBICACIONES_CON_CIUDAD", content: `Con mucho gusto [nombre]. Estas son nuestras ${locationTerm} en {zona_o_ciudad}:\\n\n{listado_agencias_con_formato}\\n\n¿En qué ${locationTerm} desea agendar su cita?\\n` },
        { name: "PLANTILLA_REFERENCIA_CERCANA_SIN_CIUDAD", content: `¡Gracias por compartir su ubicación de referencia [nombre]!\\n\nPara ayudarle mejor, ¿podría confirmarme desde qué ciudad nos escribe?\\n\nAsí podré mostrarle todas las ${locationTerm} disponibles en su zona.\\n` },
        { name: "PLANTILLA_REFERENCIA_MATCH", content: `¡Gracias por compartir su ubicación [nombre]!\\n\nPor la referencia que nos da, la ${locationTerm} más cercana sería:\\n\n• [Nombre de la sede]\\nDirección: [dirección completa]\\nHorario: [horario de atención]\\nGoogle Maps: [Google maps link]\\n\n¿Desea agendar su cita en esta ${locationTerm}?\\n` },
        { name: "PLANTILLA_DATOS_CITA", content: `${withTemplateEmoji(options?.emojiMode, "calendar", `¡${businessName}! Encantados de atenderle [nombre]`)}\\n\nPara agendar su cita y brindarle una atención segura y personalizada, necesitamos los siguientes datos:\\n\n${appointmentDataLines}\\n¡Compártanos esta información y le agendamos su cita hoy mismo!\\n` },
        { name: "PLANTILLA_DATOS_INCOMPLETOS", content: `¡Gracias por compartir su información [nombre]!\\n\nPara dejar todo listo, aún necesito:\\n\n${incompleteDataLines}\\n\nCuando tenga esa información, compártala por aquí y dejamos su cita confirmada.\\n` },
        { name: "PLANTILLA_FECHA_PASADA", content: `Entiendo, con gusto le ayudo [nombre].\\n\nSolo un detalle: no puedo agendar en una fecha pasada.\\n\nHoy es [fecha_base_oficial] en la zona horaria [time_zone] de la sede seleccionada.\\n\n¿Para qué fecha desea agendar su cita? Puede ser desde mañana o un día posterior.\\n` },
        { name: "PLANTILLA_NO_AGENDAR_HOY", content: `Gracias por su interés [nombre].\\n\nPor organización de agenda, las citas de ${businessName} no se agendan para el mismo día.\\n\nPuedo ayudarle a revisar disponibilidad desde mañana o desde el siguiente día hábil disponible.\\n\n¿Le gustaría que revisemos una fecha disponible desde [siguiente_dia_habil]?\\n` },
        { name: "PLANTILLA_DIA_NO_HABIL", content: `Gracias por indicarlo [nombre].\\n\nLa ${locationTerm} [agencia] no atiende el día seleccionado según su horario confirmado.\\n\nLe puedo ayudar a revisar disponibilidad desde [siguiente_dia_habil].\\n` },
        { name: "PLANTILLA_HORA_INTERVALO", content: `Gracias, [nombre].\\n\nEn ${businessName} las citas se agendan únicamente respetando intervalos de ${interval} minutos.\\n\nLa hora que indicó, [hora_indicada], no está disponible porque no coincide con el intervalo configurado.\\n\nPara ayudarle, puede elegir una de estas opciones:\\n\n• [opcion_1]\\n• [opcion_2]\\n• [opcion_3]\\n\n¿Cuál le funciona?\\n` },
        { name: "PLANTILLA_HORA_FUERA_DE_ATENCION", content: `Gracias por compartir su interés [nombre] en agendar a las [hora_indicada].\\n\nSin embargo, la ${locationTerm} [agencia] atiende únicamente en el horario de [horario_agencia].\\n\nPara ayudarle, le sugiero [sugerencia_cercana]. ¿Le funciona esa hora?\\n` },
        { name: "PLANTILLA_HORA_OCUPADA", content: `¡Gracias, [nombre]!\\n\nPara la ${locationTerm} [agencia], ya tenemos una cita agendada el [día] a las [hora].\\n\nPara evitar conflictos, por favor elija una de estas horas disponibles para ese mismo día:\\n\n[opciones_horarias]\\n\nSi prefiere, también puedo ayudarle a agendar en otro horario o en el siguiente día hábil.\\n` },
        { name: "PLANTILLA_MIS_CITAS", content: `${withTemplateEmoji(options?.emojiMode, "calendar", "¡Claro, [nombre]!")}\\n\nEstas son las citas que tiene agendadas actualmente:\\n\n[lista_mis_citas]\\n\nSi necesita algo adicional, estoy aquí para ayudarle.\\n` },
        { name: "PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR", content: `Estas son sus citas agendadas:\\n\n[lista_mis_citas]\\n\n¿Cuál desea eliminar o cancelar?\\n\nResponda únicamente con el número de la cita, por ejemplo: 1.\\n\nNo escriba nada más, solo el número.\\n` },
        { name: "PLANTILLA_SIN_CITAS", content: `¡Gracias, [nombre]!\\n\nPor el momento no veo citas agendadas a su nombre.\\n\nSi desea, puedo ayudarle a agendar una nueva cita. ${locationQuestion}\\n` },
        { name: "PLANTILLA_NUMERO_OBLIGATORIO", content: `Para poder continuar, responda únicamente con el número de la cita que desea eliminar.\\n\nEjemplo: 1\\n\nNo escriba nada más, solo el número.\\n` },
        { name: "PLANTILLA_CANCELACION_CITA_ABORTADA", content: `Perfecto [nombre]. No se realizará ningún cambio sobre su cita.\\n\nSu cita se mantiene como estaba agendada.\\n` },
        { name: "PLANTILLA_CITA_CANCELADA", content: `Listo [nombre]. La cita seleccionada quedó marcada para cancelación.\\n\nSi desea agendar una nueva cita, puedo ayudarle a elegir la ${locationTerm} y revisar disponibilidad.\\n` },
        { name: "PLANTILLA_VISITA_SIN_CITA", content: `Comprendo perfectamente [nombre].\\n\nPuede acercarse directamente a cualquiera de nuestras ${locationTerm} en el horario de atención, si el negocio permite atención sin cita previa.\\n\nSin embargo, le recomiendo agendar su cita para asegurar una atención más rápida y organizada.\\n` },
        { name: "PLANTILLA_CONFIRMACION", content: `${lopdpText}\\n\n${withTemplateEmoji(options?.emojiMode, "ok", "Hemos recibido todos sus datos, le agradecemos mucho [nombre].")}\\n\n¡Su cita ha sido agendada con éxito!\\n\nLe esperamos el [fecha] a las [hora] en la ${locationTerm} [agencia].\\nZona horaria: [time_zone]\\n${phoneConfirmationLine}${confirmationExtraLines ? `${confirmationExtraLines}\\n` : ""}Por favor, no olvide llevar los requisitos o documentos indicados para su cita.\\n\nSerá un placer recibirle y brindarle la atención que corresponde.\\n` },
    ];
};

const buildMeetingTemplates = (
    businessName: string,
    agenda: any,
    leadFields: any[] = [],
    lopdpText = "",
    options?: { emojiMode?: string },
) => {
    const enabledFields = leadFields.filter((field: any) => field.enabled);
    const phoneField = enabledFields.find((field: any) => field.fieldKey === "phone");
    const welcomeFields = enabledFields.filter((field: any) => field.captureTiming === "conversation_start");
    const welcomeBlockingFields = welcomeFields.filter((field: any) => field.required && field.blocksEarlyFlow);
    const welcomeFieldLines = welcomeFields.map(buildLeadFieldRequestLine).filter(Boolean).join("");
    const welcomeBlockingMissingLines = welcomeBlockingFields.map(buildLeadFieldMissingLine).filter(Boolean).join("");
    const meetingDataFieldLines = enabledFields
        .map(buildLeadFieldRequestLine)
        .filter(Boolean)
        .join("");
    const requiredMissingLines = enabledFields
        .filter((field: any) => field.required)
        .map(buildLeadFieldMissingLine)
        .filter(Boolean)
        .join("");
    const dataLines = `${meetingDataFieldLines}• Fecha de Reunión\\n• Hora de Reunión\\n`;
    const requiredMissingWithOperationalLines = [
        requiredMissingLines,
        "{{ !$json.requester_timezone ? '• La ciudad, estado/provincia si aplica y país desde donde se conectará\\n' : '' }}",
        "{{ !$json.fecha_reunion ? '• La fecha en que desea agendar su reunión\\n' : '' }}",
        "{{ !$json.hora_reunion ? '• La hora en que desea agendar su reunión\\n' : '' }}",
    ].filter(Boolean).join("\n");
    const phoneConfirmationLine = phoneField ? (phoneField.required ? "• Número celular: [celular]\\n" : [
        "{{",
        "  (function () {",
        "    return ($json.celular || $json.telefono) ? '• Número celular: [celular]\\\\n' : '';",
        "  })()",
        "}}",
    ].join("\n")) : "";
    const confirmationExtraLines = enabledFields
        .filter((field: any) => !["full_name", "phone", "email"].includes(field.fieldKey))
        .map((field: any) => `• ${leadFieldConfirmationLabel(field)}: [${leadFieldConfirmationPlaceholder(field)}]\\n`)
        .join("");
    const welcomeContent = welcomeFields.length
        ? `${withTemplateEmoji(options?.emojiMode, "welcome", `Bienvenido a ${businessName}.`)}\\n\nPara brindarle información detallada y coordinar una reunión útil, necesitamos estos datos iniciales:\\n\n${welcomeFieldLines}`
        : `${withTemplateEmoji(options?.emojiMode, "welcome", `¡Qué gusto saludarle! Muchas gracias por ponerse en contacto con ${businessName}.`)}\\n\nPuedo ayudarle a entender qué solución se adapta mejor a su empresa y, si tiene sentido, agendar una reunión con nuestro equipo comercial.\\n\n¿Desea revisar la solución que mejor encaja con su empresa?\\n`;
    const welcomeMissingContent = welcomeBlockingFields.length
        ? `¡Gracias por compartir su información!\\n\nPara continuar, aún necesito:\\n\n${welcomeBlockingMissingLines}\\nCuando tenga esa información, compártala por aquí.\\n`
        : `¡Gracias por compartir su información!\\n\nNo existen datos bloqueantes pendientes al inicio. Puedo continuar con información del negocio y volver a pedir los datos obligatorios antes de confirmar la reunión.\\n`;
    const duration = agenda.duration_minutes || 30;
    return [
        { name: "PLANTILLA_BIENVENIDA", content: welcomeContent },
        { name: "PLANTILLA_BIENVENIDA_FALTAN_DATOS", content: welcomeMissingContent },
        { name: "PLANTILLA_BIENVENIDA_CON_DATOS", content: `${lopdpText}\\n\n${withTemplateEmoji(options?.emojiMode, "ok", "Perfecto [nombre], ya tengo sus datos iniciales.")}\\n\nAhora puedo hacerle unas preguntas rápidas para que la reunión sea más útil y luego revisar horarios disponibles.\\n` },
        { name: "PLANTILLA_BIENVENIDA_SIN_DATOS", content: `${withTemplateEmoji(options?.emojiMode, "welcome", `¡Qué gusto saludarle! Muchas gracias por ponerse en contacto con ${businessName}.`)}\\n\nPuedo ayudarle con información del negocio y guiarle hacia el agendamiento de una reunión comercial.\\n\n¿Desea avanzar con unas preguntas rápidas para revisar su caso?\\n` },
        { name: "PLANTILLA_PEDIR_UBICACION_REUNION", content: `Para coordinar correctamente el horario de la reunión, ¿desde qué ciudad y país se conectará?\\n\nEjemplos:\\n\nQuito, Ecuador\\n\nMadrid, España\\n\nMiami, Florida, Estados Unidos\\n\nSi se encuentra en un país con varios husos horarios, incluya también el estado, provincia o región.\\n` },
        { name: "PLANTILLA_FECHA_PASADA", content: `Entiendo, con gusto le ayudo [nombre].\\n\nSolo un detalle: no puedo agendar en una fecha pasada.\\n\nHoy es [fecha_base_oficial] en la zona horaria del negocio.\\n\n¿Para qué fecha desea agendar la reunión? Puede ser desde mañana o un siguiente día hábil.\\n` },
        { name: "PLANTILLA_NO_AGENDAR_HOY", content: `Gracias por su interés [nombre].\\n\nPor organización de agenda, las reuniones comerciales de ${businessName} no se agendan para el mismo día.\\n\nPuedo ayudarle a revisar disponibilidad desde el siguiente día hábil.\\n\n¿Le gustaría que revisemos horarios disponibles desde [siguiente_dia_habil]?\\n` },
        { name: "PLANTILLA_DIA_NO_HABIL", content: `Gracias por indicarlo [nombre].\\n\nLa agenda comercial de ${businessName} atiende reuniones en los días configurados, dentro del horario confirmado del negocio.\\n\nEl día seleccionado no está disponible para reuniones comerciales.\\n\nLe puedo ayudar a revisar disponibilidad desde [siguiente_dia_habil].\\n` },
        { name: "PLANTILLA_HORA_NO_EN_PUNTO", content: `Gracias, [nombre].\\n\nLas reuniones comerciales de ${businessName} se agendan únicamente en intervalos válidos según la agenda configurada.\\n\nLa hora que indicó, [hora_indicada], no está disponible para ese intervalo.\\n\nPara ayudarle, puede elegir una de estas opciones:\\n\n[opciones_horarias]\\n\n¿Cuál le funciona mejor?\\n` },
        { name: "PLANTILLA_HORA_FUERA_DE_ATENCION", content: `Gracias por compartir su interés [nombre] en agendar a las [hora_indicada].\\n\nSin embargo, la agenda comercial de ${businessName} atiende únicamente dentro del horario configurado del negocio.\\n\nPara ayudarle, le sugiero estas opciones:\\n\n[opciones_horarias]\\n\n¿Cuál le funciona mejor?\\n` },
        { name: "PLANTILLA_HORA_OCUPADA", content: `Gracias, [nombre].\\n\nEse horario ya no se encuentra disponible porque existe una reunión agendada dentro de ese bloque.\\n\nLe puedo ofrecer estas alternativas:\\n\n[opciones_horarias]\\n\n¿Cuál prefiere?\\n` },
        { name: "PLANTILLA_MOSTRAR_HORARIOS", content: `Tengo estos horarios disponibles para una reunión de ${duration} minutos:\\n\n[lista_horarios]\\n\n¿Cuál prefiere?\\n` },
        { name: "PLANTILLA_DATOS_REUNION", content: `¡${businessName}! Encantados de atenderle [nombre]\\n\nPara agendar su reunión y brindarle una atención segura y personalizada, necesitamos los siguientes datos:\\n\n${dataLines}\\n¡Compártanos esta información y le agendamos su reunión!\\n` },
        { name: "PLANTILLA_DATOS_REUNION_INCOMPLETOS", content: `¡Gracias por compartir su información [nombre]!\\n\nPara dejar todo listo, aún necesito:\\n\n${requiredMissingWithOperationalLines}\\n\nCuando tenga esa información, compártala por aquí y seguimos con la agenda.\\n` },
        { name: "PLANTILLA_CONFIRMACION_REUNION", content: `Listo, [nombre_apellido]. Su reunión ha sido registrada correctamente.\\n\n📅 Reunión agendada:\\n[fecha_usuario] a las [hora_usuario], hora de [ciudad_usuario], [pais_usuario]\\n\n📅 Para el equipo:\\n[fecha_negocio] a las [hora_negocio], hora del negocio\\n\n${confirmationExtraLines}${phoneConfirmationLine}🎥 Plataforma: Google Meet\\n\n📩 Invitación enviada a: [correo]\\n\nInicio del evento: [inicio_evento]\\n\nFin del evento: [fin_evento]\\n\nDescripcion: [resumen_ia]\\n` },
        { name: "PLANTILLA_CONSULTA_UNA_REUNION", content: `Claro, [nombre]. Esta es la reunión que tiene agendada:\\n\n[lista_mis_reuniones]\\n` },
        { name: "PLANTILLA_CONSULTA_VARIAS_REUNIONES", content: `Claro, [nombre]. Estas son las reuniones que tiene agendadas:\\n\n[lista_mis_reuniones]\\n\nSi desea cancelar una reunión, responda con el número correspondiente.\\n\nPara reprogramar una reunión, primero debe cancelar la reunión actual y luego agendar una nueva.\\n` },
        { name: "PLANTILLA_CONSULTA_SIN_REUNIONES", content: `Actualmente no veo reuniones agendadas a su nombre.\\n\nSi desea, puedo ayudarle a agendar una nueva reunión comercial con el equipo de ${businessName}.\\n` },
        { name: "PLANTILLA_LISTADO_REUNIONES_PARA_CANCELAR", content: `Estas son sus reuniones agendadas:\\n\n[lista_mis_reuniones]\\n\n¿Cuál desea cancelar o reprogramar?\\n\nResponda únicamente con el número de la reunión, por ejemplo: 1.\\n\nNo escriba nada más, solo el número.\\n` },
        { name: "PLANTILLA_NUMERO_OBLIGATORIO", content: `Para poder continuar, responda únicamente con el número de la reunión que desea cancelar o reprogramar.\\n\nEjemplo: 1\\n\nNo escriba nada más, solo el número.\\n` },
        { name: "PLANTILLA_CANCELACION_ABORTADA", content: `Perfecto [nombre]. No se realizará ningún cambio sobre su reunión.\\n\nSu reunión se mantiene como estaba agendada.\\n` },
    ];
};

const slugTemplateName = (value: string, fallback: string) => {
    const slug = String(value || fallback)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
    return slug || fallback;
};

const normalizeFaqEntries = (faqText: string, businessName: string) => {
    const lines = splitPromptLines(faqText);
    return lines
        .map((line, index) => {
            const match = line.match(/^(.*?\?)\s*Respuesta\s*:\s*(.+)$/i);
            if (!match) return null;
            const question = match[1].trim();
            const answer = match[2].trim();
            if (!question || !answer) return null;
            const shortName = question
                .replace(/[¿?]/g, "")
                .split(/\s+/)
                .filter((word) => word.length > 2)
                .slice(0, 5)
                .join("_");
            return {
                name: `PLANTILLA_FAQ_${slugTemplateName(shortName, `PREGUNTA_${index + 1}`)}`,
                question,
                content: `${answer}\\n\n¿Desea que le ayude a avanzar con el agendamiento en ${businessName}?\\n`,
            };
        })
        .filter(Boolean)
        .slice(0, 20) as Array<{ name: string; question: string; content: string }>;
};

const formatMoneyRangeForPrompt = (value: any, label: string) => {
    if (!value || typeof value !== "object") return `${label}: no registrado.`;
    const currency = String(value.currency || "USD").trim() || "USD";
    const min = value.min ?? value.minimum ?? value.value ?? null;
    const max = value.max ?? value.maximum ?? null;
    if (min !== null && max !== null && String(min) !== String(max)) return `${label}: aproximadamente ${currency} ${min} a ${max}.`;
    if (min !== null) return `${label}: aproximadamente ${currency} ${min}.`;
    return `${label}: no registrado.`;
};

const formatInternalDataForPrompt = (internalData: any) => {
    const businessModels = Array.isArray(internalData?.businessModels)
        ? internalData.businessModels
        : Array.isArray(internalData?.businessModel)
            ? internalData.businessModel
            : internalData?.businessModel
                ? [internalData.businessModel]
                : [];
    return [
        "CONTEXTO ESTRATÉGICO INTERNO",
        "",
        "Usa estos datos solo como criterio interno para entender el valor comercial del lead. No los menciones al usuario salvo que el negocio lo haya publicado o el flujo lo pida explícitamente.",
        formatMoneyRangeForPrompt(internalData?.averageTicket, "Ticket promedio"),
        formatMoneyRangeForPrompt(internalData?.ltv, "LTV aproximado"),
        formatMoneyRangeForPrompt(internalData?.cac, "CAC aproximado"),
        `Modelo de negocio: ${businessModels.length ? businessModels.join(", ") : "no registrado"}.`,
    ].join("\n");
};

const renderTemplateScenario = (index: number, template: { name: string; content: string }, activation?: string) => {
    const cleanActivation = String(activation || `Usar ${template.name}.`).replace(/:\s*$/, ".");
    return [
    `${index}. ${template.name}`,
    `Cuándo se activa: ${cleanActivation}`,
    "",
    "Plantilla:",
    template.name,
    template.content.trim(),
    ].join("\n");
};

const createTemplateCaseRenderer = () => {
    let index = 1;
    return (template: { name: string; content: string }, activation?: string) => renderTemplateScenario(index++, template, activation);
};

const extractTemplatePhrases = (content: string) => {
    const normalized = String(content || "")
        .replace(/\\n/g, "\n")
        .replace(/\{\{[\s\S]*?\}\}/g, " ")
        .replace(/\[[^\]]+\]/g, " ")
        .split(/\n+/)
        .map((line) => line.replace(/[•*]/g, " ").replace(/\s+/g, " ").trim())
        .filter((line) => line.length >= 14)
        .slice(0, 6);
    return normalized.length ? normalized : ["plantilla conversacional del prompt candidato"];
};

const buildTemplateIndex = (templates: Array<{ name: string; content: string }>) =>
    Object.fromEntries(templates.map((template) => [template.name, template]));

const getTemplate = (index: Record<string, { name: string; content: string }>, name: string) =>
    index[name] || { name, content: "" };

const buildMatcherGroupRule = (template: { name: string; content: string }, priority: number, minHits = 1) => ({
    template: template.name,
    phrases: extractTemplatePhrases(template.content),
    minHits,
    priority,
});

const templateNameIn = (name: string, values: string[]) => values.includes(name);

const inferMatcherStageForTemplate = (template: { name: string; content: string }, isAppointments: boolean) => {
    const name = String(template.name || "").toUpperCase();
    const normalizedContent = String(template.content || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    const commonWelcomeTemplates = [
        "PLANTILLA_BIENVENIDA",
        "PLANTILLA_BIENVENIDA_CON_DATOS",
        "PLANTILLA_BIENVENIDA_FALTAN_DATOS",
        "PLANTILLA_BIENVENIDA_SIN_DATOS",
    ];
    const commonInformationTemplates = [
        "PLANTILLA_AGRADECIMIENTO_LIMITADO",
    ];
    const commonInterestedTemplates = [
        "PLANTILLA_CLIENTE_INTERESADO",
        "PLANTILLA_AGRADECIMIENTO_UTIL",
    ];
    const commonNotInterestedTemplates = [
        "PLANTILLA_NO_INTERES",
        "PLANTILLA_NO_APLICA",
        "PLANTILLA_LENGUAJE_OFENSIVO_CIERRE",
        "PLANTILLA_NO_AYUDA",
        "PLANTILLA_EQUIVOCACION_CHAT",
    ];
    const appointmentInformationTemplates = [
        "PLANTILLA_SIN_CITAS",
        "PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR",
        "PLANTILLA_NUMERO_OBLIGATORIO",
        "PLANTILLA_MIS_CITAS",
        "PLANTILLA_CANCELACION_CITA_ABORTADA",
        "PLANTILLA_CITA_CANCELADA",
    ];
    const meetingInformationTemplates = [
        "PLANTILLA_CONSULTA_UNA_REUNION",
        "PLANTILLA_CONSULTA_VARIAS_REUNIONES",
        "PLANTILLA_CONSULTA_SIN_REUNIONES",
        "PLANTILLA_LISTADO_REUNIONES_PARA_CANCELAR",
        "PLANTILLA_NUMERO_OBLIGATORIO",
        "PLANTILLA_CANCELACION_ABORTADA",
    ];
    const appointmentInterestedTemplates = [
        "PLANTILLA_INTERES_CON_CIUDAD",
        "PLANTILLA_INTERES_CON_AGENCIA",
        "PLANTILLA_CIUDADES",
        "PLANTILLA_SECTOR_MATCH_CIUDAD_DEDUCIDA",
        "PLANTILLA_UBICACIONES_CON_CIUDAD",
        "PLANTILLA_DATOS_CITA",
        "PLANTILLA_DATOS_INCOMPLETOS",
        "PLANTILLA_FECHA_PASADA",
        "PLANTILLA_HORA_INTERVALO",
        "PLANTILLA_HORA_FUERA_DE_ATENCION",
        "PLANTILLA_HORA_OCUPADA",
        "PLANTILLA_NO_AGENDAR_HOY",
        "PLANTILLA_DIA_NO_HABIL",
        "PLANTILLA_REFERENCIA_MATCH",
        "PLANTILLA_VISITA_SIN_CITA",
    ];
    const meetingInterestedTemplates = [
        "PLANTILLA_NO_AGENDAR_HOY",
        "PLANTILLA_FECHA_PASADA",
        "PLANTILLA_DIA_NO_HABIL",
        "PLANTILLA_HORA_NO_EN_PUNTO",
        "PLANTILLA_HORA_FUERA_DE_ATENCION",
        "PLANTILLA_HORA_OCUPADA",
        "PLANTILLA_MOSTRAR_HORARIOS",
        "PLANTILLA_DATOS_REUNION",
        "PLANTILLA_DATOS_REUNION_INCOMPLETOS",
        "PLANTILLA_PEDIR_UBICACION_REUNION",
    ];
    const appointmentNotInterestedTemplates = [
        "PLANTILLA_UBICACION_DESCONOCIDA",
        "PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA",
        "PLANTILLA_CIUDAD_SIN_AGENCIA",
        "PLANTILLA_CIUDAD_SIN_AGENCIA_INSISTE",
        "PLANTILLA_UBICACIONES_SIN_CIUDAD",
        "PLANTILLA_REFERENCIA_CERCANA_SIN_CIUDAD",
    ];

    if (templateNameIn(name, ["PLANTILLA_CONFIRMACION", "PLANTILLA_CONFIRMACION_REUNION"])) {
        return "cita_agendada";
    }
    if (name === "PLANTILLA_CLIENTE_TIENE_DUDAS") {
        return "tiene_dudas";
    }
    if (templateNameIn(name, commonNotInterestedTemplates)) {
        return "desinteresado";
    }
    if (isAppointments && templateNameIn(name, appointmentNotInterestedTemplates)) {
        return "desinteresado";
    }
    if (templateNameIn(name, commonWelcomeTemplates)) {
        return "bienvenida";
    }
    if (templateNameIn(name, commonInterestedTemplates)) {
        return "interesado";
    }
    if (isAppointments && templateNameIn(name, appointmentInterestedTemplates)) {
        return "interesado";
    }
    if (!isAppointments && templateNameIn(name, meetingInterestedTemplates)) {
        return "interesado";
    }
    const showsDetailedAppointmentLocation = isAppointments
        && /\b(sede confirmada|direccion|google maps|maps|horario|edificio|avenida|av\.|ubicad[ao]|matriz)\b/.test(normalizedContent)
        && /\b(agendamiento|agendar|cita|agenda)\b/.test(normalizedContent);
    if (showsDetailedAppointmentLocation) {
        return "interesado";
    }
    const showsMeetingAvailability = !isAppointments
        && /\b(horarios disponibles|opciones horarias|lista horarios|puede elegir|cual prefiere|cuál prefiere)\b/.test(normalizedContent)
        && /\b(reunion|meet|google meet|agenda comercial)\b/.test(normalizedContent);
    if (showsMeetingAvailability) {
        return "interesado";
    }
    if (templateNameIn(name, commonInformationTemplates)) {
        return "solicita_informacion";
    }
    if (isAppointments && templateNameIn(name, appointmentInformationTemplates)) {
        return "solicita_informacion";
    }
    if (!isAppointments && templateNameIn(name, meetingInformationTemplates)) {
        return "solicita_informacion";
    }
    if (/^PLANTILLA_FAQ_/.test(name)) {
        return "solicita_informacion";
    }
    return "solicita_informacion";
};

const buildMatcherConfigFromTemplates = (templates: Array<{ name: string; content: string }>, isAppointments: boolean) => {
    const groups: Record<string, any[]> = {
        bienvenida: [],
        solicita_informacion: [],
        interesado: [],
        desinteresado: [],
        cita_agendada: [],
        tiene_dudas: [],
    };
    const seen = new Set<string>();
    templates
        .filter((template) => isResponseTemplateName(template.name))
        .forEach((template) => {
            const name = String(template.name || "").trim();
            if (seen.has(name)) return;
            seen.add(name);
            const stage = inferMatcherStageForTemplate(template, isAppointments);
            const priority =
                stage === "cita_agendada" ? 100
                    : stage === "tiene_dudas" ? 90
                        : stage === "desinteresado" ? 84
                            : stage === "interesado" ? 82
                                : stage === "bienvenida" ? 80
                                    : 70;
            const minHits = 1;
            groups[stage].push(buildMatcherGroupRule(template, priority - Math.min(groups[stage].length, 30), minHits));
        });
    return groups;
};

const normalizeRuleKey = (value: string) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const buildFilterConsequence = (filter: { rule_key?: string; gate_type?: string }) => {
    const ruleKey = normalizeRuleKey(String(filter.rule_key || ""));
    const isBlocking = filter.gate_type === "blocking";
    if (/early_required|inicio|bienvenida/.test(ruleKey)) {
        return isBlocking
            ? "Sí. Si el dato configurado como bloqueante al inicio no se entrega, no respondas preguntas del negocio ni avances hasta recibirlo."
            : "No. Si el usuario no entrega el dato inicial, responde su consulta o continúa el flujo y vuelve a pedirlo antes de confirmar.";
    }
    if (isBlocking) {
        if (/location|sede|agencia|sucursal/.test(ruleKey)) {
            return "Sí. Si no existe sede, agencia o sucursal confirmada, no pidas fecha/hora ni confirmes cita. Solicita ciudad, zona, referencia o sede hasta resolverlo.";
        }
        if (/business_hours|availability|capacity|slot|agenda|horario|cupo/.test(ruleKey)) {
            return "Sí. Si la fecha, hora, intervalo o cupo no es válido, no confirmes la cita. Explica el motivo y ofrece alternativas disponibles.";
        }
        if (/required_fields|lead|meeting_required|datos/.test(ruleKey)) {
            return "Sí. Si faltan datos obligatorios, no confirmes. Pide únicamente los datos pendientes y continúa cuando estén completos.";
        }
        if (/requester_timezone|ubicacion_reunion|zona_horaria_usuario/.test(ruleKey)) {
            return "Sí. Si no se conoce ciudad, estado/provincia cuando aplique, país y requester_timezone IANA del usuario, no pidas fecha/hora ni confirmes reunión. Usa PLANTILLA_PEDIR_UBICACION_REUNION o pide aclaración.";
        }
        if (/consent|lopdp|data/.test(ruleKey)) {
            return "Sí. Si falta autorización o aviso legal aplicable, no pidas datos personales ni confirmes hasta cumplir la regla legal.";
        }
        if (/qualification|filters|product_or_need/.test(ruleKey)) {
            return "Sí. Si falta contexto mínimo de calificación, no avances a agenda. Haz la pregunta pendiente y retoma el flujo cuando responda.";
        }
        return "Sí. Si no se cumple, detén el avance hacia agendamiento o confirmación y solicita la corrección necesaria.";
    }
    if (/fit|gold|joy|service|servicio|no_aplica/.test(ruleKey)) {
        return "No. Si el lead no encaja con el servicio, no empujes agenda; orienta con la plantilla correspondiente y continúa solo si vuelve a una intención válida.";
    }
    if (/welcome|intent|question|pregunta/.test(ruleKey)) {
        return "No. Úsalo para enrutar la intención: responde la pregunta directa y vuelve al siguiente paso útil del flujo.";
    }
    return "No. Úsalo para orientar o clasificar; si falta claridad, pide una aclaración breve sin bloquear todo el flujo.";
};

const renderFilterDecision = (filter: any, index?: number) => [
    `${typeof index === "number" ? `${index + 1}. ` : ""}${filter.rule_key}`,
    `   Tipo: ${filter.gate_type === "blocking" ? "gate bloqueante" : "filtro orientativo"}`,
    `   Bloquea avance: ${filter.gate_type === "blocking" ? "Sí" : "No"}`,
    `   Ubicación en flujo: ${filter.placement}`,
    `   Condición: ${filter.question}`,
    `   Si no se cumple: ${buildFilterConsequence(filter)}`,
    `   Motivo: ${filter.reason}`,
].join("\n");

const buildAppointmentCompiledPrompt = (input: {
    businessName: string;
    country: string;
    industry: string;
    valueProposition: string;
    services: string;
    benefits: string;
    restrictions: string;
    icp: string;
    tone: string;
    emojiRule: string;
    internalData: any;
    locationTerm: string;
    locationListingLines: string;
    locationReferenceLines: string;
    nearestLocationMapLines: string;
    locationStrategy: ReturnType<typeof buildAppointmentLocationStrategy>;
    leadFieldLines: string;
    earlyLeadFieldLabels?: string;
    earlyRequiredLeadFieldLabels?: string;
    earlyNonBlockingLeadFieldLabels?: string;
    earlyBlockingLeadFieldLabels?: string;
    agenda: any;
    locations: any[];
    filters: any[];
    lopdpText: string;
    faqTemplates: Array<{ name: string; question: string; content: string }>;
    universalTemplateEntries: Array<{ name: string; content: string }>;
    objectiveTemplateEntries: Array<{ name: string; content: string }>;
}) => {
    const allTemplates = [...input.universalTemplateEntries, ...input.objectiveTemplateEntries, ...input.faqTemplates];
    const templateIndex = buildTemplateIndex(allTemplates);
    const t = (name: string) => getTemplate(templateIndex, name);
    const locationStrategy = input.locationStrategy || buildAppointmentLocationStrategy([]);
    const visibleFilters = input.filters.map((filter, index) => renderFilterDecision(filter, index)).join("\n\n");
    const faqSection = input.faqTemplates.length
        ? input.faqTemplates.map((template, index) => [
            `${index + 1}. ${template.name}`,
            `Cuándo se activa: Si el usuario pregunta "${template.question}" o una variante semántica, usa esta plantilla literal y luego retoma el flujo pendiente.`,
            "",
            "Plantilla:",
            template.name,
            template.content.trim(),
        ].join("\n")).join("\n\n")
        : "No se generaron FAQs suficientes. Si el usuario pregunta algo no contemplado, responde con información confirmada y vuelve al flujo de cita.";
    const renderCase = createTemplateCaseRenderer();
    return [
        "CONTEXTO GENERAL",
        "",
        `* Eres el Asistente Comercial Omnicanal oficial de ${input.businessName}.`,
        "* Actúa como asistente comercial estratégico del funnel online: acompaña con amabilidad, claridad y calidez, pero tu objetivo central es convertir el interés del usuario en una cita agendada.",
        "* Tu objetivo principal es vender de forma servicial la idea de agendar una cita presencial, resolviendo dudas breves sin convertir la conversación en un asistente informativo infinito.",
        `* Estrategia de sedes decidida por AI Brain: ${locationStrategy.instruction}`,
        "* La estrategia de sedes se aplica después de resolver la bienvenida inicial. Si existen campos configurados para pedir al inicio, la primera respuesta debe usar solo la plantilla de bienvenida correspondiente y no debe mezclar ciudad, sede, sector, fecha ni hora.",
        "* El flujo de citas debe confirmar sede, datos obligatorios, fecha, hora y disponibilidad. La ciudad solo se pregunta cuando realmente ayuda a filtrar sedes.",
        "* Siempre habla en español castellano.",
        "* Usa siempre trato de usted.",
        "* No escribas nunca en inglés.",
        "* No menciones al usuario términos internos como JSON Schema, instance, type, prompt, herramienta, nodo, workflow, score interno, base de datos, pipeline, etiqueta, tool, system message, memoria, código o lógica interna.",
        "* No incluyas el nombre de la plantilla en la respuesta final al usuario.",
        "* Si se hace uso de una plantilla, envía directamente su contenido completo, sin escribir el título de la plantilla.",
        "* Si dentro del contenido de una plantilla aparecen variables entre corchetes, como [nombre], [fecha], [hora], [correo] o [agencia], reemplázalas solo si el dato existe. Si no existe, omite esa variable.",
        "* Cada respuesta debe estar formateada con \\n para los saltos de línea.",
        "* La salida debe ser válida para insertar directamente en JSON: no uses comillas dobles dentro del texto de respuesta al usuario, ni estructuras de código, llaves, corchetes ni objetos.",
        "* Nunca trates de tonto al cliente.",
        "* No inventes links, precios, descuentos, garantías, funcionalidades, casos de éxito, tiempos exactos ni resultados.",
        "",
        "DATOS ACTIVOS Y OBLIGATORIOS DINÁMICOS SEGÚN CANAL",
        "",
        "Estos son los datos configurados en el onboarding. Solo los marcados como obligatorios bloquean antes de confirmar la cita:",
        input.leadFieldLines || "No se configuraron campos personales adicionales.",
        "• Fecha para agendar cita",
        "• Hora para agendar cita",
        "",
        "Si el usuario ya proporcionó alguno de estos datos, agradécele y evita repetir la solicitud.",
        "Si ya existe nombre completo en memoria, no lo pidas nuevamente.",
        "",
        "POLÍTICA DE CAPTURA POR ETAPA",
        `Campos que el onboarding pidió capturar al inicio: ${input.earlyLeadFieldLabels || "ninguno"}.`,
        `Campos que bloquean el flujo inicial si faltan: ${input.earlyBlockingLeadFieldLabels || "ninguno"}.`,
        "Si un campo se captura al inicio pero NO bloquea, pídelo una vez y, si el usuario no lo entrega, responde su consulta o continúa el flujo. Ese dato se volverá a pedir antes de confirmar la cita.",
        "Si un campo bloquea el flujo inicial, no respondas preguntas del negocio ni avances hasta recibirlo.",
        "Si un campo se captura cuando vaya a agendar, no lo pidas en bienvenida; pídelo en PLANTILLA_DATOS_CITA o PLANTILLA_DATOS_INCOMPLETOS.",
        "Los campos obligatorios siempre bloquean antes de confirmar la cita, aunque no bloqueen al inicio.",
        "Los campos opcionales nunca bloquean.",
        "",
        "DATOS GENERALES DEL NEGOCIO",
        "",
        `Empresa: ${input.businessName}.`,
        `País principal: ${sourceText(input.country, "No definido")}.`,
        `Industria: ${sourceText(input.industry, "No definida")}.`,
        `Propuesta de valor: ${sourceText(input.valueProposition, "No definida")}.`,
        `Oferta principal: ${sourceText(input.services, "No definida")}.`,
        `Beneficios principales: ${sourceText(input.benefits, "No definidos")}.`,
        `Restricciones comerciales generales: ${sourceText(input.restrictions, "No definidas")}.`,
        `Cliente ideal: ${sourceText(input.icp, "No definido")}.`,
        `Tono de comunicación: ${input.tone}.`,
        "",
        formatInternalDataForPrompt(input.internalData),
        "",
        "REGLA DE USO DEL NOMBRE",
        "Solo personaliza con [nombre] cuando el usuario lo haya escrito explícitamente durante esta conversación. No repitas el nombre más de una vez por mensaje.",
        "",
        buildMemoryAndStyleBlock({ tone: input.tone, emojiRule: input.emojiRule, isAppointments: true }),
        "",
        buildRuntimeDateInstructions(input.agenda.timezone, true),
        "",
        "DATOS OPERATIVOS Y VARIABLES PARA CITAS",
        "",
        "Usa este bloque cuando consultes citas existentes, disponibilidad o citas del usuario. No expliques estas variables al usuario; son datos operativos para el flujo.",
        "",
        buildAppointmentsVariableBlock(input.agenda.timezone, input.locations),
        "",
        "INSTRUCCIONES DE LA RESPUESTA",
        "* Responde en texto formateado usando \\n para cada salto de línea.",
        "* No uses comillas dobles dentro del texto.",
        "* No incluyas llaves ni corchetes.",
        "* No incluyas el nombre de la plantilla en la respuesta.",
        "* Si usas una plantilla, respeta el contenido completo y el orden exacto.",
        "* Si una variable no se conoce, no envíes la variable visible.",
        "",
        "REGLA CRÍTICA DE USO DE PLANTILLAS",
        "* Cuando una situación tenga plantilla definida, debes usar la plantilla literal.",
        "* En agendamiento de citas, toda respuesta al usuario debe salir de una plantilla definida en este prompt. No redactes respuestas libres aunque parezcan útiles.",
        "* Está prohibido inventar frases como 'Para avanzar con el agendamiento necesito...' si existe PLANTILLA_BIENVENIDA, PLANTILLA_BIENVENIDA_FALTAN_DATOS, PLANTILLA_BIENVENIDA_CON_DATOS, PLANTILLA_BIENVENIDA_SIN_DATOS, PLANTILLA_DATOS_CITA o PLANTILLA_DATOS_INCOMPLETOS.",
        "* Si falta un dato configurado al inicio, no redactes una pregunta nueva: usa PLANTILLA_BIENVENIDA en primera interacción o PLANTILLA_BIENVENIDA_FALTAN_DATOS solo cuando falte un dato bloqueante al inicio.",
        "* No redactes libremente una respuesta cuando exista plantilla para ese caso.",
        "* No mezcles dos plantillas en una misma respuesta, salvo que la regla lo indique.",
        "* No agregues texto adicional antes o después de una plantilla obligatoria.",
        "* No resumas las plantillas.",
        "* No cambies el orden de sus líneas.",
        "",
        "FILTROS Y GATES DECIDIDOS POR AI BRAIN",
        "",
        visibleFilters,
        "",
        "REGLA CRÍTICA SOBRE FILTROS NO BLOQUEANTES",
        "Los filtros con Bloquea avance: No NO detienen el agendamiento. Sirven para entender intención, responder una duda o clasificar fit comercial. Después de responder, retoma el siguiente paso útil del flujo.",
        "Solo los gates marcados como gate bloqueante pueden impedir confirmar la cita. Si un filtro orientativo no se cumple, no lo conviertas en bloqueo salvo que el usuario salga completamente del servicio y corresponda una plantilla de cierre.",
        "",
        buildPriorityRuleBlock(true),
        "",
        "ORQUESTADOR DE NOMBRE, PROTECCIÓN DE DATOS Y PREGUNTAS DIRECTAS",
        "",
        "Marcadores internos de memoria que debes consultar solo cuando aplique:",
        "- nombre_usuario_escrito indica si el usuario ya escribió su nombre durante esta conversación.",
        "- intencion_pendiente guarda una pregunta directa que quedó pendiente de responder.",
        "- lopdp_enviado indica si el aviso de protección de datos ya fue enviado para no repetirlo.",
        "- ultima_plantilla_enviada ayuda a interpretar respuestas cortas sin perder el flujo.",
        "",
        "Árbol de decisión:",
        "1. En primera interacción, si el usuario ya compartió al menos un dato personal, usar PLANTILLA_BIENVENIDA_CON_DATOS. Esta plantilla incluye PLANTILLA_LOPDP.",
        "2. En primera interacción, si el usuario no compartió datos personales, usar PLANTILLA_BIENVENIDA. Esta plantilla solo pide los campos activos configurados con Cuándo pedir este dato = Al inicio de la conversación.",
        `3. Si después de PLANTILLA_BIENVENIDA faltan datos bloqueantes al inicio (${input.earlyBlockingLeadFieldLabels || "ninguno"}), usar PLANTILLA_BIENVENIDA_FALTAN_DATOS y no avanzar hasta recibirlos.`,
        `4. Si faltan datos de inicio no bloqueantes (${input.earlyNonBlockingLeadFieldLabels || "ninguno"}), NO uses PLANTILLA_BIENVENIDA_FALTAN_DATOS como bloqueo. Usa PLANTILLA_BIENVENIDA_SIN_DATOS si necesitas continuar sin datos personales, responde la consulta con la plantilla específica o continúa al siguiente paso útil.`,
        "5. Los datos obligatorios no entregados al inicio se vuelven a pedir antes de confirmar en PLANTILLA_DATOS_CITA o PLANTILLA_DATOS_INCOMPLETOS.",
        "6. PLANTILLA_LOPDP solo se envía cuando el usuario comparte por primera vez un dato personal, dentro de PLANTILLA_BIENVENIDA_CON_DATOS o PLANTILLA_CONFIRMACION.",
        "7. Si no hay pregunta directa ni intención pendiente, continuar flujo normal hacia sede, datos y cita.",
        "",
        "Regla anti-mezcla para bienvenida:",
        "- PLANTILLA_BIENVENIDA solo pide los datos configurados al inicio.",
        "- No la combines con PLANTILLA_CIUDADES, PLANTILLA_UBICACIONES_SIN_CIUDAD ni preguntas de ciudad.",
        "- Si la ciudad no está activa/obligatoria como campo de captura al inicio, no la pidas en la bienvenida.",
        "- Aunque la estrategia de sedes indique preguntar ciudad por existir varias sedes, esa pregunta se hace después de la bienvenida inicial, no en el mismo mensaje donde se piden datos de inicio.",
        "- La ciudad, zona o sede solo se pregunta cuando el usuario ya avanzó al bloque de ubicaciones o cuando la estrategia de sedes realmente lo requiera.",
        "",
        renderCase(t("PLANTILLA_BIENVENIDA"), "Primera interacción sin datos personales:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_FALTAN_DATOS"), "Datos bloqueantes del inicio siguen pendientes:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_CON_DATOS"), "El usuario compartió al menos un dato personal:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_SIN_DATOS"), "El usuario no compartió datos y no hay bloqueo inicial pendiente:"),
        "",
        renderCase(t("PLANTILLA_LOPDP"), "Aviso legal cuando corresponde antes de pedir datos o confirmar:"),
        "",
        "FLUJO PRINCIPAL DE CITAS",
        "",
        "1. PRIMERA INTERACCIÓN, INFORMACIÓN GENERAL O INTENCIÓN COMERCIAL",
        "Si el usuario saluda, pide información general o necesita orientación inicial, usa la bienvenida correspondiente. Si hay datos configurados al inicio, primero usa PLANTILLA_BIENVENIDA sin mezclar ubicación.",
        "Aplica la estrategia de sedes solo después de resolver la bienvenida inicial o cuando el usuario pregunte directamente por sedes/ubicaciones.",
        "No preguntes ciudad si existe una sola sede, si hay tres sedes o menos, si las sedes pueden listarse directamente, o si ciudad no fue configurada como campo activo al inicio.",
        "No cierres la bienvenida con preguntas abiertas tipo 'sobre qué desea información'. El objetivo es llevarlo al siguiente paso útil del agendamiento.",
        "",
        renderCase(t("PLANTILLA_BIENVENIDA"), "Plantilla de bienvenida general cuando no aplica gate de nombre:"),
        "",
        "2. INTERÉS, UBICACIONES, CIUDAD, SECTOR O REFERENCIA",
        `Si el usuario menciona una ${input.locationTerm}, ciudad, sector, barrio, parroquia o referencia, usa las referencias enriquecidas y no inventes ubicaciones.`,
        "Si hay coincidencia exacta de sede, salta a datos para agendar. Si hay coincidencia parcial, muestra opciones. Si no hay match confiable, pide aclaración.",
        "",
        "SEDES Y UBICACIONES",
        "Este bloque es la fuente oficial para listar sedes, agencias, sucursales o puntos de atención al usuario. Cuando pregunte dónde están, qué sedes tienen, horarios o direcciones, responde usando este formato y no la ficha interna de referencias.",
        input.locationListingLines,
        "",
        "REFERENCIAS GEOGRÁFICAS PARA MATCH INTERNO",
        "Este bloque sirve para deducir ciudad, zona, sector, barrio, parroquia, alias o referencia cercana. No lo recites completo al usuario; úsalo para decidir qué sede mostrar o qué aclaración pedir.",
        input.locationReferenceLines,
        input.nearestLocationMapLines ? [
            "",
            "MAPA INTERNO DE COBERTURA Y SEDE MÁS CERCANA",
            "Este mapa puede contener sedes de distintos países. Primero identifica el país del usuario y nunca recomiendes sedes de otro país salvo que el usuario lo pida explícitamente.",
            "La lógica de sede más cercana solo aplica dentro del mismo país confirmado. Si el país del usuario no tiene sede confirmada, no calcules cercanía transfronteriza.",
            input.nearestLocationMapLines,
        ].join("\n") : "",
        "",
        renderCase(t("PLANTILLA_CLIENTE_INTERESADO"), "Cuando el usuario muestra interés, pero falta ubicarlo:"),
        "",
        renderCase(t("PLANTILLA_INTERES_CON_CIUDAD"), "Cuando ya se conoce ciudad o zona:"),
        "",
        renderCase(t("PLANTILLA_INTERES_CON_AGENCIA"), "Cuando ya se conoce la sede elegida:"),
        "",
        renderCase(t("PLANTILLA_CIUDADES"), "Cuando el usuario pregunta por ciudades, zonas o ubicaciones generales:"),
        "",
        renderCase(t("PLANTILLA_SECTOR_MATCH_CIUDAD_DEDUCIDA"), "Cuando una referencia permite deducir zona:"),
        "",
        renderCase(t("PLANTILLA_UBICACIONES_CON_CIUDAD"), "Cuando se debe listar sedes de una ciudad o zona conocida:"),
        "",
        renderCase(t("PLANTILLA_UBICACIONES_SIN_CIUDAD"), "Cuando no se conoce ciudad ni zona:"),
        "",
        renderCase(t("PLANTILLA_REFERENCIA_MATCH"), "Cuando existe una referencia geográfica cercana a una sede:"),
        "",
        renderCase(t("PLANTILLA_REFERENCIA_CERCANA_SIN_CIUDAD"), "Cuando hay referencia, pero todavía no hay ciudad o zona suficiente:"),
        "",
        renderCase(t("PLANTILLA_UBICACION_DESCONOCIDA"), "Cuando no hay coincidencia confiable:"),
        "",
        renderCase(t("PLANTILLA_CIUDADAGENCIA_NO_REGISTRADA"), "Cuando la ciudad o agencia mencionada no está registrada:"),
        "",
        renderCase(t("PLANTILLA_CIUDAD_SIN_AGENCIA"), "Cuando el usuario pide una ciudad sin sede confirmada:"),
        "",
        renderCase(t("PLANTILLA_CIUDAD_SIN_AGENCIA_INSISTE"), "Cuando insiste en la misma ciudad sin cobertura:"),
        "",
        "3. CONSULTA, CANCELACIÓN O ELIMINACIÓN DE CITAS EXISTENTES",
        "Si el usuario pregunta cuándo es su cita, qué citas tiene, si puede cancelar, eliminar o modificar una cita, primero revisa LISTA_MIS_CITAS.",
        "Si no hay citas para ese conversation_id, usa PLANTILLA_SIN_CITAS.",
        "Si hay citas y solo consulta, muestra la lista con PLANTILLA_MIS_CITAS.",
        "Si desea cancelar o eliminar, usa PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR y exige que responda únicamente con el número.",
        "No canceles ni elimines nada si el usuario no eligió un número válido.",
        "Si el usuario quiere reprogramar, primero debe cancelar la cita existente y luego iniciar un nuevo agendamiento con sede, fecha y hora válidas.",
        "",
        renderCase(t("PLANTILLA_MIS_CITAS"), "Consulta de citas del usuario:"),
        "",
        renderCase(t("PLANTILLA_LISTADO_CITAS_PARA_ELIMINAR"), "Cancelación o eliminación de cita:"),
        "",
        renderCase(t("PLANTILLA_SIN_CITAS"), "Cuando LISTA_MIS_CITAS no devuelve citas:"),
        "",
        renderCase(t("PLANTILLA_NUMERO_OBLIGATORIO"), "Cuando debe elegir una cita y responde texto distinto a número:"),
        "",
        renderCase(t("PLANTILLA_CANCELACION_CITA_ABORTADA"), "Si el usuario decide no cancelar:"),
        "",
        renderCase(t("PLANTILLA_CITA_CANCELADA"), "Cuando la automatización confirma la cancelación de la cita seleccionada:"),
        "",
        "4. DATOS PARA AGENDAR",
        "Se activa cuando el usuario ya eligió sede o mostró intención clara de agendar. Pide únicamente datos faltantes.",
        "",
        renderCase(t("PLANTILLA_DATOS_CITA"), "Cuando faltan datos para crear la cita:"),
        "",
        renderCase(t("PLANTILLA_DATOS_INCOMPLETOS"), "Cuando ya envió algunos datos, pero faltan otros:"),
        "",
        "5. NORMALIZACIÓN DE FECHA, HORA, HORARIO Y CUPOS",
        "Antes de confirmar, normaliza fecha y hora. Valida día hábil de la sede, horario semanal, intervalo y cupos.",
        "Zona horaria base de agenda: no aplica como valor global para citas; se usa appointment_timezone/time_zone de la sede elegida.",
        "Para citas, cuando ya exista sede elegida, usa SIEMPRE la zona horaria IANA de esa sede desde ZONAS HORARIAS IANA POR SEDE.",
        "Antes de validar fecha pasada, no agendar hoy, horario local o cupos, identifica appointment_timezone/time_zone de la sede seleccionada.",
        `Intervalo de inicio: ${input.agenda.start_interval_minutes} minutos.`,
        `Cupos por bloque: ${input.agenda.capacity_per_slot === 0 ? "Ilimitado" : input.agenda.capacity_per_slot}.`,
        "fecha_base_oficial y hora_base_oficial deben existir como valores resueltos del workflow para la sede elegida. No son texto para mostrar al usuario.",
        "Si el usuario dice 'mañana', calcula fecha_cita_normalizada = fecha_base_oficial de la sede + 1 día y úsala en formato YYYY-MM-DD.",
        "Si el usuario dice 'pasado mañana', calcula fecha_cita_normalizada = fecha_base_oficial de la sede + 2 días.",
        "Si el usuario dice 'hoy', no confirmes; usa PLANTILLA_NO_AGENDAR_HOY.",
        "Si el usuario da solo un día del mes, asume mes y año de fecha_base_oficial de la sede salvo que quede en pasado.",
        "Nunca escribas en la respuesta final expresiones como {{ $now... }}, setZone, plus, toFormat o cualquier código.",
        "Antes de usar PLANTILLA_CONFIRMACION, [fecha] debe estar reemplazada por fecha_cita_normalizada concreta en formato YYYY-MM-DD.",
        "Antes de usar PLANTILLA_CONFIRMACION, [hora] debe estar reemplazada por hora_cita_normalizada concreta en formato HH:mm.",
        "No agendes para el mismo día. Si el usuario pide hoy, usa PLANTILLA_NO_AGENDAR_HOY y ofrece desde mañana o el siguiente día hábil.",
        "No confirmes fechas pasadas. Si la fecha es anterior a fecha_base_oficial de la sede, usa PLANTILLA_FECHA_PASADA.",
        "Si la fecha cae en un día no atendido por la sede, no confirmes. Ofrece el siguiente día hábil válido.",
        "Si la hora no respeta el intervalo configurado, usa PLANTILLA_HORA_INTERVALO.",
        "Si la hora está fuera de atención, no confirmes. Propón una hora cercana válida.",
        "Si el cupo está lleno, no confirmes. Propón alternativas.",
        "",
        renderCase(t("PLANTILLA_FECHA_PASADA"), "Fecha pasada:"),
        "",
        renderCase(t("PLANTILLA_NO_AGENDAR_HOY"), "Fecha solicitada para hoy:"),
        "",
        renderCase(t("PLANTILLA_DIA_NO_HABIL"), "Día no hábil para la sede elegida:"),
        "",
        renderCase(t("PLANTILLA_HORA_INTERVALO"), "Hora que no respeta el intervalo configurado:"),
        "",
        renderCase(t("PLANTILLA_HORA_FUERA_DE_ATENCION"), "Hora fuera del horario de atención:"),
        "",
        renderCase(t("PLANTILLA_HORA_OCUPADA"), "Horario sin cupo o con conflicto:"),
        "",
        renderCase(t("PLANTILLA_VISITA_SIN_CITA"), "Si el usuario pregunta si puede ir sin cita o no quiere compartir más datos:"),
        "",
        "6. CONFIRMACIÓN FINAL DE CITA",
        "Solo confirmar cuando existan sede confirmada, datos obligatorios, fecha normalizada, hora normalizada y disponibilidad validada.",
        "No usar PLANTILLA_CONFIRMACION si falta cualquier dato obligatorio o si la fecha/hora no pasó los gates.",
        "",
        renderCase(t("PLANTILLA_CONFIRMACION"), "Cita validada y lista para confirmar:"),
        "",
        "7. PREGUNTAS FRECUENTES, INTERRUPCIONES Y DUDAS",
        "",
        faqSection,
        "",
        renderCase(t("PLANTILLA_CLIENTE_TIENE_DUDAS"), "Si el usuario expresa dudas claras o pide asesor:"),
        "",
        renderCase(t("PLANTILLA_AGRADECIMIENTO_UTIL"), "Agradecimiento después de información útil o proceso completo:"),
        "",
        renderCase(t("PLANTILLA_AGRADECIMIENTO_LIMITADO"), "Agradecimiento después de una respuesta limitada o fuera de contexto:"),
        "",
        "8. CIERRES Y CASOS FUERA DE ALCANCE",
        "",
        renderCase(t("PLANTILLA_NO_INTERES"), "Desinterés o rechazo claro:"),
        "",
        renderCase(t("PLANTILLA_NO_AYUDA"), "Cuando el usuario expresa una situación donde el negocio no puede ayudar directamente:"),
        "",
        renderCase(t("PLANTILLA_NO_APLICA"), "Consulta fuera del negocio:"),
        "",
        renderCase(t("PLANTILLA_EQUIVOCACION_CHAT"), "Equivocación de chat:"),
        "",
        renderCase(t("PLANTILLA_LENGUAJE_OFENSIVO_CIERRE"), "Lenguaje ofensivo o agresivo:"),
        "",
        buildNoHallucinationBlock(),
        "",
        "ORDEN FINAL OBLIGATORIO DEL FLUJO",
        "1. Saludo e identificación de intención.",
        "2. Resolver pregunta directa si aplica.",
        "3. Aplicar aviso legal antes de datos personales cuando corresponda.",
        "4. Identificar sede. Usa ciudad, zona o referencia solo cuando ayude a filtrar varias sedes.",
        "5. Mostrar sedes cuando haga falta.",
        "6. Confirmar sede.",
        "7. Si consulta, cancela o elimina una cita existente, revisar LISTA_MIS_CITAS y usar la plantilla correspondiente.",
        "8. Pedir datos obligatorios del lead.",
        "9. Normalizar fecha y hora.",
        "10. Validar día hábil, horario de sede, intervalo, cupos y conflictos contra CITAS_AGENDADAS.",
        "11. Confirmar con PLANTILLA_CONFIRMACION.",
    ].join("\n");
};

const buildMeetingCompiledPrompt = (input: any) => {
    const allTemplates = [...input.universalTemplateEntries, ...input.objectiveTemplateEntries, ...input.faqTemplates];
    const templateIndex = buildTemplateIndex(allTemplates);
    const t = (name: string) => getTemplate(templateIndex, name);
    const visibleFilters = (input.filters || []).map((filter: any, index: number) => renderFilterDecision(filter, index)).join("\n\n");
    const faqSection = input.faqTemplates?.length
        ? input.faqTemplates.map((template: any, index: number) => [
            `${index + 1}. ${template.name}`,
            `Cuándo se activa: Si el usuario pregunta "${template.question}" o una variante semántica, usa esta plantilla literal y luego retoma el flujo pendiente.`,
            "",
            "Plantilla:",
            template.name,
            template.content.trim(),
        ].join("\n")).join("\n\n")
        : "No se generaron FAQs suficientes. Si el usuario pregunta algo no contemplado, responde con información confirmada y vuelve al flujo de reunión.";
    const renderCase = createTemplateCaseRenderer();
    const businessTimezone = input.agenda?.timezone || "America/Guayaquil";
    return [
        "CONTEXTO GENERAL",
        "",
        `* Eres el Asistente Comercial Omnicanal oficial de ${input.businessName}.`,
        "* Actúa como asistente comercial estratégico del funnel online: califica con claridad, resuelve dudas breves y guía al usuario hacia una reunión comercial útil.",
        "* Tu objetivo principal es vender de forma servicial la idea de agendar una reunión comercial, sin convertir la conversación en un asistente informativo infinito.",
        "* Para reuniones no existen sedes físicas: la disponibilidad depende del calendario del negocio.",
        `* business_timezone oficial del negocio: ${businessTimezone}.`,
        "* requester_timezone se obtiene obligatoriamente desde ciudad, estado/provincia si aplica y país del usuario antes de pedir fecha y hora.",
        "* Siempre habla en español castellano.",
        "* Usa siempre trato de usted.",
        "* No escribas nunca en inglés.",
        "* No menciones al usuario términos internos como JSON Schema, instance, type, prompt, herramienta, nodo, workflow, score interno, base de datos, pipeline, etiqueta, tool, system message, memoria, código o lógica interna.",
        "* No incluyas el nombre de la plantilla en la respuesta final al usuario.",
        "* Si se hace uso de una plantilla, envía directamente su contenido completo, sin escribir el título de la plantilla.",
        "* Cada respuesta debe estar formateada con \\n para los saltos de línea.",
        "* La salida debe ser válida para insertar directamente en JSON: no uses comillas dobles dentro del texto de respuesta al usuario, ni estructuras de código, llaves, corchetes ni objetos.",
        "* Nunca trates de tonto al cliente.",
        "* No inventes links, precios, descuentos, garantías, funcionalidades, casos de éxito, tiempos exactos ni resultados.",
        "",
        "DATOS GENERALES DEL NEGOCIO",
        "",
        `Empresa: ${input.businessName}.`,
        `País principal: ${sourceText(input.country, "No definido")}.`,
        `Industria: ${sourceText(input.industry, "No definida")}.`,
        `Propuesta de valor: ${sourceText(input.valueProposition, "No definida")}.`,
        `Oferta principal: ${sourceText(input.services, "No definida")}.`,
        `Beneficios principales: ${sourceText(input.benefits, "No definidos")}.`,
        `Restricciones comerciales generales: ${sourceText(input.restrictions, "No definidas")}.`,
        `Cliente ideal: ${sourceText(input.icp, "No definido")}.`,
        `Tono de comunicación: ${input.tone}.`,
        "",
        formatInternalDataForPrompt(input.internalData),
        "",
        "REGLA DE USO DEL NOMBRE",
        "Solo personaliza con [nombre] cuando el usuario lo haya escrito explícitamente durante esta conversación. No repitas el nombre más de una vez por mensaje.",
        "",
        "POLÍTICA DE CAPTURA POR ETAPA",
        `Campos que el onboarding pidió capturar al inicio: ${input.earlyLeadFieldLabels || "ninguno"}.`,
        `Campos que bloquean el flujo inicial si faltan: ${input.earlyBlockingLeadFieldLabels || "ninguno"}.`,
        "Si un campo se captura al inicio pero NO bloquea, pídelo una vez y, si el usuario no lo entrega, responde su consulta o continúa el flujo. Ese dato se volverá a pedir antes de confirmar la reunión si es obligatorio.",
        "Si un campo bloquea el flujo inicial, no respondas preguntas del negocio ni avances hasta recibirlo.",
        "Si un campo se captura cuando vaya a agendar, no lo pidas en bienvenida; pídelo en PLANTILLA_DATOS_REUNION o PLANTILLA_DATOS_REUNION_INCOMPLETOS.",
        "Los campos obligatorios siempre bloquean antes de confirmar la reunión, aunque no bloqueen al inicio.",
        "Los campos opcionales nunca bloquean.",
        "",
        buildMemoryAndStyleBlock({ tone: input.tone, emojiRule: input.emojiRule, isAppointments: false }),
        "",
        buildRuntimeDateInstructions(businessTimezone, false),
        "",
        "DATOS OPERATIVOS Y VARIABLES PARA REUNIONES",
        "",
        "Usa este bloque cuando consultes reuniones existentes, disponibilidad, reuniones del usuario o conversión de horarios. No expliques estas variables al usuario.",
        "",
        buildMeetingsVariableBlock(businessTimezone),
        "",
        "FILTROS, GATES Y REGLAS BLOQUEANTES DECIDIDOS POR AI BRAIN",
        "",
        "Marco de decisión:",
        "- Calificación antes de agenda: primero entender necesidad, volumen/frecuencia y rango de inversión cuando aplique.",
        "- Consentimiento antes de datos personales: no pedir nombre, correo o teléfono sin autorización cuando aplique.",
        "- Ubicación del usuario antes de fecha/hora: sin requester_timezone no se interpreta correctamente la hora del usuario.",
        "- business_timezone manda para disponibilidad y guardado; requester_timezone manda para interpretar y mostrar la hora al usuario.",
        "- Gate bloqueante: solo bloquea antes de confirmar si falta consentimiento, datos obligatorios, requester_timezone, fecha/hora válida o disponibilidad.",
        "",
        visibleFilters,
        "",
        "PROTECCIÓN DE DATOS PERSONALES",
        "",
        "No pidas datos personales antes de consentimiento o aviso legal cuando aplique. No dupliques el aviso si lopdp_enviado = true.",
        "",
        renderCase(t("PLANTILLA_LOPDP"), "Antes de pedir datos personales o antes de confirmar si todavía no se envió el aviso legal:"),
        "",
        "FLUJO CONVERSACIONAL PARA REUNIONES COMERCIALES",
        "",
        "0. ORQUESTADOR PRINCIPAL",
        "Evalúa siempre en este orden: lenguaje ofensivo, equivocación de chat, consulta/cancelación/reprogramación de reuniones, rechazo, consentimiento, solicitud de humano, agradecimiento, FAQ/interrupción y flujo principal.",
        "",
        "1. PRIMERA INTERACCIÓN Y DIRECCIÓN COMERCIAL",
        "",
        renderCase(t("PLANTILLA_BIENVENIDA"), "Primera interacción o saludo sin intención clara:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_FALTAN_DATOS"), "Datos bloqueantes del inicio siguen pendientes:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_CON_DATOS"), "El usuario compartió al menos un dato personal:"),
        "",
        renderCase(t("PLANTILLA_BIENVENIDA_SIN_DATOS"), "El usuario no compartió datos y no hay bloqueo inicial pendiente:"),
        "",
        renderCase(t("PLANTILLA_CLIENTE_INTERESADO"), "El usuario muestra interés o quiere avanzar hacia una reunión:"),
        "",
        "2. CALIFICACIÓN Y PREGUNTAS FRECUENTES",
        "Responde preguntas frecuentes de forma breve y vuelve al flujo de reunión. No inventes datos no confirmados.",
        "",
        faqSection,
        "",
        "3. UBICACIÓN Y ZONA HORARIA DEL USUARIO",
        "Se activa obligatoriamente después de calificación/consentimiento y antes de pedir fecha y hora.",
        "Si el país tiene varias zonas horarias y el usuario solo dio país, pide ciudad y estado/provincia.",
        "Si la ciudad es ambigua, pide aclaración.",
        "Una vez identificada la ubicación, infiere requester_timezone IANA.",
        "",
        renderCase(t("PLANTILLA_PEDIR_UBICACION_REUNION"), "Antes de pedir fecha y hora de reunión:"),
        "",
        "4. MOSTRAR DISPONIBILIDAD Y PEDIR DATOS",
        "La hora escrita por el usuario se interpreta en requester_timezone y se convierte a business_timezone para validar disponibilidad.",
        "No muestres horarios sin revisar REUNIONES_AGENDADAS.",
        "",
        renderCase(t("PLANTILLA_MOSTRAR_HORARIOS"), "Cuando existan horarios disponibles calculados en business_timezone y convertidos para el usuario cuando aplique:"),
        "",
        renderCase(t("PLANTILLA_DATOS_REUNION"), "Cuando ya se pueda pedir datos para agendar la reunión:"),
        "",
        renderCase(t("PLANTILLA_DATOS_REUNION_INCOMPLETOS"), "Si el usuario intenta avanzar pero faltan datos obligatorios:"),
        "",
        "5. VALIDACIONES DE FECHA, HORA Y DISPONIBILIDAD",
        "No confirmes si la fecha es pasada, es hoy, no es día hábil, no cumple intervalo, está fuera de horario o está ocupada.",
        "",
        renderCase(t("PLANTILLA_FECHA_PASADA"), "Fecha pasada:"),
        "",
        renderCase(t("PLANTILLA_NO_AGENDAR_HOY"), "El usuario quiere agendar para hoy:"),
        "",
        renderCase(t("PLANTILLA_DIA_NO_HABIL"), "Día no disponible para la agenda comercial:"),
        "",
        renderCase(t("PLANTILLA_HORA_NO_EN_PUNTO"), "Hora que no coincide con el intervalo configurado:"),
        "",
        renderCase(t("PLANTILLA_HORA_FUERA_DE_ATENCION"), "Hora fuera del horario de atención del negocio:"),
        "",
        renderCase(t("PLANTILLA_HORA_OCUPADA"), "Horario ocupado o con conflicto en REUNIONES_AGENDADAS:"),
        "",
        "6. CONFIRMACIÓN FINAL DE REUNIÓN",
        "Solo confirma cuando existan datos obligatorios, requester_timezone, fecha/hora del usuario, fecha/hora convertida al negocio y disponibilidad validada.",
        "Guarda appointment_date y appointment_time en business_timezone. Conserva requester_timezone para consultas.",
        "",
        renderCase(t("PLANTILLA_CONFIRMACION_REUNION"), "Reunión validada y lista para confirmar:"),
        "",
        "7. CONSULTA, CANCELACIÓN O REPROGRAMACIÓN DE REUNIONES",
        "Si el usuario pregunta por sus reuniones, revisa LISTA_MIS_REUNIONES_CONSULTA antes de responder.",
        "Para reprogramar, primero debe cancelar la reunión actual y luego agendar una nueva.",
        "",
        renderCase(t("PLANTILLA_CONSULTA_UNA_REUNION"), "Si existe una sola reunión futura del usuario:"),
        "",
        renderCase(t("PLANTILLA_CONSULTA_VARIAS_REUNIONES"), "Si existen varias reuniones futuras del usuario:"),
        "",
        renderCase(t("PLANTILLA_CONSULTA_SIN_REUNIONES"), "Si no existen reuniones futuras del usuario:"),
        "",
        renderCase(t("PLANTILLA_LISTADO_REUNIONES_PARA_CANCELAR"), "Si el usuario quiere cancelar o reprogramar una reunión:"),
        "",
        renderCase(t("PLANTILLA_NUMERO_OBLIGATORIO"), "Después de listar reuniones, si el usuario no responde solo con número:"),
        "",
        renderCase(t("PLANTILLA_CANCELACION_ABORTADA"), "Si el usuario decide no cancelar:"),
        "",
        "8. DUDAS, AGRADECIMIENTOS Y CIERRES",
        "",
        renderCase(t("PLANTILLA_CLIENTE_TIENE_DUDAS"), "Si el usuario expresa dudas claras o pide asesor:"),
        "",
        renderCase(t("PLANTILLA_AGRADECIMIENTO_UTIL"), "Agradecimiento después de información útil o avance del flujo:"),
        "",
        renderCase(t("PLANTILLA_AGRADECIMIENTO_LIMITADO"), "Agradecimiento después de una respuesta limitada o fuera de contexto:"),
        "",
        renderCase(t("PLANTILLA_NO_INTERES"), "Desinterés o rechazo claro:"),
        "",
        renderCase(t("PLANTILLA_NO_AYUDA"), "Cuando el negocio no puede ayudar directamente:"),
        "",
        renderCase(t("PLANTILLA_NO_APLICA"), "Consulta fuera del negocio:"),
        "",
        renderCase(t("PLANTILLA_EQUIVOCACION_CHAT"), "Equivocación de chat:"),
        "",
        renderCase(t("PLANTILLA_LENGUAJE_OFENSIVO_CIERRE"), "Lenguaje ofensivo o agresivo:"),
        "",
        buildNoHallucinationBlock(),
        "",
        "ORDEN FINAL OBLIGATORIO DEL FLUJO",
        "1. Saludo e identificación de intención.",
        "2. Producto o necesidad.",
        "3. Filtros comerciales.",
        "4. Consentimiento de datos.",
        "5. Datos personales obligatorios configurados.",
        "6. Pedir ubicación del usuario con PLANTILLA_PEDIR_UBICACION_REUNION.",
        "7. Inferir requester_timezone IANA.",
        "8. Pedir fecha y hora.",
        "9. Interpretar fecha/hora en requester_timezone y convertir a business_timezone.",
        "10. Validar fecha pasada, no hoy, día hábil, horario e intervalos en business_timezone.",
        "11. Revisar REUNIONES_AGENDADAS.",
        "12. Preparar inicio_evento, fin_evento y descripcion_evento en business_timezone.",
        "13. Confirmar con PLANTILLA_CONFIRMACION_REUNION mostrando hora del usuario y hora del negocio.",
    ].join("\n");
};

const buildOperationalAssets = (params: {
    project: any;
    fields: any[];
    internalData: any;
    objective: any;
    locations: any[];
    agenda: any;
    leadFields: any[];
    style: any;
    legalTextOverride?: string | null;
}) => {
    const businessName = getContextValue(params.fields, "commercial_name") || params.project.name;
    const country = getContextValue(params.fields, "country");
    const industry = getContextValue(params.fields, "industry");
    const valueProposition = getContextValue(params.fields, "value_proposition");
    const benefits = getContextValue(params.fields, "benefits");
    const restrictions = getContextValue(params.fields, "general_restrictions");
    const icp = getContextValue(params.fields, "ideal_customer_profile");
    const faqs = getContextValue(params.fields, "faqs");
    const services = getContextValue(params.fields, "primary_offers") || getContextValue(params.fields, "services");
    const tone = getContextValue(params.fields, "communication_tone") || "profesional y claro";
    const isAppointments = params.objective.objective === "appointments";
    const leadFieldsForObjective = isAppointments
        ? (params.leadFields || [])
        : (params.leadFields || []).map(forceMeetingLeadFieldEnabled);
    const dataProtectionRecommendation = resolveDataProtectionRecommendation(params.fields);
    const isEcuador = dataProtectionRecommendation?.key === "ecuador" || isEcuadorCountry(country);
    const emojiRule = params.style.emoji_mode === "none"
        ? "No usar emojis."
        : params.style.emoji_mode === "commercial_only"
            ? "Usar emojis solo en bienvenida o mensajes comerciales de alto impacto."
            : "Usar emojis de forma moderada: cada plantilla de respuesta debe incluir al menos 1 emoji, y puedes agregar más solo cuando aporte claridad sin saturar.";
    const manualLegalText = String(params.legalTextOverride || "").trim();
    const lopdpText = manualLegalText
        || dataProtectionRecommendation?.legalText
        || "Texto de proteccion de datos personales pendiente. El negocio debe ingresar el mensaje legal aplicable a su pais antes de publicar.";
    const lopdpStatus = manualLegalText || dataProtectionRecommendation ? "generated" : "pending_legal_review";
    const faqPromptText = buildFaqPromptText({
        businessName,
        faqs,
        valueProposition,
        services,
        benefits,
        isAppointments,
    });
    const objectiveText = isAppointments
        ? "Objetivo: agendamiento de citas presenciales."
        : "Objetivo: agendamiento de reuniones comerciales virtuales con Google Meet pendiente de configuración técnica.";
    const locationListingLines = params.locations.length
        ? params.locations.map((location: any) => [
            `• ${location.name}`,
            `Dirección: ${location.address || "No definida"}`,
            `Horario: ${location.hours || "No definido"}`,
            `Zona horaria IANA: ${resolveAppointmentTimezone(location, params.fields, params.agenda.timezone || "America/Guayaquil")}`,
            Array.isArray(location.weekly_hours) && location.weekly_hours.some((item: any) => item.enabled)
                ? `Horario semanal confirmado: ${location.weekly_hours.filter((item: any) => item.enabled).map((item: any) => `${item.day} ${item.startTime}-${item.endTime}`).join(" | ")}`
                : "",
            location.google_maps_url ? `Google Maps: ${location.google_maps_url}` : "",
        ].filter(Boolean).join("\n")).join("\n\n")
        : "No aplica para reuniones.";
    const locationReferenceLines = params.locations.length
        ? params.locations.map((location: any, index: number) => {
            const referenceLines = buildLocationReferencePromptLines(Array.isArray(location.references) ? location.references : []);
            return [
                `${index + 1}. ${location.name}`,
                referenceLines.length
                    ? referenceLines.join("\n")
                    : "Sin referencias enriquecidas. Usa solo nombre, dirección y horario confirmados.",
            ].join("\n");
        }).join("\n\n")
        : "No aplica para reuniones.";
    const nearestLocationMapLines = isAppointments
        ? buildNearestLocationReferenceBlock({ country, locations: params.locations })
        : "";
    const locationStrategy = isAppointments
        ? buildAppointmentLocationStrategy(params.locations)
        : buildAppointmentLocationStrategy([]);
    const hourLines = isAppointments
        ? "Los horarios de atención se definen por sede en el bloque de ubicaciones. La agenda solo define reglas comunes de intervalo, cupos, zona horaria y notas."
        : (params.agenda.weekly_hours || [])
            .filter((item: any) => item.enabled)
            .map((item: any) => `${item.day}: ${item.startTime}-${item.endTime}`)
            .join("\n");
    const enabledLeadFields = leadFieldsForObjective.filter((field: any) => field.enabled);
    const requiredLeadFields = enabledLeadFields.filter((field: any) => field.required);
    const requiredLeadFieldLabels = requiredLeadFields.map((field: any) => leadFieldRequestLabel(field)).join(", ");
    const earlyLeadFields = enabledLeadFields.filter((field: any) => field.captureTiming === "conversation_start");
    const earlyRequiredLeadFields = earlyLeadFields.filter((field: any) => field.required);
    const earlyBlockingLeadFields = earlyLeadFields.filter((field: any) => field.required && field.blocksEarlyFlow);
    const earlyNonBlockingLeadFields = earlyLeadFields.filter((field: any) => !(field.required && field.blocksEarlyFlow));
    const earlyLeadFieldLabels = earlyLeadFields.map((field: any) => leadFieldRequestLabel(field)).join(", ");
    const earlyRequiredLeadFieldLabels = earlyRequiredLeadFields.map((field: any) => leadFieldRequestLabel(field)).join(", ");
    const earlyNonBlockingLeadFieldLabels = earlyNonBlockingLeadFields.map((field: any) => leadFieldRequestLabel(field)).join(", ");
    const earlyBlockingLeadFieldLabels = earlyBlockingLeadFields.map((field: any) => leadFieldRequestLabel(field)).join(", ");
    const leadFieldLines = enabledLeadFields
        .filter((field: any) => field.enabled)
        .map((field: any) => `- ${leadFieldRequestLabel(field)}: ${field.required ? "obligatorio" : "opcional"}; captura: ${leadFieldCaptureTimingLabel(field)}; bloqueo: ${leadFieldBlockingLabel(field)}`)
        .join("\n");
    const appointmentFilters = [
        {
            rule_key: "welcome_intent",
            question: `Detectar si el lead pregunta por informacion, ubicaciones, requisitos, precios, horarios o quiere agendar con ${businessName}.`,
            gate_type: "non_blocking",
            placement: "welcome",
            reason: "Funnel de agendamiento: primero identificar intención y reducir fricción; no pedir datos personales en bienvenida salvo que el usuario ya los comparta o sean estrictamente necesarios.",
        },
        ...(earlyLeadFields.length ? [{
            rule_key: "early_required_fields",
            question: earlyBlockingLeadFields.length
                ? `Pedir al inicio estos datos configurados para bienvenida: ${earlyLeadFieldLabels}. Bloquear el flujo inicial solo por estos campos marcados como bloqueantes: ${earlyBlockingLeadFieldLabels}.`
                : `Pedir al inicio estos datos configurados para bienvenida: ${earlyLeadFieldLabels}. Si el usuario no los entrega, no bloquear: responder su pregunta y volver a pedir los datos obligatorios antes de confirmar la cita.`,
            gate_type: earlyBlockingLeadFields.length ? "blocking" : "non_blocking",
            placement: "welcome",
            reason: earlyBlockingLeadFields.length
                ? "El negocio pidió captura temprana bloqueante para esos campos; no se avanza a preguntas ni agenda hasta recibirlos."
                : "El negocio pidió captura temprana sin bloquear; se reduce fricción y el dato sigue siendo obligatorio solo antes de confirmar.",
        }] : []),
        {
            rule_key: "location_required",
            question: "Antes de confirmar una cita debe existir sede, agencia o sucursal elegida por el lead.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "Una cita presencial no puede confirmarse sin saber donde atender al lead.",
        },
        ...(requiredLeadFields.length ? [{
            rule_key: "lead_required_fields",
            question: `Validar antes de confirmar solamente los campos marcados como obligatorios en onboarding: ${requiredLeadFieldLabels}. Si algún campo se pidió al inicio pero el usuario no lo entregó, volver a pedirlo aquí. Los campos activos pero opcionales nunca bloquean la cita.`,
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "Progressive profiling: pedir lo mínimo necesario y bloquear solo por datos que el usuario marcó como obligatorios.",
        }] : []),
        {
            rule_key: "location_business_hours",
            question: "Validar dia y hora contra el horario semanal de la sede seleccionada.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "No se debe confirmar una cita fuera de horario o en dias no laborables de esa sede.",
        },
        {
            rule_key: "capacity_per_slot",
            question: "Validar intervalo y cupos antes de confirmar agenda.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La disponibilidad debe respetar cupos y reglas comunes de agenda.",
        },
    ];
    const filters = isAppointments ? appointmentFilters : [
        {
            rule_key: "product_or_need",
            question: "Detectar producto, necesidad o motivo de reunion antes de pedir datos personales.",
            gate_type: "non_blocking",
            placement: "welcome",
            reason: "La reunion debe llegar con contexto comercial util.",
        },
        {
            rule_key: "qualification_filters",
            question: "Completar necesidad principal, volumen o frecuencia y rango de inversion antes del consentimiento.",
            gate_type: "blocking",
            placement: "after_welcome",
            reason: "Evita agendar reuniones sin contexto minimo para el equipo comercial.",
        },
        {
            rule_key: "data_consent_required",
            question: "Solicitar consentimiento antes de pedir nombre, correo o telefono.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La captura de datos personales debe ocurrir solo despues de autorizacion.",
        },
        ...(earlyLeadFields.length ? [{
            rule_key: "early_required_fields",
            question: earlyBlockingLeadFields.length
                ? `Pedir al inicio estos datos configurados para bienvenida: ${earlyLeadFieldLabels}. Bloquear el flujo inicial solo por estos campos marcados como bloqueantes: ${earlyBlockingLeadFieldLabels}.`
                : `Pedir al inicio estos datos configurados para bienvenida: ${earlyLeadFieldLabels}. Si el usuario no los entrega, no bloquear: responder su pregunta y volver a pedir los datos obligatorios antes de confirmar la reunión.`,
            gate_type: earlyBlockingLeadFields.length ? "blocking" : "non_blocking",
            placement: "welcome",
            reason: earlyBlockingLeadFields.length
                ? "El negocio pidió captura temprana bloqueante para esos campos; no se avanza a preguntas ni agenda hasta recibirlos."
                : "El negocio pidió captura temprana sin bloquear; se reduce fricción y el dato sigue siendo obligatorio solo antes de confirmar.",
        }] : []),
        {
            rule_key: "meeting_required_fields",
            question: requiredLeadFields.length
                ? `Validar los campos obligatorios definidos en onboarding (${requiredLeadFieldLabels}) y los datos operativos de reunión antes de confirmar. Los campos opcionales no bloquean.`
                : "Validar solo los datos operativos necesarios para calendario antes de confirmar reunión. No bloquear por campos opcionales del onboarding.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La reunión necesita datos de calendario y contacto cuando fueron definidos como obligatorios, sin agregar fricción artificial.",
        },
        {
            rule_key: "requester_timezone_required",
            question: "Antes de pedir fecha y hora, preguntar ciudad, estado/provincia si aplica y país con PLANTILLA_PEDIR_UBICACION_REUNION; inferir requester_timezone en formato IANA.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La hora indicada por el usuario debe interpretarse en requester_timezone y convertirse a business_timezone para validar disponibilidad y guardar la reunión.",
        },
        {
            rule_key: "meeting_availability",
            question: "No aceptar fechas pasadas, hoy, fines de semana, horas fuera de rango, minutos no permitidos ni bloques ocupados. Toda validación de disponibilidad se realiza en business_timezone.",
            gate_type: "blocking",
            placement: "before_scheduling",
            reason: "La agenda debe ser deterministica y no depender de improvisacion del asistente.",
        },
    ];
    const locationTerm = isAppointments ? "sedes" : (params.objective.location_term || "sedes");
    const universalTemplateEntries = applyEmojiPolicyToTemplates(buildUniversalTemplates(businessName, valueProposition || services, lopdpText, {
        isAppointments,
        locationTerm,
        emojiMode: params.style.emoji_mode,
        appointmentLocationInstruction: locationStrategy.instruction,
        appointmentLocationQuestion: locationStrategy.promptQuestion,
    }), params.style.emoji_mode);
    const objectiveTemplateEntries = applyEmojiPolicyToTemplates(isAppointments
        ? buildAppointmentTemplates(businessName, locationTerm, leadFieldsForObjective, lopdpText, {
            agenda: params.agenda,
            emojiMode: params.style.emoji_mode,
            locationListingLines,
            locationStrategy,
        })
        : buildMeetingTemplates(businessName, params.agenda, leadFieldsForObjective, lopdpText, { emojiMode: params.style.emoji_mode }), params.style.emoji_mode);
    const faqTemplateEntries = applyEmojiPolicyToTemplates(normalizeFaqEntries(faqPromptText, businessName), params.style.emoji_mode);
    const universalTemplates = universalTemplateEntries.map((template) => template.name);
    const objectiveTemplates = objectiveTemplateEntries.map((template) => template.name);
    const faqTemplates = faqTemplateEntries.map((template) => template.name);
    const universalVariablesBase = [
        "nombre",
        "apellido",
        "nombre_apellido",
        "telefono",
        "correo",
        "canal",
        "intencion_pendiente",
        "ultima_plantilla_enviada",
        "consentimiento_datos",
        "lopdp_enviado",
    ];
    const universalVariables = isAppointments ? universalVariablesBase : [
        ...universalVariablesBase,
        "fecha_base_oficial",
        "hora_base_oficial",
        "zona_horaria",
    ];
    const appointmentVariables = ["sede_confirmada", "ciudad_o_zona", "referencia_ubicacion", "appointment_timezone", "time_zone", "fecha_cita", "hora_cita", "fecha_cita_normalizada", "hora_cita_normalizada", "fecha_base_oficial", "hora_base_oficial", "CONDICION_CANAL_NO_WHATSAPP", "ORDEN_DATOS_POR_CANAL", "dia_semana", "horario_sede_texto", "CITAS_AGENDADAS", "LISTA_MIS_CITAS"];
    const meetingVariables = ["business_timezone", "requester_timezone", "requester_city", "requester_region", "requester_country", "producto_interes", "necesidad_principal", "volumen_o_frecuencia", "rango_inversion", "lead_clasificacion", "fecha_reunion", "hora_reunion", "fecha_reunion_normalizada_usuario", "hora_reunion_normalizada_usuario", "fecha_reunion_normalizada", "hora_reunion_normalizada", "fecha_usuario", "hora_usuario", "fecha_negocio", "hora_negocio", "inicio_evento", "fin_evento", "descripcion_evento", "REUNIONES_AGENDADAS", "LISTA_MIS_REUNIONES_CONSULTA"];
    const variables = [...universalVariables, ...(isAppointments ? appointmentVariables : meetingVariables)];
    const decisionSummary = {
        objective: isAppointments ? "Citas presenciales" : "Reuniones comerciales",
        filterDecision: isAppointments
            ? `Se aplico teoria de funnel de agendamiento: intención primero, fricción mínima, sede antes de confirmar y gates solo para disponibilidad o campos marcados obligatorios. Campos obligatorios antes de confirmar: ${requiredLeadFieldLabels || "ninguno"}. Pedidos al inicio: ${earlyLeadFieldLabels || "ninguno"}. Bloqueantes al inicio: ${earlyBlockingLeadFieldLabels || "ninguno"}.`
            : `Se aplico teoria de funnel comercial: calificar antes de pedir datos, consentimiento antes de capturar y gates solo para calendario o campos marcados obligatorios. Campos obligatorios antes de confirmar: ${requiredLeadFieldLabels || "ninguno"}. Pedidos al inicio: ${earlyLeadFieldLabels || "ninguno"}. Bloqueantes al inicio: ${earlyBlockingLeadFieldLabels || "ninguno"}.`,
        lopdpDecision: manualLegalText
            ? "Se uso el texto legal ingresado por el usuario para proteccion de datos."
            : dataProtectionRecommendation
                ? `Pais o region detectada: ${dataProtectionRecommendation.countryLabel}. Se sugirio aviso basado en ${dataProtectionRecommendation.lawName}.`
                : "No se reconocio una normativa automatica para el pais del negocio; queda pendiente texto legal manual antes de publicar.",
        templateDecision: "Las plantillas se separaron entre universales y especificas por objetivo, sin publicar en n8n.",
        matcherDecision: "El matcher sera deterministico y solo emitira labels permitidos.",
        compilerProfile: isAppointments ? "Perfil de citas agendadas inspirado en la estructura Monte Midas." : "Perfil de reuniones agendadas inspirado en la estructura Simplia Leads.",
        aiBrainContract: "El AI Brain decide filtros, gates, LOPDP y recomendaciones auditables; el Prompt Compiler escribe el prompt final con estructura fija.",
    };
    const promptTemplateEntries = [...universalTemplateEntries, ...objectiveTemplateEntries, ...faqTemplateEntries];
    const matcherConfig = buildMatcherConfigFromTemplates(promptTemplateEntries, isAppointments);
    const matcherTemplateCount = countUniqueTemplateNames(Object.values(matcherConfig).flatMap((entries: any) =>
        Array.isArray(entries) ? entries.map((entry: any) => ({ name: String(entry?.template || "") })) : [],
    ));
    const blocks = [
        {
            blockKey: "business_context",
            content: [
                "CONTEXTO GENERAL",
                "",
                `* Eres el Asistente Comercial Omnicanal oficial de ${businessName}.`,
                `* Tu misión es acompañar al usuario con amabilidad, claridad, calidez y enfoque comercial.`,
                `* Tu objetivo principal es ${isAppointments ? "responder dudas y agendar citas para el negocio" : "calificar leads y agendar reuniones comerciales"}.`,
                "* Siempre habla en español castellano.",
                "* Usa siempre trato de usted.",
                "* No escribas nunca en inglés.",
                "* No menciones al usuario términos internos como JSON Schema, instance, type, prompt, herramienta, nodo, workflow, score interno, base de datos, pipeline, etiqueta, tool, system message, memoria, código o lógica interna.",
                "* No incluyas el nombre de la plantilla en la respuesta final al usuario.",
                "* Si se hace uso de una plantilla, envía directamente su contenido completo, sin escribir el título de la plantilla.",
                "* Si dentro del contenido de una plantilla aparecen variables entre corchetes, como [nombre], [fecha], [hora], [correo], [agencia], [inicio_evento] o [fin_evento], reemplázalas solo si el dato existe. Si no existe, omite esa variable.",
                "* Cada respuesta debe estar formateada con \\n para los saltos de línea.",
                "* La salida debe ser válida para insertar directamente en JSON: no uses comillas dobles dentro del texto de respuesta al usuario, ni estructuras de código, llaves, corchetes ni objetos.",
                "* Nunca trates de tonto al cliente.",
                "* No inventes links, precios, descuentos, garantías, funcionalidades, casos de éxito, tiempos exactos ni resultados.",
                "",
                "DATOS GENERALES DEL NEGOCIO",
                "",
                `Empresa: ${businessName}`,
                `País: ${country || "No definido"}`,
                `Industria: ${sourceText(industry, "No definida")}`,
                `Propuesta de valor: ${sourceText(valueProposition, "No definida")}`,
                `Oferta principal: ${services || "No definida"}`,
                `Beneficios: ${sourceText(benefits, "No definidos")}`,
                `Restricciones generales: ${sourceText(restrictions, "No definidas")}`,
                `Cliente ideal: ${sourceText(icp, "No definido")}`,
                `Tono: ${tone}`,
                formatInternalDataForPrompt(params.internalData),
                "",
                buildMemoryAndStyleBlock({ tone, emojiRule, isAppointments }),
                "",
                buildPriorityRuleBlock(isAppointments),
            ].join("\n"),
        },
        {
            blockKey: "objective_config",
            content: [
                "OBJETIVO OPERATIVO",
                "",
                "PERFIL DEL COMPILADOR",
                decisionSummary.compilerProfile,
                decisionSummary.aiBrainContract,
                "",
                objectiveText,
                `Termino de ubicaciones: ${isAppointments ? locationTerm : "No aplica"}.`,
                `Costo reuniones: ${params.objective.meeting_setup_fee_usd || 0} USD.`,
                `Correo calendario: ${params.objective.calendar_email || "No aplica"}.`,
                `Google Meet: ${params.objective.meet_status || "not_applicable"}.`,
                "",
                "REGLA SUPREMA DE PRIORIDAD",
                "1. Lenguaje ofensivo, amenaza, acoso o insulto.",
                "2. Equivocación de chat.",
                `3. ${isAppointments ? "Consulta, cancelación o cambio de cita cuando aplique." : "Consultar reuniones agendadas del usuario."}`,
                `4. ${isAppointments ? "Rechazo claro o desinterés." : "Cancelar, eliminar, posponer o reprogramar reunión."}`,
                "5. Consentimiento rechazado o protección de datos pendiente.",
                "6. Solicitud directa de humano.",
                "7. Agradecimiento.",
                "8. Pregunta frecuente o interrupción.",
                `9. Flujo principal de ${isAppointments ? "ubicación, datos y cita" : "producto, calificación, consentimiento, datos y agenda"}.`,
                "10. Confirmación o cierre.",
            ].join("\n"),
            metadata: { decisionSummary },
        },
        {
            blockKey: "locations_block",
            content: [
                "SEDES Y UBICACIONES",
                "",
                isAppointments
                    ? "Este bloque es fuente de verdad para responder al usuario cuando pregunte por sedes, agencias, sucursales, direcciones, horarios o Google Maps. Lista la información en este formato oficial y no inventes sedes ni direcciones fuera de esta lista."
                    : "No aplica para reuniones. Si el usuario pregunta por ubicación física, responde con información pública confirmada y vuelve al flujo de reunión.",
                "",
                locationListingLines,
                "",
                isAppointments
                    ? [
                        "REFERENCIAS GEOGRÁFICAS PARA MATCH INTERNO",
                        "Usa alias operativos, ciudades o zonas de match, sectores o referencias cortas y ficha geográfica enriquecida para detectar la sede más probable. Si no hay coincidencia confiable, pide aclaración o muestra las sedes disponibles.",
                        "",
                        locationReferenceLines,
                        nearestLocationMapLines ? [
                            "",
                            "MAPA INTERNO DE COBERTURA Y SEDE MÁS CERCANA",
                            "Úsalo solo para decidir cobertura y sede recomendada cuando el usuario mencione una ciudad, provincia, estado, región o país. No lo muestres completo al usuario.",
                            "Si hay sedes en varios países, primero identifica el país del usuario y recomienda solo sedes confirmadas de ese país. No cruces países salvo que el usuario lo solicite.",
                            "Si el país del usuario no está confirmado, no calcules sede más cercana. Lista países/sedes confirmadas y pregunta si desea atención en alguno.",
                            "",
                            nearestLocationMapLines,
                        ].join("\n") : "",
                    ].join("\n")
                    : "",
            ].filter(Boolean).join("\n"),
        },
        {
            blockKey: "agenda_block",
            content: [
                "AGENDA Y DISPONIBILIDAD",
                "",
                `Zona horaria: ${params.agenda.timezone}`,
                `Intervalo de inicio: ${params.agenda.start_interval_minutes} minutos`,
                `Duración: ${isAppointments ? "No aplica para citas" : `${params.agenda.duration_minutes} minutos`}`,
                `Cupos por bloque: ${params.agenda.capacity_per_slot === 0 ? "Ilimitado" : params.agenda.capacity_per_slot}`,
                "",
                hourLines,
                "",
                isAppointments
                    ? "Antes de confirmar cita: validar sede, dia habil de esa sede, hora dentro de rango y cupos disponibles."
                    : "Antes de confirmar reunion: validar fecha pasada, no agendar hoy, dia habil, hora exacta, horario permitido y conflictos contra reuniones agendadas en business_timezone. La hora del usuario se interpreta en requester_timezone y se convierte al horario del negocio.",
            ].join("\n"),
        },
        {
            blockKey: "lead_fields_block",
            content: [
                "DATOS OBLIGATORIOS Y OPCIONALES DEL LEAD",
                "",
                "DATOS OBLIGATORIOS DINÁMICOS SEGÚN CANAL",
                "No pidas datos personales antes de consentimiento o aviso legal cuando aplique.",
                "Si el lead viene de WhatsApp, normalmente ya se cuenta con número y no debe repetirse.",
                "Si no viene de WhatsApp, el prompt puede solicitar teléfono cuando la configuración lo marque como requerido u opcional.",
                "",
                "Antes de confirmar el agendamiento deben existir los datos marcados como obligatorios por el negocio.",
                "No repitas preguntas si el dato ya fue entregado por el usuario o existe en memoria.",
                "",
                leadFieldLines || "No se configuraron campos adicionales. Fecha y hora siguen siendo variables operativas obligatorias.",
                "",
                "REGLA DE CAPTURA POR ETAPA",
                "- Captura al inicio + bloquea el flujo inicial: pedir el dato en bienvenida y no responder preguntas del negocio ni avanzar hasta recibirlo.",
                "- Captura al inicio + no bloquea el flujo inicial: pedir el dato una vez; si el usuario no lo entrega, responder su pregunta o continuar el flujo y volver a pedirlo antes de confirmar.",
                "- Captura cuando vaya a agendar: no pedir el dato en bienvenida; pedirlo en la plantilla de datos y bloquear solo antes de confirmar si es obligatorio.",
                "- Los campos opcionales pueden pedirse dentro de la plantilla de datos, pero nunca bloquean la confirmación si el usuario no los entrega.",
                "",
                isAppointments
                    ? "Fecha y hora de cita son variables operativas y siempre deben normalizarse antes de confirmar."
                    : "Fecha, hora, inicio_evento, fin_evento y descripcion_evento son variables operativas de reunión.",
            ].join("\n"),
        },
        {
            blockKey: "filters_block",
            content: [
                "FILTROS, GATES Y REGLAS BLOQUEANTES CONFIGURABLES",
                "",
                "MARCO DE DECISIÓN DE FUNNEL DE AGENDAMIENTO",
                "",
                "- Intención primero: detectar saludo, pregunta directa, interés o rechazo antes de pedir datos.",
                "- Fricción mínima: no pedir nombre, teléfono, correo ni identificación en bienvenida salvo que el onboarding indique captura al inicio.",
                "- Captura temprana no bloqueante: si el usuario no entrega el dato, se responde su consulta y se vuelve a pedir antes de confirmar.",
                "- Captura temprana bloqueante: solo aplica cuando el onboarding marque explícitamente que ese campo bloquea el inicio.",
                "- Progressive profiling: los datos se piden cuando el usuario ya avanza hacia agenda, no como barrera inicial.",
                "- Gate bloqueante: solo se usa antes de confirmar una cita o reunión cuando falta sede, fecha/hora válida, disponibilidad o un campo marcado como obligatorio.",
                "- Campo opcional: puede solicitarse dentro de plantillas de datos, pero nunca debe bloquear el avance ni impedir confirmación si no fue marcado obligatorio.",
                "",
                ...filters.map((filter, index) => renderFilterDecision(filter, index)),
            ].join("\n\n"),
            metadata: { filters, gates: filters.filter((filter) => filter.gate_type === "blocking"), decisionSummary },
        },
        {
            blockKey: "lopdp_block",
            content: [
                "PROTECCIÓN DE DATOS PERSONALES",
                "",
                "Ubicación recomendada del aviso legal:",
                "Antes de pedir datos personales y, si no se envió antes, antes de la confirmación final.",
                "",
                `Normativa sugerida: ${dataProtectionRecommendation?.lawName || "Pendiente de confirmar"}.`,
                `País o región: ${dataProtectionRecommendation?.countryLabel || country || "No definido"}.`,
                dataProtectionRecommendation?.sourceUrl ? `Fuente de referencia: ${dataProtectionRecommendation.sourceUrl}` : "Fuente de referencia: pendiente de revisión legal.",
                "",
                "Texto:",
                lopdpText,
                "",
                "Regla:",
                "No pedir datos personales antes de consentimiento o aviso legal cuando aplique. No duplicar el texto si lopdp_enviado = true.",
            ].join("\n"),
            metadata: {
                status: lopdpStatus,
                placementOption: 3,
                country,
                lawName: dataProtectionRecommendation?.lawName || null,
                sourceUrl: dataProtectionRecommendation?.sourceUrl || null,
                countryLabel: dataProtectionRecommendation?.countryLabel || null,
                decision: decisionSummary.lopdpDecision,
            },
        },
        {
            blockKey: "templates_block",
            content: [
                "PLANTILLAS CONVERSACIONALES",
                "",
                "Reglas críticas de uso de plantillas:",
                "* Cuando una situación tenga plantilla definida, debes usar la plantilla literal.",
                "* No redactes libremente una respuesta cuando exista plantilla para ese caso.",
                "* No agregues texto adicional antes o después de una plantilla obligatoria.",
                "* No incluyas el nombre de la plantilla en la respuesta final al usuario.",
                "* Reemplaza variables conocidas y omite variables desconocidas.",
                `* Tono: ${tone}. ${emojiRule}`,
                "",
                "PLANTILLAS UNIVERSALES PARA CITAS Y REUNIONES",
                renderNamedItems(universalTemplateEntries),
                "",
                isAppointments ? "PLANTILLAS UNIVERSALES PARA CITAS AGENDADAS" : "PLANTILLAS UNIVERSALES PARA REUNIONES AGENDADAS",
                renderNamedItems(objectiveTemplateEntries),
            ].join("\n"),
            metadata: {
                templates: [...universalTemplates, ...objectiveTemplates],
                universalTemplates,
                objectiveTemplates,
                templateGroups: {
                    universal: universalTemplates,
                    appointments: isAppointments ? objectiveTemplates : [],
                    meetings: isAppointments ? [] : objectiveTemplates,
                    faqs: faqTemplates,
                },
                templateEntries: {
                    universal: universalTemplateEntries,
                    objective: objectiveTemplateEntries,
                    faqs: faqTemplateEntries,
                    all: promptTemplateEntries,
                },
                templateCounts: {
                    promptCandidate: countUniqueTemplateNames(promptTemplateEntries),
                    matcherDeterministic: matcherTemplateCount,
                    universal: countUniqueTemplateNames(universalTemplateEntries),
                    objective: countUniqueTemplateNames(objectiveTemplateEntries),
                    faqs: countUniqueTemplateNames(faqTemplateEntries),
                },
                decision: decisionSummary.templateDecision,
            },
        },
        {
            blockKey: "variables_block",
            content: [
                "MARCADORES Y DATOS OPERATIVOS DEL PROMPT",
                "",
                buildUniversalVariableBlock(params.agenda.timezone, !isAppointments),
                "",
                isAppointments ? buildAppointmentsVariableBlock(params.agenda.timezone, params.locations) : buildMeetingsVariableBlock(params.agenda.timezone),
            ].join("\n"),
            metadata: {
                variables,
                variableGroups: {
                    universal: universalVariables,
                    appointments: isAppointments ? appointmentVariables : [],
                    meetings: isAppointments ? [] : meetingVariables,
                },
                decision: "Se incluyeron variables universales y variables especificas del objetivo para que el prompt sea escalable.",
            },
        },
        {
            blockKey: "faq_products_block",
            content: [
                "PREGUNTAS FRECUENTES Y RESPUESTAS PUBLICAS",
                "",
                "FAQs candidatas construidas desde scraping y respuestas del usuario:",
                faqPromptText,
                "",
                isAppointments
                    ? buildAppointmentFlowBlock({ businessName, locationTerm, hasLocations: params.locations.length > 0, locationStrategyInstruction: locationStrategy.instruction })
                    : buildMeetingFlowBlock({ businessName, timezone: params.agenda.timezone, durationMinutes: params.agenda.duration_minutes || 30, intervalMinutes: params.agenda.start_interval_minutes || 60 }),
                "",
                buildNoHallucinationBlock(),
                "",
                "INSTRUCCIONES DE LA RESPUESTA",
                "* Responde en texto formateado usando \\n para cada salto de línea.",
                "* No uses comillas dobles dentro del texto.",
                "* Mantén respuestas claras, útiles y sin errores de formato.",
                "* No incluyas llaves, corchetes ni objetos en la respuesta al usuario.",
                "* No inventes información no confirmada por el negocio.",
                "",
                "ORDEN FINAL OBLIGATORIO DEL FLUJO",
                isAppointments
                    ? "1. Saludo e identificación de intención.\n2. Resolver preguntas directas si aplica.\n3. Confirmar sede; usar ciudad, zona o referencia solo si ayuda a filtrar varias sedes.\n4. Mostrar sedes cuando haga falta.\n5. Confirmar sede elegida.\n6. Si consulta, cancela o elimina una cita existente, revisar LISTA_MIS_CITAS.\n7. Pedir datos obligatorios del lead.\n8. Normalizar fecha y hora.\n9. Validar día hábil, horario de sede, cupos y conflictos contra CITAS_AGENDADAS.\n10. Confirmar con PLANTILLA_CONFIRMACION."
                    : "1. Saludo e identificación de intención.\n2. Producto o necesidad.\n3. Filtros comerciales.\n4. Consentimiento de datos.\n5. Nombre y apellido y datos obligatorios configurados.\n6. Correo electrónico válido.\n7. Pedir ubicación del usuario con PLANTILLA_PEDIR_UBICACION_REUNION.\n8. Inferir requester_timezone IANA.\n9. Pedir fecha y hora.\n10. Interpretar fecha/hora en requester_timezone y convertir a business_timezone.\n11. Validar fecha pasada, no hoy, día hábil, horario e intervalos en business_timezone.\n12. Revisar REUNIONES_AGENDADAS.\n13. Preparar inicio_evento, fin_evento y descripcion_evento en business_timezone.\n14. Confirmar con PLANTILLA_CONFIRMACION_REUNION mostrando hora del usuario y hora del negocio.",
            ].join("\n"),
        },
    ];
    const compilerInput = {
        isAppointments,
        businessName,
        country,
        industry,
        valueProposition,
        services,
        benefits,
        restrictions,
        icp,
        tone,
        emojiMode: params.style.emoji_mode,
        emojiRule,
        internalData: params.internalData,
        locationTerm,
        locationListingLines,
        locationReferenceLines,
        nearestLocationMapLines,
        locationStrategy,
        leadFieldLines,
        requiredLeadFields: requiredLeadFields.map((field: any) => ({
            fieldKey: field.fieldKey,
            label: leadFieldRequestLabel(field),
            captureTiming: field.captureTiming,
            blocksEarlyFlow: Boolean(field.blocksEarlyFlow),
        })),
        earlyLeadFields: earlyLeadFields.map((field: any) => ({
            fieldKey: field.fieldKey,
            label: leadFieldRequestLabel(field),
            required: Boolean(field.required),
            blocksEarlyFlow: Boolean(field.blocksEarlyFlow),
        })),
        earlyRequiredLeadFields: earlyRequiredLeadFields.map((field: any) => ({
            fieldKey: field.fieldKey,
            label: leadFieldRequestLabel(field),
            blocksEarlyFlow: Boolean(field.blocksEarlyFlow),
        })),
        earlyBlockingLeadFields: earlyBlockingLeadFields.map((field: any) => ({
            fieldKey: field.fieldKey,
            label: leadFieldRequestLabel(field),
        })),
        requiredLeadFieldLabels,
        earlyLeadFieldLabels,
        earlyRequiredLeadFieldLabels,
        earlyNonBlockingLeadFieldLabels,
        earlyBlockingLeadFieldLabels,
        agenda: params.agenda,
        locations: params.locations,
        filters,
        lopdpText,
        faqTemplates: faqTemplateEntries,
        universalTemplateEntries,
        objectiveTemplateEntries,
    };
    const compiledPrompt = isAppointments
        ? buildAppointmentCompiledPrompt(compilerInput)
        : buildMeetingCompiledPrompt(compilerInput);
    return {
        blocks: [...blocks, { blockKey: "compiled_prompt", content: compiledPrompt }],
        compiledPrompt,
        filters,
        lopdp: {
            country,
            placementOption: 3,
            legalText: lopdpText,
            status: lopdpStatus,
            lawName: dataProtectionRecommendation?.lawName || null,
            sourceUrl: dataProtectionRecommendation?.sourceUrl || null,
            countryLabel: dataProtectionRecommendation?.countryLabel || null,
        },
        matcherConfig,
        matcherCode: buildMatcherCode(matcherConfig),
        matcherLabels: Object.keys(matcherConfig),
        compilerInput,
    };
};

const parseOpenAiStructuredOutput = (payload: any) => {
    const outputText = payload.output?.flatMap((item: any) => item.content || [])
        .find((item: any) => item.type === "output_text")?.text;
    if (!outputText) return null;
    try {
        return JSON.parse(outputText);
    } catch {
        return null;
    }
};

const attachAiBrainRuntimeMetadata = (assets: any, runtime: Record<string, unknown>) => {
    const objectiveBlock = assets.blocks?.find((block: any) => block.blockKey === "objective_config");
    if (objectiveBlock) {
        objectiveBlock.metadata = {
            ...(objectiveBlock.metadata || {}),
            aiBrainRuntime: runtime,
        };
    }
    return assets;
};

const applyAiBrainOverrides = (baseline: any, aiOutput: any) => {
    const assets = {
        ...baseline,
        blocks: baseline.blocks
            .filter((block: any) => block.blockKey !== "compiled_prompt")
            .map((block: any) => ({ ...block, metadata: block.metadata ? { ...block.metadata } : undefined })),
    };
    const isAppointments = Boolean(assets.compilerInput?.isAppointments);
    const hasRequiredLeadFields = Array.isArray(assets.compilerInput?.requiredLeadFields) && assets.compilerInput.requiredLeadFields.length > 0;
    const hasEarlyRequiredLeadFields = Array.isArray(assets.compilerInput?.earlyRequiredLeadFields) && assets.compilerInput.earlyRequiredLeadFields.length > 0;
    const hasEarlyBlockingLeadFields = Array.isArray(assets.compilerInput?.earlyBlockingLeadFields) && assets.compilerInput.earlyBlockingLeadFields.length > 0;
    const filters = Array.isArray(aiOutput?.filters)
        ? (() => {
            const normalizedFilters = aiOutput.filters
            .map((filter: any) => ({
                rule_key: String(filter.rule_key || "").trim(),
                question: String(filter.question || "").trim(),
                gate_type: filter.gate_type === "blocking" ? "blocking" : "non_blocking",
                placement: ["welcome", "after_welcome", "before_scheduling"].includes(filter.placement) ? filter.placement : "after_welcome",
                reason: String(filter.reason || "").trim(),
            }))
            .filter((filter: any) => filter.rule_key && filter.question)
            .filter((filter: any) => !(isAppointments && filter.rule_key === "lead_required_fields" && !hasRequiredLeadFields))
            .filter((filter: any) => !(filter.rule_key === "early_required_fields" && !hasEarlyRequiredLeadFields))
            .map((filter: any) => filter.rule_key === "early_required_fields" && !hasEarlyBlockingLeadFields
                ? { ...filter, gate_type: "non_blocking" }
                : filter);
            const ensureBaselineFilter = (ruleKey: string) => {
                if (normalizedFilters.some((filter: any) => filter.rule_key === ruleKey)) return;
                const baselineFilter = (baseline.filters || []).find((filter: any) => filter.rule_key === ruleKey);
                if (baselineFilter) normalizedFilters.push(baselineFilter);
            };
            if (hasEarlyRequiredLeadFields) ensureBaselineFilter("early_required_fields");
            if (hasRequiredLeadFields) ensureBaselineFilter(isAppointments ? "lead_required_fields" : "meeting_required_fields");
            return normalizedFilters;
        })()
        : [];
    if (filters.length) {
        assets.filters = filters;
        if (assets.compilerInput) assets.compilerInput.filters = filters;
        const filterBlock = assets.blocks.find((block: any) => block.blockKey === "filters_block");
        if (filterBlock) {
            filterBlock.content = [
                "FILTROS, GATES Y REGLAS BLOQUEANTES CONFIGURABLES",
                "",
                "MARCO DE DECISIÓN DE FUNNEL DE AGENDAMIENTO",
                "",
                "- Intención primero: detectar saludo, pregunta directa, interés o rechazo antes de pedir datos.",
                "- Fricción mínima: no pedir nombre, teléfono, correo ni identificación en bienvenida salvo que el onboarding indique captura al inicio.",
                "- Captura temprana no bloqueante: si el usuario no entrega el dato, se responde su consulta y se vuelve a pedir antes de confirmar.",
                "- Captura temprana bloqueante: solo aplica cuando el onboarding marque explícitamente que ese campo bloquea el inicio.",
                "- Progressive profiling: los datos se piden cuando el usuario ya avanza hacia agenda, no como barrera inicial.",
                "- Gate bloqueante: solo se usa antes de confirmar una cita o reunión cuando falta sede, fecha/hora válida, disponibilidad o un campo marcado como obligatorio.",
                "- Campo opcional: puede solicitarse dentro de plantillas de datos, pero nunca debe bloquear el avance ni impedir confirmación si no fue marcado obligatorio.",
                "",
                ...filters.map((filter: any, index: number) => renderFilterDecision(filter, index)),
            ].join("\n\n");
            filterBlock.metadata = { ...(filterBlock.metadata || {}), filters, gates: filters.filter((filter: any) => filter.gate_type === "blocking") };
        }
    }
    const lopdp = aiOutput?.lopdp || {};
    const legalText = String(lopdp.legalText || "").trim();
    if (legalText) {
        const placementOption = Number(lopdp.placementOption || 3);
        const status = lopdp.status === "pending_legal_review" ? "pending_legal_review" : "generated";
        assets.lopdp = {
            ...assets.lopdp,
            placementOption: placementOption >= 1 && placementOption <= 4 ? placementOption : 3,
            legalText,
            status,
        };
        if (assets.compilerInput) assets.compilerInput.lopdpText = legalText;
        const lopdpBlock = assets.blocks.find((block: any) => block.blockKey === "lopdp_block");
        if (lopdpBlock) {
            lopdpBlock.content = [
                "PROTECCIÓN DE DATOS PERSONALES",
                "",
                "Ubicación recomendada del aviso legal:",
                "Antes de pedir datos personales y, si no se envió antes, antes de la confirmación final.",
                "",
                `Normativa sugerida: ${assets.lopdp.lawName || "Pendiente de confirmar"}.`,
                `País o región: ${assets.lopdp.countryLabel || assets.lopdp.country || "No definido"}.`,
                assets.lopdp.sourceUrl ? `Fuente de referencia: ${assets.lopdp.sourceUrl}` : "Fuente de referencia: pendiente de revisión legal.",
                "",
                "Texto:",
                legalText,
                "",
                "Regla:",
                "No pedir datos personales antes de consentimiento o aviso legal cuando aplique. No duplicar el texto si lopdp_enviado = true.",
            ].join("\n");
            lopdpBlock.metadata = { ...(lopdpBlock.metadata || {}), status, placementOption: assets.lopdp.placementOption };
        }
    }
    const decisionNotes = Array.isArray(aiOutput?.decisionNotes)
        ? aiOutput.decisionNotes.map((item: any) => String(item || "").trim()).filter(Boolean).slice(0, 12)
        : [];
    if (decisionNotes.length) {
        const objectiveBlock = assets.blocks.find((block: any) => block.blockKey === "objective_config");
        if (objectiveBlock) {
            objectiveBlock.metadata = {
                ...(objectiveBlock.metadata || {}),
                aiBrainDecisionNotes: decisionNotes,
            };
        }
    }
    const templateActions = Array.isArray(aiOutput?.templateActions)
        ? aiOutput.templateActions
            .map((item: any) => ({
                template: String(item.template || "").trim(),
                action: String(item.action || "").trim(),
                reason: String(item.reason || "").trim(),
            }))
            .filter((item: any) => item.template && item.action)
            .slice(0, 20)
        : [];
    if (templateActions.length) {
        const templateBlock = assets.blocks.find((block: any) => block.blockKey === "templates_block");
        if (templateBlock) {
            templateBlock.metadata = {
                ...(templateBlock.metadata || {}),
                aiBrainTemplateActions: templateActions,
            };
        }
    }
    const faqRecommendations = Array.isArray(aiOutput?.faqRecommendations)
        ? aiOutput.faqRecommendations
            .map((item: any) => ({
                question: String(item.question || "").trim(),
                answer: String(item.answer || "").trim(),
                reason: String(item.reason || "").trim(),
            }))
            .filter((item: any) => item.question && item.answer)
            .slice(0, 20)
        : [];
    if (faqRecommendations.length) {
        if (assets.compilerInput) {
            const faqText = faqRecommendations
                .map((item: any) => `${item.question.replace(/\?*$/, "?")} Respuesta: ${item.answer}`)
                .join("\n");
            assets.compilerInput.faqTemplates = applyEmojiPolicyToTemplates(
                normalizeFaqEntries(faqText, assets.compilerInput.businessName || "el negocio"),
                assets.compilerInput.emojiMode || "moderate",
            );
        }
        const faqBlock = assets.blocks.find((block: any) => block.blockKey === "faq_products_block");
        if (faqBlock) {
            const aiFaqText = faqRecommendations
                .map((item: any) => `${item.question.replace(/\?*$/, "?")} Respuesta: ${item.answer}`)
                .join("\n");
            const flowMarker = "\n\nFLUJO PRINCIPAL";
            const [beforeFlow, ...afterFlowParts] = String(faqBlock.content || "").split(flowMarker);
            if (afterFlowParts.length) {
                const beforeFaq = beforeFlow.replace(
                    /(FAQs candidatas construidas desde scraping y respuestas del usuario:\n)([\s\S]*)$/,
                    `$1${aiFaqText}`,
                );
                faqBlock.content = `${beforeFaq}${flowMarker}${afterFlowParts.join(flowMarker)}`;
            }
            faqBlock.metadata = {
                ...(faqBlock.metadata || {}),
                aiBrainFaqRecommendations: faqRecommendations,
            };
        }
    }
    if (assets.compilerInput?.isAppointments) {
        assets.compiledPrompt = buildAppointmentCompiledPrompt(assets.compilerInput);
        const allTemplates = [
            ...(assets.compilerInput.universalTemplateEntries || []),
            ...(assets.compilerInput.objectiveTemplateEntries || []),
            ...(assets.compilerInput.faqTemplates || []),
        ];
        assets.matcherConfig = buildMatcherConfigFromTemplates(allTemplates, true);
        assets.matcherCode = buildMatcherCode(assets.matcherConfig);
        assets.matcherLabels = Object.keys(assets.matcherConfig);
        const matcherTemplateCount = countUniqueTemplateNames(Object.values(assets.matcherConfig).flatMap((entries: any) =>
            Array.isArray(entries) ? entries.map((entry: any) => ({ name: String(entry?.template || "") })) : [],
        ));
        const templateBlock = assets.blocks.find((block: any) => block.blockKey === "templates_block");
        if (templateBlock) {
            templateBlock.metadata = {
                ...(templateBlock.metadata || {}),
                templateEntries: {
                    universal: assets.compilerInput.universalTemplateEntries || [],
                    objective: assets.compilerInput.objectiveTemplateEntries || [],
                    faqs: assets.compilerInput.faqTemplates || [],
                    all: allTemplates,
                },
                templateGroups: {
                    ...(templateBlock.metadata?.templateGroups || {}),
                    faqs: (assets.compilerInput.faqTemplates || []).map((template: any) => template.name),
                },
                templateCounts: {
                    promptCandidate: countUniqueTemplateNames(allTemplates),
                    matcherDeterministic: matcherTemplateCount,
                    universal: countUniqueTemplateNames(assets.compilerInput.universalTemplateEntries || []),
                    objective: countUniqueTemplateNames(assets.compilerInput.objectiveTemplateEntries || []),
                    faqs: countUniqueTemplateNames(assets.compilerInput.faqTemplates || []),
                },
            };
        }
    } else {
        assets.compiledPrompt = rebuildCompiledPrompt(assets.blocks);
    }
    assets.blocks = [...assets.blocks, { blockKey: "compiled_prompt", content: assets.compiledPrompt }];
    return assets;
};

const buildOperationalAssetsWithAi = async (params: {
    project: any;
    fields: any[];
    internalData: any;
    objective: any;
    locations: any[];
    agenda: any;
    leadFields: any[];
    style: any;
    legalTextOverride?: string | null;
}) => {
    const baseline = buildOperationalAssets(params);
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
    const model = Deno.env.get("BRE_BRAIN_MODEL") || "gpt-5.4";
    const fallback = (mode: string, errorMessage?: string) => ({
        assets: attachAiBrainRuntimeMetadata(baseline, {
            mode,
            model: errorMessage ? model : "deterministic-ai-brain-v1",
            requestedModel: model,
            fallback: true,
            error: errorMessage || null,
        }),
        model: errorMessage ? model : "deterministic-ai-brain-v1",
        status: "completed",
        outputPayload: {
            mode,
            fallback: true,
            error: errorMessage || null,
            filters: baseline.filters,
            matcherLabels: baseline.matcherLabels,
        },
        errorMessage: errorMessage || null,
    });
    if (!openAiKey) return fallback("deterministic_no_openai_key");
    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                input: [{
                    role: "user",
                    content: [
                        "Eres el AI Brain de onboarding BRE para Simple Leads.",
                        "No escribas el prompt final. No redactes bloques libres para pegar en el prompt.",
                        "Devuelve únicamente decisiones estructuradas para que un Prompt Compiler determinístico construya el prompt final.",
                        "Genera mejoras operativas para filtros, gates, LOPDP, plantillas y FAQs, siempre auditables.",
                        "No cambies el objetivo, agenda, sedes ni campos capturados por el usuario.",
                        "No inventes datos; si falta base legal en el catálogo de recomendaciones, marca pendiente de revisión legal.",
                        "El matcher de runtime será determinístico y solo puede usar labels permitidos.",
                        JSON.stringify({
                            project: { id: params.project.id, name: params.project.name },
                            context: params.fields.map((field: any) => ({ key: field.key, value: field.value, origin: field.origin, confidence: field.confidence, status: field.status })),
                            internalData: params.internalData,
                            objective: params.objective,
                            locations: params.locations,
                            agenda: params.agenda,
                            leadFields: params.objective?.objective === "meetings"
                                ? (params.leadFields || []).map(forceMeetingLeadFieldEnabled)
                                : params.leadFields,
                            style: params.style,
                            deterministicBaseline: {
                                filters: baseline.filters,
                                lopdp: baseline.lopdp,
                                matcherLabels: baseline.matcherLabels,
                            },
                        }),
                    ].join("\n\n"),
                }],
                text: {
                    format: {
                        type: "json_schema",
                        name: "bre_operational_ai_brain",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                filters: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            rule_key: { type: "string" },
                                            question: { type: "string" },
                                            gate_type: { type: "string", enum: ["blocking", "non_blocking"] },
                                            placement: { type: "string", enum: ["welcome", "after_welcome", "before_scheduling"] },
                                            reason: { type: "string" },
                                        },
                                        required: ["rule_key", "question", "gate_type", "placement", "reason"],
                                        additionalProperties: false,
                                    },
                                },
                                lopdp: {
                                    type: "object",
                                    properties: {
                                        placementOption: { type: "number" },
                                        legalText: { type: "string" },
                                        status: { type: "string", enum: ["generated", "pending_legal_review"] },
                                    },
                                    required: ["placementOption", "legalText", "status"],
                                    additionalProperties: false,
                                },
                                decisionNotes: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                templateActions: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            template: { type: "string" },
                                            action: { type: "string" },
                                            reason: { type: "string" },
                                        },
                                        required: ["template", "action", "reason"],
                                        additionalProperties: false,
                                    },
                                },
                                faqRecommendations: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            question: { type: "string" },
                                            answer: { type: "string" },
                                            reason: { type: "string" },
                                        },
                                        required: ["question", "answer", "reason"],
                                        additionalProperties: false,
                                    },
                                },
                            },
                            required: ["filters", "lopdp", "decisionNotes", "templateActions", "faqRecommendations"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });
        if (!response.ok) return fallback("openai_failed_fallback", `OpenAI AI Brain HTTP ${response.status}`);
        const payload = await response.json();
        const aiOutput = parseOpenAiStructuredOutput(payload);
        if (!aiOutput) return fallback("openai_invalid_output_fallback", "OpenAI AI Brain no devolvió JSON estructurado válido.");
        const assets = attachAiBrainRuntimeMetadata(applyAiBrainOverrides(baseline, aiOutput), {
            mode: "openai_structured_outputs",
            model,
            requestedModel: model,
            fallback: false,
        });
        return {
            assets,
            model,
            status: "completed",
            outputPayload: {
                mode: "openai_structured_outputs",
                fallback: false,
                aiOutput,
                filters: assets.filters,
                lopdp: assets.lopdp,
                matcherLabels: assets.matcherLabels,
                usage: payload.usage || null,
            },
            errorMessage: null,
        };
    } catch (error) {
        return fallback("openai_exception_fallback", stringifyError(error));
    }
};

const dynamicQuestionRequirements = (fields: any[]) => fields
    .filter((field) => dynamicFieldKeys.has(field.key))
    .filter((field) => {
        if (field.contradiction) return true;
        if (field.origin === "inferred") return !["confirmed", "corrected"].includes(field.status);
        if (field.status === "not_found") return field.requiredForBase !== false;
        if (field.status === "pending_validation") return true;
        if (["medium", "low"].includes(field.confidence)) return !["confirmed", "corrected"].includes(field.status);
        return false;
    })
    .map((field) => ({
        fieldKey: field.key,
        reason: field.contradiction
            ? "contradiction"
            : field.status === "not_found"
                ? "not_found"
                : field.confidence === "low"
                    ? "low_confidence"
                    : "confirmation",
        suggestedValue: field.value,
        alternatives: field.alternatives || [],
    }));

const validateManualAnswer = async (
    admin: any,
    bre: any,
    projectId: string,
    fieldKey: string,
    value: unknown,
    previousValue: unknown,
) => {
    const model = Deno.env.get("BRE_VALIDATION_MODEL") || "gpt-5.4-mini";
    const { data: validationRun, error: insertError } = await bre.from("validation_runs").insert({
        project_id: projectId,
        field_key: fieldKey,
        model,
        status: "queued",
        input_payload: { value, previousValue },
    }).select("id").single();
    if (insertError) throw insertError;
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!openAiKey) {
        await bre.from("validation_runs").update({
            status: "completed",
            output_payload: { valid: true, mode: "deterministic_non_empty" },
            completed_at: new Date().toISOString(),
        }).eq("id", validationRun.id);
        return;
    }
    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                input: [{
                    role: "user",
                    content: `Validate whether this onboarding answer is useful, coherent and actually answers the field. Field: ${fieldKey}. Previous detected value: ${JSON.stringify(previousValue)}. User answer: ${JSON.stringify(value)}. Reject only empty, nonsensical or unrelated answers.`,
                }],
                text: {
                    format: {
                        type: "json_schema",
                        name: "bre_answer_validation",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                valid: { type: "boolean" },
                                reason: { type: "string" },
                            },
                            required: ["valid", "reason"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });
        assert(response.ok, `OpenAI validation failed with HTTP ${response.status}`);
        const payload = await response.json();
        const outputText = payload.output?.flatMap((item: any) => item.content || [])
            .find((item: any) => item.type === "output_text")?.text;
        const result = JSON.parse(outputText || "{}");
        await bre.from("validation_runs").update({
            status: "completed",
            output_payload: result,
            completed_at: new Date().toISOString(),
        }).eq("id", validationRun.id);
        await bre.from("ai_runs").insert({
            project_id: projectId,
            purpose: "validate_answer",
            model,
            status: "completed",
            output_payload: result,
            completed_at: new Date().toISOString(),
        });
        assert(result.valid === true, result.reason || "La respuesta no parece corresponder al campo.");
    } catch (error) {
        await bre.from("validation_runs").update({
            status: "failed",
            error_message: errorMessage(error),
            completed_at: new Date().toISOString(),
        }).eq("id", validationRun.id);
        throw error;
    }
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        assert(req.method === "POST", "Método no permitido.", 405);
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        assert(supabaseUrl && serviceRoleKey, "Configuración de Supabase incompleta.", 500);
        const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
        const bre = admin.schema("bre");
        const body = await req.json();
        const action = String(body?.action || "");
        const workerActions = new Set(["claim_worker_job", "get_worker_normalization_documents", "register_discovered_sources", "update_worker_progress", "complete_worker_job", "fail_worker_job"]);

        if (workerActions.has(action)) {
            const expectedSecret = Deno.env.get("BRE_WORKER_SECRET") || "";
            assert(expectedSecret && req.headers.get("x-bre-worker-secret") === expectedSecret, "Worker no autorizado.", 401);

            if (action === "claim_worker_job") {
                const { data: expiredRaw } = await bre.from("source_documents")
                    .select("id,storage_path")
                    .not("storage_path", "is", null)
                    .lt("raw_expires_at", new Date().toISOString())
                    .limit(100);
                const paths = (expiredRaw || []).map((item: any) => item.storage_path).filter(Boolean);
                if (paths.length) {
                    await admin.storage.from("bre-raw").remove(paths);
                    await bre.from("source_documents").update({ storage_path: null }).in("id", (expiredRaw || []).map((item: any) => item.id));
                }
                const { data, error } = await admin.rpc("bre_read_scrape_jobs", {
                    visibility_timeout: Math.min(Math.max(Number(body.visibilityTimeout || 900), 60), 3600),
                    quantity: 1,
                });
                if (error) throw error;
                return json({ job: data?.[0] || null });
            }

            if (action === "get_worker_normalization_documents") {
                const projectId = String(body.projectId || "");
                assert(projectId, "projectId es obligatorio.");
                const excludedSourceIds = Array.isArray(body.excludedSourceIds)
                    ? body.excludedSourceIds.map(String).filter(Boolean)
                    : [];
                let query = bre.from("source_documents")
                    .select("source_id,url,title,extracted_text,content_hash,captured_at,metadata,sources(source_type)")
                    .eq("project_id", projectId)
                    .order("captured_at", { ascending: false })
                    .limit(250);
                if (excludedSourceIds.length) query = query.not("source_id", "in", `(${excludedSourceIds.join(",")})`);
                const { data: storedDocuments, error: documentsError } = await query;
                if (documentsError) throw documentsError;
                const uniqueDocuments = new Map<string, any>();
                for (const document of storedDocuments || []) {
                    const key = `${document.source_id}:${document.url}`;
                    if (!uniqueDocuments.has(key) && document.extracted_text) uniqueDocuments.set(key, document);
                }
                const { data: website } = await bre.from("sources")
                    .select("status").eq("project_id", projectId).eq("source_type", "website").maybeSingle();
                return json({
                    websiteCompleted: website?.status === "completed",
                    documents: Array.from(uniqueDocuments.values()).map((document: any) => ({
                        sourceId: document.source_id,
                        sourceType: document.sources?.source_type || "other",
                        url: document.url,
                        title: document.title,
                        extractedText: document.extracted_text,
                        contentHash: document.content_hash,
                        capturedAt: document.captured_at,
                        metadata: document.metadata || {},
                    })),
                });
            }

            if (action === "register_discovered_sources") {
                const projectId = String(body.projectId || "");
                const runId = String(body.runId || "");
                assert(projectId && runId, "runId y projectId son obligatorios.");
                const incoming = Array.isArray(body.sources) ? body.sources : [];
                for (const discovered of incoming) {
                    try {
                        const normalized = normalizePublicUrl(discovered.url);
                        const sourceType = sourceTypes.has(discovered.type) ? discovered.type : "other";
                        await bre.from("sources").upsert({
                            project_id: projectId,
                            source_type: sourceType,
                            url: normalized,
                            normalized_url: normalized,
                            source_origin: "discovered",
                            status: "queued",
                        }, { onConflict: "project_id,normalized_url", ignoreDuplicates: true });
                    } catch {
                        // Unsafe discoveries are ignored and never queued.
                    }
                }
                const normalizedUrls = incoming.flatMap((item: any) => {
                    try { return [normalizePublicUrl(item.url)]; } catch { return []; }
                });
                if (!normalizedUrls.length) return json({ sources: [] });
                const { data: discoveredRows, error: discoveredError } = await bre.from("sources")
                    .select("id,source_type,url")
                    .eq("project_id", projectId)
                    .in("normalized_url", normalizedUrls);
                if (discoveredError) throw discoveredError;
                for (const source of discoveredRows || []) {
                    await bre.from("scrape_source_runs").upsert({
                        run_id: runId,
                        source_id: source.id,
                        status: "queued",
                    }, { onConflict: "run_id,source_id,attempt", ignoreDuplicates: true });
                }
                const { count } = await bre.from("scrape_source_runs").select("id", { count: "exact", head: true }).eq("run_id", runId);
                await bre.from("scrape_runs").update({ sources_total: count || 0 }).eq("id", runId);
                return json({ sources: (discoveredRows || []).map((source: any) => ({
                    id: source.id,
                    type: source.source_type,
                    url: source.url,
                })) });
            }

            if (action === "update_worker_progress") {
                const runId = String(body.runId || "");
                const projectId = String(body.projectId || "");
                assert(runId && projectId, "runId y projectId son obligatorios.");
                if (body.sourceId) {
                    await bre.from("scrape_source_runs").update({
                        status: body.sourceStatus || "processing",
                        pages_processed: Number(body.sourcePagesProcessed || 0),
                        error_code: body.errorCode || null,
                        error_message: body.errorMessage || null,
                        started_at: body.sourceStatus === "processing" ? new Date().toISOString() : undefined,
                        finished_at: ["completed", "partial", "platform_blocked", "failed"].includes(body.sourceStatus)
                            ? new Date().toISOString()
                            : null,
                    }).eq("run_id", runId).eq("source_id", body.sourceId);
                    await bre.from("sources").update({
                        status: body.sourceStatus || "processing",
                        pages_processed: Number(body.sourcePagesProcessed || 0),
                        error_code: body.errorCode || null,
                        error_message: body.errorMessage || null,
                    }).eq("id", body.sourceId).eq("project_id", projectId);
                }
                await bre.from("scrape_runs").update({
                    status: "processing",
                    pages_processed: Number(body.pagesProcessed || 0),
                    sources_completed: Number(body.sourcesCompleted || 0),
                    started_at: body.startedAt || new Date().toISOString(),
                }).eq("id", runId).eq("project_id", projectId);
                return json({ success: true });
            }

            if (action === "fail_worker_job") {
                const runId = String(body.runId || "");
                const projectId = String(body.projectId || "");
                assert(runId && projectId, "runId y projectId son obligatorios.");
                await bre.from("scrape_runs").update({
                    status: "failed",
                    error_summary: [{ code: body.errorCode || "worker_error", message: body.errorMessage || "Error del worker" }],
                    finished_at: new Date().toISOString(),
                }).eq("id", runId).eq("project_id", projectId);
                await bre.from("projects").update({ status: "sources_ready", current_step: "processing" }).eq("id", projectId);
                if (body.messageId) await admin.rpc("bre_archive_scrape_job", { message_id: body.messageId });
                await bre.from("audit_logs").insert({
                    project_id: projectId,
                    actor_type: "worker",
                    action: "scrape_failed",
                    entity_type: "scrape_run",
                    entity_id: runId,
                    payload: { errorCode: body.errorCode, errorMessage: body.errorMessage },
                });
                return json({ success: true });
            }

            const projectId = String(body.projectId || "");
            const runId = String(body.runId || "");
            assert(projectId && runId, "projectId y runId son obligatorios.");
            const sourceResults = Array.isArray(body.sourceResults) ? body.sourceResults : [];
            const documents = Array.isArray(body.documents) ? body.documents : [];
            const fields = Array.isArray(body.contextFields) ? body.contextFields : [];
            const discoveredSources = Array.isArray(body.discoveredSources) ? body.discoveredSources : [];

            for (const sourceResult of sourceResults) {
                const status = ["completed", "partial", "platform_blocked", "failed"].includes(sourceResult.status)
                    ? sourceResult.status
                    : "failed";
                assertDb(await bre.from("sources").update({
                    status,
                    pages_processed: Number(sourceResult.pagesProcessed || 0),
                    error_code: sourceResult.errorCode || null,
                    error_message: sourceResult.errorMessage || null,
                    last_scraped_at: new Date().toISOString(),
                }).eq("id", sourceResult.sourceId).eq("project_id", projectId));
                assertDb(await bre.from("scrape_source_runs").update({
                    status,
                    pages_processed: Number(sourceResult.pagesProcessed || 0),
                    error_code: sourceResult.errorCode || null,
                    error_message: sourceResult.errorMessage || null,
                    finished_at: new Date().toISOString(),
                }).eq("run_id", runId).eq("source_id", sourceResult.sourceId));
            }

            for (const discovered of discoveredSources) {
                try {
                    const normalized = normalizePublicUrl(discovered.url);
                    const type = sourceTypes.has(discovered.type) ? discovered.type : "other";
                    await bre.from("sources").upsert({
                        project_id: projectId,
                        source_type: type,
                        url: normalized,
                        normalized_url: normalized,
                        source_origin: "discovered",
                        status: "pending",
                    }, { onConflict: "project_id,normalized_url", ignoreDuplicates: true });
                } catch {
                    // Unsafe or malformed discovered links are intentionally discarded.
                }
            }

            for (const document of documents) {
                const sourceId = String(document.sourceId || "");
                if (!sourceId || !document.url || !document.contentHash) continue;
                let storagePath: string | null = null;
                const rawContent = typeof document.rawContent === "string" ? document.rawContent.slice(0, 2_000_000) : "";
                if (rawContent) {
                    storagePath = `${projectId}/${runId}/${sourceId}/${document.contentHash}.txt`;
                    const { error: uploadError } = await admin.storage.from("bre-raw").upload(
                        storagePath,
                        new Blob([rawContent], { type: document.contentType || "text/plain" }),
                        { upsert: true, contentType: document.contentType || "text/plain" },
                    );
                    if (uploadError) storagePath = null;
                }
                assertDb(await bre.from("source_documents").upsert({
                    project_id: projectId,
                    run_id: runId,
                    source_id: sourceId,
                    url: document.url,
                    title: document.title || null,
                    extracted_text: String(document.extractedText || "").slice(0, 200_000),
                    content_hash: document.contentHash,
                    storage_path: storagePath,
                    metadata: document.metadata || {},
                    captured_at: document.capturedAt || new Date().toISOString(),
                }, { onConflict: "run_id,source_id,content_hash" }));
            }

            for (const field of fields) {
                assert(typeof field.key === "string" && field.key, "Campo de contexto inválido.");
                const inferred = field.origin === "inferred";
                const confidence = ["high", "medium", "low"].includes(field.confidence) ? field.confidence : null;
                let status = field.status;
                if (inferred) status = "inferred";
                else if (confidence !== "high" && status === "extracted") status = "pending_validation";
                if (!["extracted", "inferred", "not_found", "pending_validation"].includes(status)) status = "pending_validation";
                const { data: savedField, error: fieldError } = await bre.from("context_fields").upsert({
                    project_id: projectId,
                    field_key: field.key,
                    category: field.category,
                    value: field.value ?? null,
                    origin: inferred ? "inferred" : "extracted",
                    confidence,
                    status,
                    contradiction: Boolean(field.contradiction),
                    alternatives: field.alternatives || [],
                    required_for_base: Boolean(field.requiredForBase),
                }, { onConflict: "project_id,field_key" }).select("id").single();
                if (fieldError) throw fieldError;

                const evidence = Array.isArray(field.evidence) ? field.evidence : [];
                assertDb(await bre.from("field_evidence").delete().eq("context_field_id", savedField.id));
                if (evidence.length > 0) {
                    const rows = evidence.filter((item: any) => item.url && item.originalText && item.contentHash).map((item: any) => ({
                        context_field_id: savedField.id,
                        source_id: item.sourceId || null,
                        url: item.url,
                        source_type: sourceTypes.has(item.sourceType) ? item.sourceType : "other",
                        original_text: String(item.originalText).slice(0, 4000),
                        captured_at: item.capturedAt || new Date().toISOString(),
                        content_hash: item.contentHash,
                    }));
                    if (rows.length) assertDb(await bre.from("field_evidence").upsert(rows, {
                        onConflict: "context_field_id,url,content_hash",
                        ignoreDuplicates: true,
                    }));
                }
            }

            const websiteResult = sourceResults.find((item: any) => item.sourceType === "website");
            const { data: storedWebsite } = await bre.from("sources")
                .select("status")
                .eq("project_id", projectId)
                .eq("source_type", "website")
                .maybeSingle();
            const websiteSucceeded = websiteResult
                ? websiteResult.status === "completed"
                : storedWebsite?.status === "completed";
            const completedCount = sourceResults.filter((item: any) => item.status === "completed").length;
            const runIncludesWebsite = Boolean(websiteResult);
            const runStatus = runIncludesWebsite && !websiteSucceeded
                ? "failed"
                : completedCount === sourceResults.length ? "completed" : "partial";
            assertDb(await bre.from("scrape_runs").update({
                status: runStatus,
                pages_processed: sourceResults.reduce((sum: number, item: any) => sum + Number(item.pagesProcessed || 0), 0),
                sources_completed: sourceResults.length,
                error_summary: sourceResults.filter((item: any) => item.errorCode).map((item: any) => ({
                    sourceId: item.sourceId,
                    code: item.errorCode,
                    message: item.errorMessage,
                })),
                finished_at: new Date().toISOString(),
            }).eq("id", runId).eq("project_id", projectId));
            const { data: userSources, error: userSourcesError } = await bre.from("sources")
                .select("id,source_type,status")
                .eq("project_id", projectId)
                .eq("source_origin", "user");
            if (userSourcesError) throw userSourcesError;
            const userSourceAttemptMeta = await getSourceAttemptMeta(bre, userSources || []);
            const unresolvedUserSources = (userSources || []).filter((source: any) =>
                !["completed", "partial"].includes(source.status)
                && !userSourceAttemptMeta.get(source.id)?.retryLimitReached
            );
            const sourcesReady = websiteSucceeded && unresolvedUserSources.length === 0;
            assertDb(await bre.from("projects").update({
                status: sourcesReady ? "review_context" : "sources_ready",
                current_step: sourcesReady ? "context" : "processing",
            }).eq("id", projectId));
            assertDb(await bre.from("ai_runs").insert({
                project_id: projectId,
                scrape_run_id: runId,
                purpose: "normalize_context",
                model: body.aiModel || Deno.env.get("BRE_NORMALIZATION_MODEL") || "gpt-5.4",
                status: body.aiError ? "failed" : "completed",
                input_hash: body.aiInputHash || null,
                output_payload: { fieldCount: fields.length },
                error_message: body.aiError || null,
                completed_at: new Date().toISOString(),
            }));
            if (body.messageId) await admin.rpc("bre_archive_scrape_job", { message_id: body.messageId });
            assertDb(await bre.from("audit_logs").insert({
                project_id: projectId,
                actor_type: "worker",
                action: "scrape_completed",
                entity_type: "scrape_run",
                entity_id: runId,
                payload: {
                    runStatus,
                    sourceCount: sourceResults.length,
                    fieldCount: fields.length,
                    unresolvedUserSourceIds: unresolvedUserSources.map((source: any) => source.id),
                },
            }));
            return json({ success: true, runStatus });
        }

        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        assert(token, "Sesión requerida.", 401);
        const { data: userData, error: userError } = await admin.auth.getUser(token);
        if (userError || !userData.user) throw Object.assign(new Error("Sesión inválida."), { status: 401 });
        const user = userData.user;
        const { data: profile, error: profileError } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
        if (profileError) throw profileError;
        const role = String(profile?.role || "operator");
        assert(role === "platform_admin" || role === "company_admin", "No tienes acceso al onboarding BRE.", 403);

        const assertProjectAccess = async (projectId: string) => {
            assert(projectId, "projectId es obligatorio.");
            const { data: project, error } = await bre.from("projects").select("*").eq("id", projectId).single();
            if (error) throw error;
            if (role !== "platform_admin") {
                const { data: membership } = await bre.from("project_members")
                    .select("project_id").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
                assert(membership, "No tienes acceso a este proyecto.", 403);
            }
            return project;
        };

        const getProjectDto = async (projectId: string) => {
            const project = await assertProjectAccess(projectId);
            const [membersResult, sourcesResult, runsResult, fieldsResult, answersResult] = await Promise.all([
                bre.from("project_members").select("user_id").eq("project_id", projectId),
                bre.from("sources").select("*").eq("project_id", projectId).order("created_at"),
                bre.from("scrape_runs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1),
                bre.from("context_fields").select("*").eq("project_id", projectId).order("category").order("field_key"),
                bre.from("section_answers").select("*").eq("project_id", projectId),
            ]);
            for (const result of [membersResult, sourcesResult, runsResult, fieldsResult, answersResult]) if (result.error) throw result.error;
            const latestRun = runsResult.data?.[0] || null;
            let sourceRunRows: any[] = [];
            if (latestRun) {
                const { data, error } = await bre.from("scrape_source_runs").select("*, sources(source_type)").eq("run_id", latestRun.id);
                if (error) throw error;
                sourceRunRows = data || [];
            }
            const sourceAttemptMeta = await getSourceAttemptMeta(bre, sourcesResult.data || []);
            const fieldIds = (fieldsResult.data || []).map((field: any) => field.id);
            let evidenceRows: any[] = [];
            if (fieldIds.length) {
                const { data, error } = await bre.from("field_evidence").select("*").in("context_field_id", fieldIds);
                if (error) throw error;
                evidenceRows = data || [];
            }
            const evidenceByField = new Map<string, any[]>();
            evidenceRows.forEach((item: any) => evidenceByField.set(item.context_field_id, [
                ...(evidenceByField.get(item.context_field_id) || []),
                {
                    id: item.id,
                    url: item.url,
                    sourceType: item.source_type,
                    originalText: item.original_text,
                    capturedAt: item.captured_at,
                    contentHash: item.content_hash,
                },
            ]));
            const internalAnswer = (answersResult.data || []).find((answer: any) => answer.section_key === "internal_data" && answer.field_key === "payload");
            const contextFields = (fieldsResult.data || []).map((field: any) => ({
                key: field.field_key,
                category: field.category,
                value: field.value,
                origin: field.origin,
                confidence: field.confidence,
                status: field.status,
                contradiction: field.contradiction,
                alternatives: field.alternatives,
                requiredForBase: field.required_for_base,
                evidence: evidenceByField.get(field.id) || [],
            }));
            const [
                objectiveResult,
                locationsResult,
                agendaResult,
                leadFieldsResult,
                styleResult,
                promptVersionResult,
                matcherVersionResult,
            ] = await Promise.all([
                bre.from("operational_objectives").select("*").eq("project_id", projectId).maybeSingle(),
                bre.from("locations").select("*").eq("project_id", projectId).order("display_order"),
                bre.from("agenda_configs").select("*").eq("project_id", projectId).maybeSingle(),
                bre.from("lead_capture_fields").select("*").eq("project_id", projectId).order("display_order"),
                bre.from("style_preferences").select("*").eq("project_id", projectId).maybeSingle(),
                bre.from("prompt_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
                bre.from("matcher_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
            ]);
            for (const result of [objectiveResult, locationsResult, agendaResult, leadFieldsResult, styleResult, promptVersionResult, matcherVersionResult]) {
                if (result.error) throw result.error;
            }
            const locationRows = locationsResult.data || [];
            const locationIds = locationRows.map((location: any) => location.id);
            let referenceRows: any[] = [];
            if (locationIds.length) {
                const { data, error } = await bre.from("location_references").select("*").in("location_id", locationIds);
                if (error) throw error;
                referenceRows = data || [];
            }
            const referencesByLocation = new Map<string, any[]>();
            referenceRows.forEach((reference: any) => referencesByLocation.set(reference.location_id, [
                ...(referencesByLocation.get(reference.location_id) || []),
                {
                    id: reference.id,
                    locationId: reference.location_id,
                    referenceType: reference.reference_type,
                    value: reference.value,
                    confidence: reference.confidence,
                },
            ]));
            let promptBlocks: any[] = [];
            if (promptVersionResult.data?.id) {
                const { data, error } = await bre.from("prompt_blocks").select("*").eq("prompt_version_id", promptVersionResult.data.id).order("block_key");
                if (error) throw error;
                promptBlocks = data || [];
            }
            return {
                id: project.id,
                name: project.name,
                status: project.status,
                currentStep: project.current_step,
                assignedUserIds: (membersResult.data || []).map((member: any) => member.user_id),
                updatedAt: project.updated_at,
                sources: (sourcesResult.data || []).map((source: any) => ({
                    id: source.id,
                    type: source.source_type,
                    url: source.url,
                    origin: source.source_origin,
                    status: source.status,
                    pagesProcessed: source.pages_processed,
                    attemptCount: sourceAttemptMeta.get(source.id)?.attemptCount || 0,
                    retryCount: sourceAttemptMeta.get(source.id)?.retryCount || 0,
                    retryLimitReached: sourceAttemptMeta.get(source.id)?.retryLimitReached || false,
                    errorCode: source.error_code,
                    errorMessage: source.error_message,
                })),
                latestRun: latestRun ? {
                    id: latestRun.id,
                    status: latestRun.status,
                    pagesProcessed: latestRun.pages_processed,
                    sourcesTotal: latestRun.sources_total,
                    sourcesCompleted: latestRun.sources_completed,
                    startedAt: latestRun.started_at,
                    finishedAt: latestRun.finished_at,
                    sourceProgress: sourceRunRows.map((row: any) => ({
                        sourceId: row.source_id,
                        sourceType: row.sources?.source_type || "other",
                        status: row.status,
                        pagesProcessed: row.pages_processed,
                        attemptCount: sourceAttemptMeta.get(row.source_id)?.attemptCount || Number(row.attempt || 0),
                        retryCount: sourceAttemptMeta.get(row.source_id)?.retryCount || Math.max(Number((row.attempt || 1) - 1), 0),
                        retryLimitReached: sourceAttemptMeta.get(row.source_id)?.retryLimitReached || false,
                        errorCode: row.error_code,
                        errorMessage: row.error_message,
                    })),
                } : null,
                contextFields,
                dynamicQuestions: dynamicQuestionRequirements(contextFields),
                internalData: internalAnswer?.value || null,
                completionEvent: project.completion_payload || null,
                operationalObjective: objectiveResult.data ? {
                    objective: objectiveResult.data.objective,
                    meetingSetupFeeUsd: objectiveResult.data.meeting_setup_fee_usd,
                    calendarEmail: objectiveResult.data.calendar_email,
                    meetStatus: objectiveResult.data.meet_status,
                    locationTerm: objectiveResult.data.location_term,
                    updatedAt: objectiveResult.data.updated_at,
                } : null,
                locations: locationRows.map((location: any) => ({
                    id: location.id,
                    name: location.name,
                    address: location.address,
                    hours: location.hours,
                    googleMapsUrl: location.google_maps_url,
                    appointmentTimezone: location.appointment_timezone || resolveAppointmentTimezone(location, contextFields || []),
                    status: location.location_status,
                    references: referencesByLocation.get(location.id) || [],
                })),
                agendaConfig: agendaResult.data ? {
                    timezone: agendaResult.data.timezone,
                    startIntervalMinutes: agendaResult.data.start_interval_minutes,
                    durationMinutes: agendaResult.data.duration_minutes,
                    capacityPerSlot: agendaResult.data.capacity_per_slot,
                    weeklyHours: agendaResult.data.weekly_hours || [],
                    notes: agendaResult.data.notes,
                } : null,
                leadCaptureFields: (leadFieldsResult.data || []).map(leadCaptureFieldRowToDto),
                stylePreference: styleResult.data ? {
                    emojiMode: styleResult.data.emoji_mode,
                } : null,
                promptVersion: promptVersionResult.data ? {
                    id: promptVersionResult.data.id,
                    versionNumber: promptVersionResult.data.version_number,
                    status: promptVersionResult.data.status,
                    compiledPrompt: promptVersionResult.data.compiled_prompt,
                    createdAt: promptVersionResult.data.created_at,
                    blocks: promptBlocks.map((block: any) => ({
                        id: block.id,
                        blockKey: block.block_key,
                        content: block.content,
                        metadata: block.metadata || {},
                    })),
                } : null,
                matcherVersion: matcherVersionResult.data ? {
                    id: matcherVersionResult.data.id,
                    versionNumber: matcherVersionResult.data.version_number,
                    status: matcherVersionResult.data.status,
                    labels: matcherVersionResult.data.labels || [],
                    matcherConfig: matcherVersionResult.data.matcher_config || {},
                    matcherCode: matcherVersionResult.data.matcher_code,
                    createdAt: matcherVersionResult.data.created_at,
                } : null,
                operationalCompletionEvent: project.operational_completion_payload || null,
            };
        };

        if (action === "list_projects") {
            let projectIds: string[] | null = null;
            if (role === "company_admin") {
                const { data, error } = await bre.from("project_members").select("project_id").eq("user_id", user.id);
                if (error) throw error;
                projectIds = (data || []).map((row: any) => row.project_id);
                if (!projectIds.length) return json({ projects: [] });
            }
            let query = bre.from("projects").select("*, project_members(user_id)").order("updated_at", { ascending: false });
            if (projectIds) query = query.in("id", projectIds);
            const { data, error } = await query;
            if (error) throw error;
            return json({ projects: (data || []).map((project: any) => ({
                id: project.id,
                name: project.name,
                status: project.status,
                currentStep: project.current_step,
                assignedUserIds: (project.project_members || []).map((member: any) => member.user_id),
                updatedAt: project.updated_at,
            })) });
        }

        if (action === "list_company_admins") {
            assert(role === "platform_admin", "Solo platform_admin puede consultar asignables.", 403);
            const { data: profiles, error } = await admin.from("user_profiles").select("id").eq("role", "company_admin");
            if (error) throw error;
            const userIds = new Set((profiles || []).map((item: any) => item.id));
            const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
            if (authError) throw authError;
            return json({ users: authUsers.users.filter((item: any) => userIds.has(item.id)).map((item: any) => ({
                id: item.id,
                email: item.email,
            })) });
        }

        if (action === "create_project") {
            assert(role === "platform_admin", "Solo platform_admin puede crear proyectos.", 403);
            const name = String(body.name || "").trim();
            const assignedUserIds = Array.from(new Set(Array.isArray(body.assignedUserIds) ? body.assignedUserIds.map(String) : []));
            assert(name.length >= 2 && name.length <= 160, "El nombre del proyecto debe tener entre 2 y 160 caracteres.");
            assert(assignedUserIds.length > 0, "Asigna al menos un company_admin.");
            const { data: allowedProfiles, error: profilesError } = await admin.from("user_profiles").select("id").eq("role", "company_admin").in("id", assignedUserIds);
            if (profilesError) throw profilesError;
            assert((allowedProfiles || []).length === assignedUserIds.length, "Uno o más usuarios asignados no son company_admin.");
            const { data: project, error } = await bre.from("projects").insert({ name, created_by: user.id }).select("id").single();
            if (error) throw error;
            await bre.from("project_members").insert([
                { project_id: project.id, user_id: user.id, member_role: "owner" },
                ...assignedUserIds.map((userId) => ({ project_id: project.id, user_id: userId, member_role: "assignee" })),
            ]);
            await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "project_created",
                entity_type: "project",
                entity_id: project.id,
                payload: { assignedUserIds },
            });
            return json({ projectId: project.id }, 201);
        }

        if (action === "get_project") return json({ project: await getProjectDto(String(body.projectId || "")) });

        if (action === "get_dynamic_questions") {
            const project = await getProjectDto(String(body.projectId || ""));
            return json({ questions: project.dynamicQuestions });
        }

        if (action === "save_sources") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            const sources = Array.isArray(body.sources) ? body.sources : [];
            const normalized = sources.map((source: any) => {
                const type = sourceTypes.has(source.type) ? source.type : "other";
                const url = normalizePublicUrl(source.url);
                assertSourceUrlMatchesType(type, url);
                return { type, url };
            });
            const unique = Array.from(new Map(normalized.map((source: any) => [source.url, source])).values());
            assert(unique.filter((source: any) => source.type === "website").length === 1, "Debes ingresar exactamente un sitio web oficial.");
            const { data: activeRun } = await bre.from("scrape_runs").select("id").eq("project_id", project.id).in("status", ["queued", "processing"]).maybeSingle();
            assert(!activeRun, "No puedes cambiar fuentes mientras existe un procesamiento activo.", 409);
            await invalidateBaseCompletion(bre, project.id, { clearInternalData: true });
            assertDb(await bre.from("scrape_runs").delete().eq("project_id", project.id));
            assertDb(await bre.from("sources").delete().eq("project_id", project.id));
            assertDb(await bre.from("context_fields").delete().eq("project_id", project.id));
            assertDb(await bre.from("section_answers").delete().eq("project_id", project.id));
            const { error } = await bre.from("sources").insert(unique.map((source: any) => ({
                project_id: project.id,
                source_type: source.type,
                url: source.url,
                normalized_url: source.url,
                source_origin: "user",
                status: "pending",
            })));
            if (error) throw error;
            assertDb(await bre.from("projects").update({ status: "sources_ready", current_step: "sources" }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "start_scrape" || action === "retry_source") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(!project.completion_payload && !operationalStatuses.has(String(project.status)), "Guarda nuevamente las fuentes para reiniciar el análisis antes de procesar.", 409);
            const { data: allSources, error: sourceError } = await bre.from("sources").select("*").eq("project_id", project.id);
            if (sourceError) throw sourceError;
            const website = (allSources || []).find((source: any) => source.source_type === "website");
            assert(website, "Debes guardar el sitio web oficial antes de procesar.");
            const retrySourceId = action === "retry_source" ? String(body.sourceId || "") : null;
            const selectedSources = retrySourceId ? (allSources || []).filter((source: any) => source.id === retrySourceId) : (allSources || []);
            assert(selectedSources.length > 0, "La fuente seleccionada no existe.");
            const attemptMeta = await getSourceAttemptMeta(bre, selectedSources);
            if (retrySourceId && selectedSources[0].source_type !== "website") {
                assert(website.status === "completed", "El sitio web debe completarse antes de reintentar una red social.");
                const selectedMeta = attemptMeta.get(selectedSources[0].id);
                assert(
                    !selectedMeta?.retryLimitReached,
                    `La fuente ya agotó ${MAX_OPTIONAL_SOURCE_RETRIES} reintentos y quedó omitida del análisis complementario.`,
                );
            }
            const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
            const { data: existing } = await bre.from("scrape_runs").select("id").eq("project_id", project.id).eq("idempotency_key", idempotencyKey).maybeSingle();
            if (existing) return json({ runId: existing.id, idempotent: true });
            const { data: active } = await bre.from("scrape_runs").select("id").eq("project_id", project.id).in("status", ["queued", "processing"]).maybeSingle();
            assert(!active, "Ya existe un procesamiento activo.", 409);
            const { data: run, error: runError } = await bre.from("scrape_runs").insert({
                project_id: project.id,
                status: "queued",
                idempotency_key: idempotencyKey,
                sources_total: selectedSources.length,
            }).select("id").single();
            if (runError) throw runError;
            await bre.from("scrape_source_runs").insert(selectedSources.map((source: any) => ({
                run_id: run.id,
                source_id: source.id,
                attempt: (attemptMeta.get(source.id)?.attemptCount || 0) + 1,
                status: "queued",
            })));
            assertDb(await bre.from("sources").update({ status: "queued", error_code: null, error_message: null }).in("id", selectedSources.map((source: any) => source.id)));
            assertDb(await bre.from("projects").update({ status: "scraping", current_step: "processing" }).eq("id", project.id));
            const { error: queueError } = await admin.rpc("bre_enqueue_scrape_job", { message: {
                version: 1,
                projectId: project.id,
                runId: run.id,
                mode: retrySourceId ? "source_retry" : "full",
                sources: selectedSources.map((source: any) => ({ id: source.id, type: source.source_type, url: source.url })),
                limits: { maxPages: 50, maxDepth: 3 },
            } });
            if (queueError) throw queueError;
            return json({ runId: run.id }, 202);
        }

        if (action === "save_context_answer") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            const fieldKey = String(body.fieldKey || "");
            assert(dynamicFieldKeys.has(fieldKey), "El campo no pertenece a las preguntas permitidas.");
            assert(body.value !== undefined && body.value !== null && String(body.value).trim() !== "", "La respuesta es obligatoria.");
            const actionType = body.answerAction === "confirm" ? "confirm" : "correct";
            const { data: existing, error: existingError } = await bre.from("context_fields").select("id,value").eq("project_id", project.id).eq("field_key", fieldKey).single();
            if (existingError) throw existingError;
            await validateManualAnswer(admin, bre, project.id, fieldKey, body.value, existing.value);
            await invalidateBaseCompletion(bre, project.id, { clearInternalData: true });
            const sameValue = JSON.stringify(existing.value) === JSON.stringify(body.value);
            const status = actionType === "confirm" && sameValue ? "confirmed" : "corrected";
            assertDb(await bre.from("context_fields").update({
                value: body.value,
                origin: "user",
                confidence: "high",
                status,
                contradiction: false,
                updated_by: user.id,
            }).eq("id", existing.id));
            assertDb(await bre.from("section_answers").upsert({
                project_id: project.id,
                section_key: "context_gaps",
                field_key: fieldKey,
                value: body.value,
                answer_status: "validated",
                answered_by: user.id,
            }, { onConflict: "project_id,section_key,field_key" }));
            const { data: contextFields, error: contextFieldsError } = await bre.from("context_fields")
                .select("field_key,origin,confidence,status,contradiction,required_for_base")
                .eq("project_id", project.id)
                .in("field_key", Array.from(dynamicFieldKeys));
            if (contextFieldsError) throw contextFieldsError;
            const unresolved = (contextFields || []).filter((field: any) => {
                if (field.contradiction) return true;
                if (field.origin === "inferred") return !["confirmed", "corrected"].includes(field.status);
                if (field.status === "not_found") return field.required_for_base !== false;
                if (field.status === "pending_validation") return true;
                if (["medium", "low"].includes(field.confidence)) return !["confirmed", "corrected"].includes(field.status);
                return false;
            });
            assertDb(await bre.from("projects").update({
                status: "collecting_answers",
                current_step: unresolved.length === 0 ? "internal" : "gaps",
            }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_context_field") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            const fieldKey = String(body.fieldKey || "");
            assert(fieldKey, "El campo es obligatorio.");
            const { data: existing, error: existingError } = await bre.from("context_fields")
                .select("id,value").eq("project_id", project.id).eq("field_key", fieldKey).single();
            if (existingError) throw existingError;
            assert(body.value !== undefined && body.value !== null && String(body.value).trim() !== "", "El valor es obligatorio.");
            await validateManualAnswer(admin, bre, project.id, fieldKey, body.value, existing.value);
            await invalidateBaseCompletion(bre, project.id, { clearInternalData: true });
            assertDb(await bre.from("context_fields").update({
                value: body.value,
                origin: "user",
                confidence: "high",
                status: "corrected",
                contradiction: false,
                updated_by: user.id,
            }).eq("id", existing.id));
            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "context_field_corrected",
                entity_type: "context_field",
                entity_id: existing.id,
                payload: { fieldKey },
            }));
            const { data: contextFields, error: contextFieldsError } = await bre.from("context_fields")
                .select("field_key,origin,confidence,status,contradiction,required_for_base")
                .eq("project_id", project.id)
                .in("field_key", Array.from(dynamicFieldKeys));
            if (contextFieldsError) throw contextFieldsError;
            const unresolved = (contextFields || []).filter((field: any) => {
                if (field.contradiction) return true;
                if (field.origin === "inferred") return !["confirmed", "corrected"].includes(field.status);
                if (field.status === "not_found") return field.required_for_base !== false;
                if (field.status === "pending_validation") return true;
                if (["medium", "low"].includes(field.confidence)) return !["confirmed", "corrected"].includes(field.status);
                return false;
            });
            assertDb(await bre.from("projects").update({
                status: "collecting_answers",
                current_step: unresolved.length === 0 ? "internal" : "gaps",
            }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_internal_data") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            validateInternalData(body.data);
            await validateManualAnswer(admin, bre, project.id, "internal_data", body.data, null);
            await invalidateBaseCompletion(bre, project.id, { clearInternalData: false });
            assertDb(await bre.from("section_answers").upsert({
                project_id: project.id,
                section_key: "internal_data",
                field_key: "payload",
                value: body.data,
                answer_status: "validated",
                answered_by: user.id,
            }, { onConflict: "project_id,section_key,field_key" }));
            assertDb(await bre.from("projects").update({ status: "collecting_answers", current_step: "internal" }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "finalize_base_context") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            if (project.completion_payload) return json({ project: await getProjectDto(project.id), idempotent: true });
            const { data: website } = await bre.from("sources").select("status").eq("project_id", project.id).eq("source_type", "website").single();
            assert(website?.status === "completed", "El sitio web debe finalizar correctamente.");
            const { data: userSources, error: userSourcesError } = await bre.from("sources")
                .select("id,source_type,status").eq("project_id", project.id).eq("source_origin", "user");
            if (userSourcesError) throw userSourcesError;
            const userSourceAttemptMeta = await getSourceAttemptMeta(bre, userSources || []);
            const unresolvedSources = (userSources || []).filter((source: any) =>
                !["completed", "partial"].includes(source.status)
                && !userSourceAttemptMeta.get(source.id)?.retryLimitReached
            );
            assert(unresolvedSources.length === 0, "Todas las fuentes proporcionadas deben procesarse o retirarse antes de completar esta etapa.");
            const { data: fields, error: fieldsError } = await bre.from("context_fields").select("*, field_evidence(*)").eq("project_id", project.id);
            if (fieldsError) throw fieldsError;
            const presentDynamicKeys = new Set((fields || []).map((field: any) => field.field_key).filter((key: string) => dynamicFieldKeys.has(key)));
            assert(presentDynamicKeys.size === dynamicFieldKeys.size, "El contexto normalizado no contiene los once campos base esperados.");
            const unresolved = (fields || []).filter((field: any) => dynamicFieldKeys.has(field.field_key)).filter((field: any) => {
                if (field.status === "not_found" && !field.required_for_base) return false;
                if (field.contradiction) return true;
                if (field.origin === "inferred") return !["confirmed", "corrected"].includes(field.status);
                if (field.status === "not_found" || field.status === "pending_validation") return true;
                if (["medium", "low"].includes(field.confidence)) return !["confirmed", "corrected"].includes(field.status);
                return false;
            });
            assert(unresolved.length === 0, `Aún existen ${unresolved.length} campos pendientes de validación.`);
            const { data: internalAnswer } = await bre.from("section_answers").select("value").eq("project_id", project.id).eq("section_key", "internal_data").eq("field_key", "payload").single();
            validateInternalData(internalAnswer?.value);
            const completedAt = new Date().toISOString();
            const dto = await getProjectDto(project.id);
            const completionPayload = {
                eventType: "BaseBusinessContextCompletedV1",
                version: 1,
                projectId: project.id,
                completedAt,
                context: dto.contextFields,
                internalData: internalAnswer.value,
                sources: dto.sources,
            };
            assertDb(await bre.from("projects").update({
                status: "base_context_complete",
                current_step: "objective",
                completion_payload: completionPayload,
                completed_at: completedAt,
            }).eq("id", project.id));
            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "base_context_completed",
                entity_type: "project",
                entity_id: project.id,
                payload: { eventType: completionPayload.eventType, version: 1 },
            }));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_operational_objective") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            const objective = String(body.objective || "");
            assert(objective === "appointments" || objective === "meetings", "Selecciona citas o reuniones.");
            const currentObjective = await bre.from("operational_objectives").select("objective").eq("project_id", project.id).maybeSingle();
            if (currentObjective.error) throw currentObjective.error;
            const changedObjective = currentObjective.data?.objective && currentObjective.data.objective !== objective;
            await invalidateFromObjective(bre, project.id);
            const row = objective === "meetings"
                ? {
                    project_id: project.id,
                    objective,
                    meeting_setup_fee_usd: 300,
                    calendar_email: validateEmail(body.calendarEmail, "El correo de calendario"),
                    meet_status: "pending_technical_setup",
                    location_term: null,
                    updated_by: user.id,
                }
                : {
                    project_id: project.id,
                    objective,
                    meeting_setup_fee_usd: null,
                    calendar_email: null,
                    meet_status: "not_applicable",
                    location_term: "sedes",
                    updated_by: user.id,
                };
            assertDb(await bre.from("operational_objectives").upsert(row, { onConflict: "project_id" }));
            assertDb(await bre.from("projects").update({
                status: "objective_selected",
                current_step: objective === "appointments" ? "locations" : "agenda",
            }).eq("id", project.id));
            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: changedObjective ? "operational_objective_changed" : "operational_objective_saved",
                entity_type: "operational_objective",
                entity_id: project.id,
                payload: { objective },
            }));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_locations") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            await invalidateFromLocations(bre, project.id);
            const { data: objective, error: objectiveError } = await bre.from("operational_objectives").select("*").eq("project_id", project.id).single();
            if (objectiveError) throw objectiveError;
            assert(objective.objective === "appointments", "Las sedes solo aplican para agendamiento de citas.");
            const locations = validateLocationsPayload(Array.isArray(body.locations) ? body.locations : []);
            const locationTerm = "sedes";
            const { data: contextFields, error: contextFieldsError } = await bre.from("context_fields").select("*").eq("project_id", project.id);
            if (contextFieldsError) throw contextFieldsError;
            assertDb(await bre.from("locations").delete().eq("project_id", project.id));
            const { data: savedLocations, error: locationError } = await bre.from("locations").insert(locations.map((location, index) => ({
                project_id: project.id,
                display_order: index,
                name: location.name,
                address: location.address,
                hours: location.hours,
                google_maps_url: location.googleMapsUrl,
                location_status: location.status,
                updated_by: user.id,
            }))).select("*");
            if (locationError) throw locationError;
            const geoEnricherResult = await buildDetailedLocationReferencesWithAi({
                projectId: project.id,
                projectName: project.name,
                objective: objective.objective,
                contextFields: contextFields || [],
                locations: savedLocations || [],
            });
            const referenceRows = geoEnricherResult.rows.map((reference) => ({
                project_id: project.id,
                location_id: reference.locationId,
                reference_type: reference.reference_type,
                value: reference.value,
                confidence: reference.confidence,
            }));
            if (referenceRows.length) assertDb(await bre.from("location_references").insert(referenceRows));
            assertDb(await bre.from("operational_objectives").update({ location_term: locationTerm, updated_by: user.id }).eq("project_id", project.id));
            assertDb(await bre.from("projects").update({ status: "locations_configured", current_step: "agenda" }).eq("id", project.id));
            assertDb(await bre.from("ai_runs").insert({
                project_id: project.id,
                purpose: "geo_enricher",
                model: geoEnricherResult.model,
                status: geoEnricherResult.status,
                output_payload: geoEnricherResult.outputPayload,
                error_message: geoEnricherResult.errorMessage,
                completed_at: new Date().toISOString(),
            }));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_agenda_config") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            await invalidateFromAgenda(bre, project.id);
            const { data: objective, error: objectiveError } = await bre.from("operational_objectives").select("objective").eq("project_id", project.id).single();
            if (objectiveError) throw objectiveError;
            const agenda = validateAgendaPayload(body.agenda, objective.objective);
            if (objective.objective === "appointments") {
                const { count, error } = await bre.from("locations").select("id", { count: "exact", head: true }).eq("project_id", project.id);
                if (error) throw error;
                assert((count || 0) > 0, "Configura al menos una sede antes de la agenda de citas.");
            }
            assertDb(await bre.from("agenda_configs").upsert({
                project_id: project.id,
                timezone: agenda.timezone,
                start_interval_minutes: agenda.startIntervalMinutes,
                duration_minutes: agenda.durationMinutes,
                capacity_per_slot: agenda.capacityPerSlot,
                weekly_hours: agenda.weeklyHours,
                notes: agenda.notes,
                updated_by: user.id,
            }, { onConflict: "project_id" }));
            assertDb(await bre.from("projects").update({ status: "agenda_configured", current_step: "lead_fields" }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_lead_capture_fields") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            await invalidateFromLeadFields(bre, project.id);
            const { data: objective, error: objectiveError } = await bre.from("operational_objectives").select("objective").eq("project_id", project.id).single();
            if (objectiveError) throw objectiveError;
            const fields = validateLeadFieldsPayload(Array.isArray(body.fields) ? body.fields : [], objective.objective);
            assertDb(await bre.from("lead_capture_fields").delete().eq("project_id", project.id));
            assertDb(await bre.from("lead_capture_fields").insert(fields.map((field, index) => ({
                project_id: project.id,
                display_order: index,
                field_key: field.fieldKey,
                custom_key: field.customKey,
                label: field.label,
                enabled: field.enabled,
                required: field.required,
                capture_timing: field.captureTiming,
                blocks_early_flow: field.blocksEarlyFlow,
                reason: field.reason,
                updated_by: user.id,
            }))));
            assertDb(await bre.from("projects").update({ status: "lead_fields_configured", current_step: "style" }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_style_preference") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            await invalidateFromStyle(bre, project.id);
            const emojiMode = normalizeEmojiMode(body.stylePreference?.emojiMode);
            assertDb(await bre.from("style_preferences").upsert({
                project_id: project.id,
                emoji_mode: emojiMode,
                updated_by: user.id,
            }, { onConflict: "project_id" }));
            assertDb(await bre.from("projects").update({ status: "style_configured", current_step: "generate" }).eq("id", project.id));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "generate_bot_version") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assertBaseCompleted(project);
            const [
                objectiveResult,
                locationsResult,
                agendaResult,
                leadFieldsResult,
                styleResult,
                fieldsResult,
                answersResult,
            ] = await Promise.all([
                bre.from("operational_objectives").select("*").eq("project_id", project.id).single(),
                bre.from("locations").select("*").eq("project_id", project.id).order("display_order"),
                bre.from("agenda_configs").select("*").eq("project_id", project.id).single(),
                bre.from("lead_capture_fields").select("*").eq("project_id", project.id).order("display_order"),
                bre.from("style_preferences").select("*").eq("project_id", project.id).single(),
                bre.from("context_fields").select("*").eq("project_id", project.id),
                bre.from("section_answers").select("*").eq("project_id", project.id),
            ]);
            for (const result of [objectiveResult, locationsResult, agendaResult, leadFieldsResult, styleResult, fieldsResult, answersResult]) {
                if (result.error) throw result.error;
            }
            const objective = objectiveResult.data;
            if (objective.objective === "appointments") assert((locationsResult.data || []).length > 0, "Configura al menos una sede.");
            const internalAnswer = (answersResult.data || []).find((answer: any) => answer.section_key === "internal_data" && answer.field_key === "payload");
            validateInternalData(internalAnswer?.value);
            const leadFields = leadFieldsResult.data || [];
            const normalizedLeadFields = validateLeadFieldsPayload(leadFields.map((field: any) => ({
                fieldKey: field.field_key,
                label: normalizeLeadFieldLabel(field.field_key, field.label),
                enabled: field.enabled,
                required: field.required,
                captureTiming: field.capture_timing,
                blocksEarlyFlow: field.blocks_early_flow,
                reason: field.reason,
                customKey: field.custom_key,
            })), objective.objective);
            const country = getContextValue(fieldsResult.data || [], "country");
            const legalTextOverride = String(body.legalTextOverride || "").trim();
            const legalRecommendation = resolveDataProtectionRecommendation(fieldsResult.data || []);
            if (country && !legalRecommendation) {
                assert(legalTextOverride.length >= 20, "No tenemos una recomendación legal automática para ese país. Ingresa el texto de protección de datos personales aplicable antes de generar el bot.");
            }
            let enrichedLocations = locationsResult.data || [];
            if (objective.objective === "appointments" && enrichedLocations.length) {
                const locationIds = enrichedLocations.map((location: any) => location.id);
                const { data: existingReferences, error: existingReferencesError } = await bre.from("location_references").select("*").in("location_id", locationIds);
                if (existingReferencesError) throw existingReferencesError;
                const shouldRefreshReferences = !(existingReferences || []).some((reference: any) =>
                    reference.reference_type === "phrase" && /Parroquia o barrio:|Intersección exacta:|Centro comercial o plaza:/i.test(String(reference.value || "")));
                let referenceRows = existingReferences || [];
                if (shouldRefreshReferences) {
                    assertDb(await bre.from("location_references").delete().eq("project_id", project.id));
                    const geoEnricherResult = await buildDetailedLocationReferencesWithAi({
                        projectId: project.id,
                        projectName: project.name,
                        objective: objective.objective,
                        contextFields: fieldsResult.data || [],
                        locations: enrichedLocations,
                    });
                    const upsertRows = geoEnricherResult.rows.map((reference) => ({
                        project_id: project.id,
                        location_id: reference.locationId,
                        reference_type: reference.reference_type,
                        value: reference.value,
                        confidence: reference.confidence,
                    }));
                    if (upsertRows.length) {
                        assertDb(await bre.from("location_references").insert(upsertRows));
                        const { data: insertedReferences, error: insertedReferencesError } = await bre.from("location_references").select("*").in("location_id", locationIds);
                        if (insertedReferencesError) throw insertedReferencesError;
                        referenceRows = insertedReferences || [];
                    } else {
                        referenceRows = [];
                    }
                    assertDb(await bre.from("ai_runs").insert({
                        project_id: project.id,
                        purpose: "geo_enricher_refresh_on_generate",
                        model: geoEnricherResult.model,
                        status: geoEnricherResult.status,
                        output_payload: geoEnricherResult.outputPayload,
                        error_message: geoEnricherResult.errorMessage,
                        completed_at: new Date().toISOString(),
                    }));
                }
                enrichedLocations = mergeLocationReferencesIntoRows(enrichedLocations, referenceRows);
            }
            const brainResult = await buildOperationalAssetsWithAi({
                project,
                fields: fieldsResult.data || [],
                internalData: internalAnswer.value,
                objective,
                locations: enrichedLocations,
                agenda: agendaResult.data,
                leadFields: normalizedLeadFields,
                style: styleResult.data,
                legalTextOverride: legalTextOverride || null,
            });
            const assets = brainResult.assets;
            assertDb(await bre.from("projects").update({ status: "generating_bot", current_step: "generate" }).eq("id", project.id));
            assertDb(await bre.from("filter_rules").delete().eq("project_id", project.id));
            assertDb(await bre.from("lopdp_config").delete().eq("project_id", project.id));
            assertDb(await bre.from("filter_rules").insert(assets.filters.map((filter, index) => ({
                project_id: project.id,
                display_order: index,
                rule_key: filter.rule_key,
                question: filter.question,
                gate_type: filter.gate_type,
                placement: filter.placement,
                reason: filter.reason,
                metadata: {},
            }))));
            assertDb(await bre.from("lopdp_config").upsert({
                project_id: project.id,
                country: assets.lopdp.country || null,
                placement_option: assets.lopdp.placementOption,
                legal_text: assets.lopdp.legalText,
                status: assets.lopdp.status,
            }, { onConflict: "project_id" }));
            const { data: latestPrompt } = await bre.from("prompt_versions").select("version_number").eq("project_id", project.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
            const versionNumber = Number(latestPrompt?.version_number || 0) + 1;
            const inputSnapshot = {
                baseCompletionEventId: project.completed_at,
                objective,
                locationCount: locationsResult.data?.length || 0,
                agenda: agendaResult.data,
                leadFieldCount: leadFields.length,
                style: styleResult.data,
            };
            const { data: promptVersion, error: promptError } = await bre.from("prompt_versions").insert({
                project_id: project.id,
                version_number: versionNumber,
                status: "candidate",
                compiled_prompt: assets.compiledPrompt,
                input_snapshot: inputSnapshot,
                created_by: user.id,
            }).select("*").single();
            if (promptError) throw promptError;
            assertDb(await bre.from("prompt_blocks").insert(assets.blocks.map((block: any) => ({
                project_id: project.id,
                prompt_version_id: promptVersion.id,
                block_key: block.blockKey,
                content: block.content,
                metadata: block.metadata || {},
            }))));
            const { data: matcherVersion, error: matcherError } = await bre.from("matcher_versions").insert({
                project_id: project.id,
                version_number: versionNumber,
                status: "candidate",
                labels: assets.matcherLabels,
                matcher_config: assets.matcherConfig,
                matcher_code: assets.matcherCode,
                created_by: user.id,
            }).select("*").single();
            if (matcherError) throw matcherError;
            assertDb(await bre.from("technical_review_queue").insert({
                project_id: project.id,
                prompt_version_id: promptVersion.id,
                matcher_version_id: matcherVersion.id,
                review_status: "pending_review",
            }));
            const completedAt = new Date().toISOString();
            const completionPayload = {
                eventType: "OperationalOnboardingCompletedV1",
                version: 1,
                projectId: project.id,
                completedAt,
                reviewStatus: "ready_for_technical_review",
                objective: {
                    objective: objective.objective,
                    meetingSetupFeeUsd: objective.meeting_setup_fee_usd,
                    calendarEmail: objective.calendar_email,
                    meetStatus: objective.meet_status,
                    locationTerm: objective.location_term,
                    updatedAt: objective.updated_at,
                },
                agenda: {
                    timezone: agendaResult.data.timezone,
                    startIntervalMinutes: agendaResult.data.start_interval_minutes,
                    durationMinutes: agendaResult.data.duration_minutes,
                    capacityPerSlot: agendaResult.data.capacity_per_slot,
                    weeklyHours: agendaResult.data.weekly_hours || [],
                    notes: agendaResult.data.notes,
                },
                locations: (locationsResult.data || []).map((location: any) => ({
                    id: location.id,
                    name: location.name,
                    address: location.address,
                    hours: location.hours,
                    googleMapsUrl: location.google_maps_url,
                    appointmentTimezone: location.appointment_timezone || resolveAppointmentTimezone(location, fieldsResult.data || []),
                    status: location.location_status,
                    references: [],
                })),
                leadCaptureFields: normalizedLeadFields,
                stylePreference: { emojiMode: styleResult.data.emoji_mode },
                promptVersionId: promptVersion.id,
                matcherVersionId: matcherVersion.id,
            };
            assertDb(await bre.from("ai_runs").insert({
                project_id: project.id,
                purpose: "ai_brain",
                model: brainResult.model,
                status: brainResult.status,
                input_hash: String(versionNumber),
                output_payload: {
                    ...brainResult.outputPayload,
                    promptVersionId: promptVersion.id,
                    matcherVersionId: matcherVersion.id,
                },
                error_message: brainResult.errorMessage,
                completed_at: completedAt,
            }));
            assertDb(await bre.from("ai_runs").insert({
                project_id: project.id,
                purpose: "matcher_config_builder",
                model: "deterministic-matcher-builder-v1",
                status: "completed",
                output_payload: { labels: assets.matcherLabels },
                completed_at: completedAt,
            }));
            assertDb(await bre.from("projects").update({
                status: "ready_for_technical_review",
                current_step: "review",
                operational_completion_payload: completionPayload,
                operational_completed_at: completedAt,
            }).eq("id", project.id));
            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "operational_onboarding_ready_for_review",
                entity_type: "prompt_version",
                entity_id: promptVersion.id,
                payload: { matcherVersionId: matcherVersion.id, versionNumber },
            }));
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_prompt_candidate") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(project.status === "ready_for_technical_review", "El prompt solo se puede editar cuando el proyecto está listo para revisión técnica.");
            const promptVersionId = String(body.promptVersionId || "").trim();
            const compiledPrompt = String(body.compiledPrompt || "");
            assert(promptVersionId, "promptVersionId es obligatorio.");
            assert(compiledPrompt.trim().length >= 100, "El prompt candidato debe tener al menos 100 caracteres.");

            const { data: promptVersion, error: promptVersionError } = await bre.from("prompt_versions")
                .select("*")
                .eq("id", promptVersionId)
                .eq("project_id", project.id)
                .single();
            if (promptVersionError) throw promptVersionError;
            assert(promptVersion.status === "candidate", "Solo se pueden editar versiones candidatas.");

            assertDb(await bre.from("prompt_versions")
                .update({ compiled_prompt: compiledPrompt })
                .eq("id", promptVersionId)
                .eq("project_id", project.id));

            assertDb(await bre.from("prompt_blocks").upsert({
                project_id: project.id,
                prompt_version_id: promptVersionId,
                block_key: "compiled_prompt",
                content: compiledPrompt,
                metadata: {
                    editedManually: true,
                    editedAt: new Date().toISOString(),
                    editedBy: user.id,
                },
            }, { onConflict: "prompt_version_id,block_key" }));

            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "prompt_candidate_manually_updated",
                entity_type: "prompt_version",
                entity_id: promptVersionId,
                payload: {
                    versionNumber: promptVersion.version_number,
                    previousLength: String(promptVersion.compiled_prompt || "").length,
                    newLength: compiledPrompt.length,
                },
            }));

            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_matcher_candidate") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(project.status === "ready_for_technical_review", "El matcher solo se puede editar cuando el proyecto está listo para revisión técnica.");
            const matcherVersionId = String(body.matcherVersionId || "").trim();
            const matcherCode = String(body.matcherCode || "");
            assert(matcherVersionId, "matcherVersionId es obligatorio.");
            assert(matcherCode.trim().length >= 100, "El matcher determinístico debe tener al menos 100 caracteres.");

            const { data: matcherVersion, error: matcherVersionError } = await bre.from("matcher_versions")
                .select("*")
                .eq("id", matcherVersionId)
                .eq("project_id", project.id)
                .single();
            if (matcherVersionError) throw matcherVersionError;
            assert(matcherVersion.status === "candidate", "Solo se pueden editar versiones candidatas.");

            assertDb(await bre.from("matcher_versions")
                .update({ matcher_code: matcherCode })
                .eq("id", matcherVersionId)
                .eq("project_id", project.id));

            assertDb(await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "matcher_candidate_manually_updated",
                entity_type: "matcher_version",
                entity_id: matcherVersionId,
                payload: {
                    versionNumber: matcherVersion.version_number,
                    previousLength: String(matcherVersion.matcher_code || "").length,
                    newLength: matcherCode.length,
                },
            }));

            return json({ project: await getProjectDto(project.id) });
        }

        throw Object.assign(new Error("Acción no soportada."), { status: 404 });
    } catch (error) {
        const status = Number((error as any)?.status || 400);
        return json({ success: false, error: errorMessage(error) }, status);
    }
});
