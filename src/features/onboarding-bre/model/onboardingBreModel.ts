import {
    DYNAMIC_CONTEXT_FIELD_KEYS,
    type ContextFieldV1,
    type BreAgendaConfigV1,
    type BreLeadCaptureFieldV1,
    type BreLocationV1,
    type BreOperationalObjective,
    type BreStylePreferenceV1,
    type BreWeeklyHourV1,
    type BreWeekday,
    type DynamicContextFieldKey,
    type DynamicQuestionV1,
    type InfoSealV1,
    type InternalBusinessDataV1,
    type MoneyMetricV1,
    type OnboardingBreSourceV1,
} from "../domain/types";

export const BUSINESS_MODEL_OPTIONS = [
    "Venta única",
    "Venta recurrente",
    "Suscripción",
    "Membresía",
    "Comisión",
    "Financiamiento",
    "SaaS",
    "Marketplace",
    "Servicios por proyecto",
    "Servicios por cita",
    "Servicios por contrato",
    "Franquicia",
    "Otro",
] as const;

export const OBJECTIVE_OPTIONS: Array<{
    value: BreOperationalObjective;
    label: string;
    description: string;
}> = [
    {
        value: "appointments",
        label: "Agendamiento de citas",
        description: "Para leads que deben asistir a una sede, agencia, oficina o punto de atención.",
    },
    {
        value: "meetings",
        label: "Agendamiento de reuniones",
        description: "Para reuniones comerciales, usualmente virtuales, con calendario y Google Meet.",
    },
];

export const LOCATION_TERM_OPTIONS = ["sedes", "agencias", "sucursales", "locales", "oficinas", "puntos de atención", "otro"] as const;

const normalizeText = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const WEEKDAY_LABELS: Record<string, string> = {
    monday: "Lunes",
    tuesday: "Martes",
    wednesday: "Miércoles",
    thursday: "Jueves",
    friday: "Viernes",
    saturday: "Sábado",
    sunday: "Domingo",
};

export const DEFAULT_WEEKLY_HOURS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
].map((day) => ({
    day: day as BreWeekday,
    enabled: !["saturday", "sunday"].includes(day),
    startTime: "09:00",
    endTime: "17:00",
}));

export const DEFAULT_LEAD_FIELDS: BreLeadCaptureFieldV1[] = [
    { fieldKey: "full_name", label: "Nombre completo", enabled: true, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Identificar al lead en confirmación, consulta y agenda." },
    { fieldKey: "phone", label: "Número Celular", enabled: true, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Necesario si el lead no viene de WhatsApp o si el negocio requiere seguimiento." },
    { fieldKey: "email", label: "Correo Electrónico", enabled: true, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Especialmente relevante para reuniones e invitaciones." },
    { fieldKey: "national_id", label: "Identificación", enabled: false, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Solo si el negocio lo necesita por operación o validación." },
    { fieldKey: "age", label: "Edad", enabled: false, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Solo si existe requisito de edad o segmentación." },
    { fieldKey: "city", label: "Ciudad", enabled: true, required: false, captureTiming: "when_scheduling", blocksEarlyFlow: false, reason: "Útil para citas, sedes, cobertura y filtros." },
];

export const EMOJI_MODE_OPTIONS = [
    { value: "moderate", label: "Usar emojis de forma moderada", description: "Cada plantilla tendrá al menos 1 emoji; el AI Brain decide si agrega más sin saturar." },
    { value: "none", label: "No usar emojis", description: "Todas las plantillas se generan con tono textual limpio y profesional." },
    { value: "commercial_only", label: "Solo en bienvenida o mensajes comerciales", description: "Se limita el uso de emojis a puntos de alto impacto." },
] as const;

export const normalizeLeadCaptureFieldLabel = (field: BreLeadCaptureFieldV1): BreLeadCaptureFieldV1 => ({
    ...field,
    captureTiming: field.enabled && field.captureTiming === "conversation_start" ? "conversation_start" : "when_scheduling",
    blocksEarlyFlow: Boolean(field.enabled && field.required && field.captureTiming === "conversation_start" && field.blocksEarlyFlow),
    label: field.fieldKey === "full_name"
        ? "Nombre completo"
        : field.fieldKey === "phone"
            ? "Número Celular"
            : field.fieldKey === "email"
                ? "Correo Electrónico"
                : field.fieldKey === "national_id"
                    ? "Identificación"
                    : field.label,
});

export const normalizeLeadCaptureFieldsForUi = (fields: BreLeadCaptureFieldV1[]): BreLeadCaptureFieldV1[] =>
    fields.map(normalizeLeadCaptureFieldLabel);

const FIELD_LABELS: Record<DynamicContextFieldKey, string> = {
    commercial_name: "Nombre comercial",
    business_description: "Descripción del negocio",
    industry: "Industria",
    country: "País donde trabaja",
    value_proposition: "Propuesta de valor",
    primary_offers: "Productos o servicios principales",
    benefits: "Beneficios principales",
    general_restrictions: "Restricciones o condiciones generales",
    ideal_customer_profile: "Cliente ideal (ICP)",
    communication_tone: "Tono de comunicación",
    faqs: "Preguntas frecuentes",
};

export const CONTEXT_FIELD_LABELS: Record<string, string> = {
    commercial_name: "Nombre comercial",
    legal_name: "Razón social",
    business_description: "Descripción general del negocio",
    business_summary: "Resumen de qué hace la empresa",
    history_trajectory: "Historia, trayectoria o experiencia",
    mission: "Misión",
    vision: "Visión",
    purpose: "Propósito",
    slogan: "Eslogan o frase comercial",
    country: "País detectado",
    primary_city_zone: "Ciudad o zona principal",
    coverage_scope: "Cobertura visible",
    primary_language: "Idioma principal de comunicación",
    industry: "Industria",
    subindustry: "Subindustria",
    business_category: "Categoría del negocio",
    business_type: "Tipo de negocio",
    market_segment: "Segmento de mercado",
    target_customer_type: "Tipo de cliente objetivo",
    primary_offers: "Oferta principal",
    services: "Servicios principales",
    products: "Productos principales",
    offer_categories: "Categorías de productos o servicios",
    plans_packages_memberships: "Planes, paquetes o membresías",
    benefits: "Beneficios visibles",
    differentiators: "Diferenciadores visibles",
    value_proposition: "Propuesta de valor",
    offer_features: "Características principales de la oferta",
    guarantees: "Garantías visibles",
    general_restrictions: "Restricciones generales",
    requirements: "Requisitos visibles",
    commercial_conditions: "Condiciones comerciales",
    promotions: "Promociones visibles",
    discounts: "Descuentos visibles",
    bonuses_incentives: "Bonos, beneficios adicionales o incentivos",
    ideal_customer_profile: "ICP (perfil de cliente ideal)",
    customer_entity_type: "Tipo de cliente principal",
    customer_needs: "Necesidades principales del cliente",
    customer_pains: "Dolores o problemas del cliente",
    purchase_motivations: "Motivaciones de compra",
    probable_objections: "Objeciones probables",
    customer_urgency: "Nivel de urgencia del cliente",
    education_required: "Nivel de educación requerido",
    human_advisory_required: "Necesidad de asesoría humana",
    communication_tone: "Tono de comunicación",
    formality_level: "Nivel de formalidad",
    communication_style: "Estilo de comunicación",
    frequent_words: "Palabras frecuentes",
    recurring_sales_phrases: "Frases comerciales recurrentes",
    emoji_usage_visible: "Uso visible de emojis",
    language_complexity: "Complejidad del lenguaje",
    customer_closeness: "Nivel de cercanía con el cliente",
    sales_style: "Estilo de venta",
    faqs: "FAQs (preguntas frecuentes) candidatas",
    visible_faqs: "Preguntas frecuentes visibles",
    common_customer_questions: "Dudas comunes del cliente",
    commercial_objections: "Objeciones comerciales",
    pre_advance_information: "Información necesaria antes de avanzar",
    repeated_topics: "Temas repetidos",
    frequently_explained_conditions: "Condiciones explicadas con frecuencia",
    public_answers: "Respuestas públicas utilizadas",
    possible_locations: "Posibles ubicaciones",
    possible_agencies: "Posibles agencias",
    possible_branches: "Posibles sucursales",
    visible_addresses: "Direcciones visibles",
    visible_cities: "Ciudades visibles",
    visible_sectors: "Sectores visibles",
    location_hours: "Horarios asociados a ubicación",
    google_maps_links: "Enlaces de Google Maps",
    location_references: "Referencias de ubicación",
    visible_hours: "Horarios visibles",
    service_days: "Días de atención visibles",
    hours_by_location: "Horarios por ubicación",
    special_hours: "Horarios especiales",
    visible_non_working_days: "Días no laborables visibles",
    phones: "Teléfonos visibles",
    whatsapp: "WhatsApp visible",
    emails: "Correos electrónicos",
    contact_forms: "Formularios de contacto",
    contact_links: "Enlaces de contacto",
    calls_to_action: "Llamados a la acción",
    official_social_networks: "Redes sociales oficiales",
    public_booking_links: "Enlaces públicos de agenda",
    primary_conversion_channel: "Canal principal de conversión",
    published_content_types: "Tipos de contenido publicado",
    promotion_types: "Tipos de promociones",
    most_promoted_offers: "Ofertas más promocionadas",
    frequent_topics: "Temas frecuentes",
    campaign_style: "Estilo de campañas",
    social_proof: "Pruebas sociales visibles",
    testimonials: "Testimonios visibles",
    reviews: "Reseñas visibles",
    success_cases: "Casos de éxito visibles",
    certifications_endorsements: "Certificaciones o respaldos",
    mentioned_brands_partners_clients: "Marcas, aliados o clientes mencionados",
    privacy_policy: "Política de privacidad",
    terms_conditions: "Términos y condiciones",
    legal_notices: "Avisos legales",
    data_processing_text: "Texto de tratamiento de datos personales",
    applicable_legal_country: "País legal aplicable",
    personal_data_forms: "Formularios que capturan datos personales",
    visible_consent_texts: "Textos de consentimiento visibles",
};

export const DYNAMIC_FIELD_PLACEHOLDERS: Record<DynamicContextFieldKey, string> = {
    commercial_name: "Ej. Simplia Consulting",
    business_description: "Ej. Ayudamos a empresas a automatizar su atención comercial con asistentes de IA, integraciones y procesos de conversión.",
    industry: "Ej. Tecnología / consultoría en inteligencia artificial",
    country: "Ej. Ecuador",
    value_proposition: "Ej. Implementamos automatización comercial con IA en menos tiempo y con acompañamiento estratégico.",
    primary_offers: "Ej.\nAutomatización de WhatsApp\nCRM comercial\nConsultoría de IA para ventas",
    benefits: "Ej.\nRespuesta más rápida a leads\nMenos carga operativa\nMejor seguimiento comercial",
    general_restrictions: "Ej.\nSolo trabajamos con empresas\nLa implementación requiere una llamada de diagnóstico\nNinguna",
    ideal_customer_profile: "Ej. Empresas con equipos comerciales que reciben leads por WhatsApp y necesitan responder, calificar y dar seguimiento con más velocidad.",
    communication_tone: "Ej. Cercano, consultivo y profesional. Lenguaje simple, directo y orientado a resultados.",
    faqs: "Ej.\n¿Qué servicios ofrecen? Respuesta: Automatización comercial, CRM y consultoría de IA.\n¿Cómo funciona el proceso? Respuesta: Primero diagnosticamos el flujo y luego configuramos el asistente.\n¿Atienden por WhatsApp? Respuesta: Sí, el canal principal puede ser WhatsApp.",
};

const FIELD_INFO: Record<DynamicContextFieldKey, InfoSealV1> = {
    commercial_name: {
        definition: "El nombre público con el que los clientes reconocen al negocio.",
        examples: ["Clínica Sonríe", "Simplia"],
        reason: "Permite que el asistente identifique correctamente a la empresa.",
        expectedFormat: "Texto corto, sin razón social salvo que ambas coincidan.",
    },
    business_description: {
        definition: "Un resumen breve de qué hace el negocio y qué ofrece.",
        examples: ["Asesoramos a pymes en gestión financiera y tributaria."],
        reason: "Da al AI Brain el contexto mínimo para responder con precisión.",
        expectedFormat: "Uno o dos párrafos claros.",
    },
    industry: {
        definition: "La actividad económica principal en la que opera el negocio.",
        examples: ["Salud", "Tecnología", "Servicios profesionales"],
        reason: "Ayuda a interpretar lenguaje, regulación y comportamiento comercial.",
        expectedFormat: "Una industria principal y, si hace falta, una subindustria.",
    },
    country: {
        definition: "El país principal donde opera o comercializa el negocio.",
        examples: ["Ecuador", "Colombia"],
        reason: "Afecta moneda, lenguaje local, horarios y contexto legal.",
        expectedFormat: "Nombre del país principal.",
    },
    value_proposition: {
        definition: "La razón principal por la que un cliente debería elegir este negocio.",
        examples: ["Implementación en 48 horas con acompañamiento personalizado."],
        reason: "Orienta el discurso comercial y los argumentos de conversión.",
        expectedFormat: "Una frase concreta centrada en el beneficio diferencial.",
    },
    primary_offers: {
        definition: "Los productos o servicios prioritarios que el bot debe conocer.",
        examples: ["Consulta inicial", "Plan empresarial", "Software de facturación"],
        reason: "Delimita la oferta base sin reemplazar el catálogo futuro.",
        expectedFormat: "Lista corta de ofertas principales.",
    },
    benefits: {
        definition: "Los resultados o ventajas que recibe el cliente.",
        examples: ["Atención rápida", "Garantía", "Asesoría personalizada"],
        reason: "Permite explicar valor más allá de características técnicas.",
        expectedFormat: "Lista de beneficios concretos.",
    },
    general_restrictions: {
        definition: "Condiciones comerciales generales que cambian quién puede avanzar.",
        examples: ["Solo empresas", "Cobertura únicamente en Quito"],
        reason: "Evita promesas incorrectas; no reemplaza gates posteriores.",
        expectedFormat: "Lista breve. Escribe 'Ninguna' cuando corresponda.",
    },
    ideal_customer_profile: {
        definition: "La persona o empresa que obtiene mayor valor de la oferta.",
        examples: ["Dueños de pymes con equipos de 5 a 30 personas"],
        reason: "Ayuda a ajustar tono, necesidades, objeciones y nivel de asesoría.",
        expectedFormat: "Descripción breve del cliente, necesidad y contexto.",
    },
    communication_tone: {
        definition: "La forma en que la marca habla con sus clientes.",
        examples: ["Formal", "Cercano", "Consultivo", "Premium"],
        reason: "Mantiene consistencia con la comunicación pública del negocio.",
        expectedFormat: "Uno o más tonos compatibles.",
    },
    faqs: {
        definition: "Dudas comunes que aparecen antes de comprar, consultar o agendar.",
        examples: ["¿Cuánto cuesta?", "¿Qué requisitos necesito?"],
        reason: "Da una primera base de respuestas sin reemplazar la gestión futura de FAQs.",
        expectedFormat: "Entre 3 y 20 preguntas con su respuesta. El sistema debe intentar extraer tantas como sean útiles desde el contexto público.",
    },
};

export const INTERNAL_INFO_SEALS = {
    averageTicket: {
        definition: "Valor aproximado que un cliente paga por compra, cita, servicio, contrato o transacción.",
        examples: ["USD 120 por cita", "USD 300 a 700 por servicio"],
        reason: "Ayuda a dimensionar el valor económico y el esfuerzo comercial de cada conversión.",
        expectedFormat: "Moneda y un valor positivo o un rango mínimo/máximo.",
    },
    ltv: {
        definition: "Valor total aproximado que un cliente genera durante toda su relación con el negocio.",
        examples: ["USD 1.200 durante 12 meses", "USD 400 por cuatro compras al año"],
        reason: "Permite estimar el valor de largo plazo de un lead convertido.",
        expectedFormat: "Moneda y un valor positivo o un rango mínimo/máximo.",
    },
    cac: {
        definition: "Costo total aproximado de conseguir un cliente nuevo.",
        examples: ["USD 25", "USD 30 a 50 en campañas pagadas"],
        reason: "Da contexto sobre la eficiencia comercial y el impacto esperado del bot.",
        expectedFormat: "Moneda y un valor positivo o un rango mínimo/máximo.",
    },
    businessModels: {
        definition: "Las formas mediante las que la empresa genera ingresos.",
        examples: ["Suscripción", "Servicios por proyecto", "Venta recurrente"],
        reason: "Define cómo debe entenderse la conversión y la relación comercial.",
        expectedFormat: "Selecciona una o varias opciones; describe 'Otro' cuando aplique.",
    },
} satisfies Record<string, InfoSealV1>;

export const OPERATIONAL_INFO_SEALS = {
    objective: {
        definition: "Define si el bot debe llevar al lead a una cita presencial o a una reunión comercial.",
        examples: ["Citas para visitar una sede", "Reuniones para una demo virtual"],
        reason: "Esta decisión bifurca el wizard y evita pedir información irrelevante.",
        expectedFormat: "Selecciona una sola opción.",
    },
    locations: {
        definition: "Sedes reales donde el negocio atiende citas presenciales.",
        examples: ["Sede Norte, Av. Principal 123, lunes a viernes 09:00-17:00"],
        reason: "El bot necesita sedes confirmadas para orientar al lead y evitar ubicaciones inventadas.",
        expectedFormat: "Nombre, ubicación y horario por cada sede. Google Maps es opcional.",
    },
    calendarEmail: {
        definition: "Correo con el que el equipo técnico configurará calendario y Google Meet.",
        examples: ["ventas@empresa.com", "agenda@empresa.com"],
        reason: "Las reuniones requieren permisos técnicos antes de automatizar calendario y Meet.",
        expectedFormat: "Un correo válido. Quedará pendiente de configuración técnica.",
    },
    agenda: {
        definition: "Reglas operativas de agendamiento: intervalo de inicio, cupos y notas comunes. En reuniones también define la zona horaria del negocio.",
        examples: ["Intervalos de 30 minutos, duración 60 minutos, 2 cupos por bloque"],
        reason: "Evita sobreagendar y permite construir plantillas de disponibilidad sin duplicar horarios por sede.",
        expectedFormat: "Intervalo 15/30/60 y cupos válidos. En reuniones, zona horaria IANA; en citas, horario y zona horaria se definen por sede.",
    },
    leadFields: {
        definition: "Datos que el bot debe pedir al lead antes de agendar.",
        examples: ["Nombre obligatorio", "Correo obligatorio", "Teléfono obligatorio solo si aplica"],
        reason: "La plantilla de confirmación debe incluir todas las variables capturadas.",
        expectedFormat: "Activa cada campo y marca si es obligatorio u opcional.",
    },
    stylePreference: {
        definition: "Preferencia de uso de emojis en las plantillas generadas.",
        examples: ["Sin emojis", "Moderado", "Solo en bienvenida"],
        reason: "Afecta la redacción, no la estructura del negocio.",
        expectedFormat: "Selecciona una sola preferencia.",
    },
} satisfies Record<string, InfoSealV1>;

export const isDynamicContextFieldKey = (key: string): key is DynamicContextFieldKey =>
    (DYNAMIC_CONTEXT_FIELD_KEYS as readonly string[]).includes(key);

export const fieldNeedsUserInput = (field: ContextFieldV1) => {
    if (!isDynamicContextFieldKey(field.key)) return false;
    if (field.contradiction) return true;
    if (field.origin === "inferred") return field.status !== "confirmed" && field.status !== "corrected";
    if (field.status === "not_found") return field.requiredForBase !== false;
    if (field.status === "pending_validation") return true;
    if (field.confidence === "medium" || field.confidence === "low") {
        return field.status !== "confirmed" && field.status !== "corrected";
    }
    return false;
};

const questionReason = (field: ContextFieldV1): DynamicQuestionV1["reason"] => {
    if (field.contradiction) return "contradiction";
    if (field.status === "not_found") return "not_found";
    if (field.confidence === "low") return "low_confidence";
    return "confirmation";
};

export const buildDynamicQuestions = (fields: ContextFieldV1[]): DynamicQuestionV1[] =>
    fields
        .filter(fieldNeedsUserInput)
        .map((field) => {
            const fieldKey = field.key as DynamicContextFieldKey;
            const reason = questionReason(field);
            return {
                fieldKey,
                label: FIELD_LABELS[fieldKey],
                prompt: reason === "not_found"
                    ? `No logramos obtener ${FIELD_LABELS[fieldKey].toLowerCase()}. Ingresa la información correcta.`
                    : reason === "contradiction"
                        ? `Encontramos versiones distintas de ${FIELD_LABELS[fieldKey].toLowerCase()}. Selecciona o escribe la correcta.`
                        : `Detectamos ${FIELD_LABELS[fieldKey].toLowerCase()}. Confirma o corrige la información.`,
                reason,
                suggestedValue: field.value,
                alternatives: field.alternatives,
                infoSeal: FIELD_INFO[fieldKey],
            };
        });

export const validateMoneyMetric = (metric: MoneyMetricV1 | null | undefined): string | null => {
    if (!metric?.currency?.trim()) return "Selecciona una moneda.";
    if (metric.mode === "single") {
        return typeof metric.value === "number" && Number.isFinite(metric.value) && metric.value > 0
            ? null
            : "Ingresa un valor mayor que cero.";
    }
    const min = metric.min;
    const max = metric.max;
    if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return "Ingresa un mínimo mayor que cero.";
    if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return "Ingresa un máximo mayor que cero.";
    if (max < min) return "El máximo no puede ser menor que el mínimo.";
    return null;
};

export const validateInternalBusinessData = (data: InternalBusinessDataV1 | null | undefined) => {
    const errors: Record<string, string> = {};
    const ticketError = validateMoneyMetric(data?.averageTicket);
    const ltvError = validateMoneyMetric(data?.ltv);
    const cacError = validateMoneyMetric(data?.cac);
    if (ticketError) errors.averageTicket = ticketError;
    if (ltvError) errors.ltv = ltvError;
    if (cacError) errors.cac = cacError;
    if (!data?.businessModels?.length) errors.businessModels = "Selecciona al menos un modelo de negocio.";
    if (data?.businessModels?.includes("Otro") && !data.otherBusinessModel?.trim()) {
        errors.otherBusinessModel = "Describe el otro modelo de negocio.";
    }
    return errors;
};

export const canFinalizeBaseContext = (
    fields: ContextFieldV1[],
    data: InternalBusinessDataV1 | null | undefined,
) => buildDynamicQuestions(fields).length === 0
    && Object.keys(validateInternalBusinessData(data)).length === 0;

export const areProvidedSourcesReady = (sources: OnboardingBreSourceV1[]) => {
    const provided = sources.filter((source) => source.origin === "user");
    const website = provided.find((source) => source.type === "website");
    return website?.status === "completed"
        && provided.every((source) =>
            source.status === "completed"
            || source.status === "partial"
            || (source.retryLimitReached && source.type !== "website")
        );
};

const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const emptyAgendaConfig = (): BreAgendaConfigV1 => ({
    timezone: "America/Guayaquil",
    startIntervalMinutes: 30,
    durationMinutes: 30,
    capacityPerSlot: 1,
    weeklyHours: DEFAULT_WEEKLY_HOURS,
    notes: "",
});

export const emptyLocation = (): BreLocationV1 => ({
    name: "",
    address: "",
    hours: "",
    weeklyHours: DEFAULT_WEEKLY_HOURS.map((item) => ({ ...item })),
    scheduleNotes: "",
    googleMapsUrl: "",
    appointmentTimezone: "",
    status: "confirmed",
    references: [],
});

const LOCATION_NAME_SOURCE_KEYS = ["possible_agencies", "possible_branches"] as const;
const LOCATION_ADDRESS_SOURCE_KEYS = ["visible_addresses"] as const;
const LOCATION_HOURS_SOURCE_KEYS = ["hours_by_location", "special_hours", "location_hours"] as const;
const LOCATION_REFERENCE_SOURCE_KEYS = ["location_references", "visible_cities", "visible_sectors", "possible_locations"] as const;
const LOCATION_MAPS_SOURCE_KEYS = ["google_maps_links"] as const;

const toStringLines = (value: unknown): string[] => {
    if (value === null || value === undefined) return [];
    if (typeof value === "string") {
        return value
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => toStringLines(item));
    }
    if (typeof value === "object") {
        return Object.values(value as Record<string, unknown>).flatMap((item) => toStringLines(item));
    }
    return [String(value).trim()].filter(Boolean);
};

export const isValidIanaTimezone = (value: string | null | undefined) => {
    const timezone = String(value || "").trim();
    if (!timezone) return false;
    try {
        Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
        return true;
    } catch {
        return false;
    }
};

const TIMEZONE_CONTEXT_HINTS: Array<{ timezone: string; terms: string[] }> = [
    { timezone: "America/Guayaquil", terms: ["ecuador", "quito", "guayaquil", "cuenca", "guayaquil ecuador"] },
    { timezone: "Europe/Madrid", terms: ["espana", "españa", "madrid", "barcelona", "valencia", "sevilla"] },
    { timezone: "Europe/London", terms: ["reino unido", "londres", "london", "united kingdom", "uk"] },
    { timezone: "America/New_York", terms: ["new york", "nueva york", "miami", "florida", "washington", "estados unidos", "usa"] },
    { timezone: "America/Mexico_City", terms: ["mexico", "méxico", "ciudad de mexico", "ciudad de méxico", "cdmx"] },
    { timezone: "America/Bogota", terms: ["colombia", "bogota", "bogotá", "medellin", "medellín"] },
    { timezone: "America/Lima", terms: ["peru", "perú", "lima"] },
    { timezone: "America/Santiago", terms: ["chile", "santiago de chile", "santiago"] },
    { timezone: "America/Argentina/Buenos_Aires", terms: ["argentina", "buenos aires"] },
    { timezone: "America/Panama", terms: ["panama", "panamá"] },
    { timezone: "America/Costa_Rica", terms: ["costa rica", "san jose costa rica", "san josé costa rica"] },
    { timezone: "America/Santo_Domingo", terms: ["republica dominicana", "república dominicana", "santo domingo"] },
];

export const inferIanaTimezoneFromContext = (
    fields: ContextFieldV1[] = [],
    fallback = "America/Guayaquil",
) => {
    const explicitTimezone = fields
        .flatMap((field) => toStringLines(field.value))
        .map((line) => line.trim())
        .find((line) => isValidIanaTimezone(line));
    if (explicitTimezone) return explicitTimezone;

    const haystack = normalizeText(
        fields
            .flatMap((field) => [field.key, ...toStringLines(field.value)])
            .join(" "),
    );
    const match = TIMEZONE_CONTEXT_HINTS.find((hint) =>
        hint.terms.some((term) => haystack.includes(normalizeText(term))),
    );
    return match?.timezone || fallback;
};

const canonicalLocationName = (value: string) => normalizeText(value)
    .replace(/\b(agencia|agencias|sede|sedes|sucursal|sucursales|oficina|oficinas|local|locales)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const cloneWeeklyHours = (enabledByDefault = false): BreWeeklyHourV1[] => DEFAULT_WEEKLY_HOURS.map((item) => ({
    ...item,
    enabled: enabledByDefault ? item.enabled : false,
}));

const TIME_TOKEN_REGEX = /(\d{1,2})(?:[:hH]?(\d{2}))?\s*(am|pm)?/gi;

const parseTimeToken = (value: string) => {
    const match = value.trim().match(/^(\d{1,2})(?:[:hH]?(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minutes = match[2] || "00";
    const suffix = match[3]?.toLowerCase();
    if (Number.isNaN(hour) || hour > 24) return null;
    if (suffix === "am") {
        if (hour === 12) hour = 0;
    } else if (suffix === "pm") {
        if (hour < 12) hour += 12;
    }
    if (hour === 24) hour = 0;
    return `${String(hour).padStart(2, "0")}:${minutes.padStart(2, "0")}`;
};

const DAY_ALIASES: Array<{ day: BreWeekday; aliases: string[] }> = [
    { day: "monday", aliases: ["lunes"] },
    { day: "tuesday", aliases: ["martes"] },
    { day: "wednesday", aliases: ["miercoles", "miércoles"] },
    { day: "thursday", aliases: ["jueves"] },
    { day: "friday", aliases: ["viernes"] },
    { day: "saturday", aliases: ["sabado", "sábado", "sabados", "sábados"] },
    { day: "sunday", aliases: ["domingo", "domingos"] },
];

const ORDERED_WEEKDAYS: BreWeekday[] = DAY_ALIASES.map((item) => item.day);

const dayFromAlias = (value: string) => DAY_ALIASES.find((item) => item.aliases.some((alias) => value.includes(normalizeText(alias))))?.day || null;

const extractDaysFromClause = (value: string): BreWeekday[] => {
    const normalized = normalizeText(value);
    const rangeMatch = normalized.match(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\s+a\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?/);
    if (rangeMatch) {
        const start = dayFromAlias(rangeMatch[1]);
        const end = dayFromAlias(rangeMatch[2]);
        if (start && end) {
            const startIndex = ORDERED_WEEKDAYS.indexOf(start);
            const endIndex = ORDERED_WEEKDAYS.indexOf(end);
            if (startIndex >= 0 && endIndex >= startIndex) {
                return ORDERED_WEEKDAYS.slice(startIndex, endIndex + 1);
            }
        }
    }
    const found = ORDERED_WEEKDAYS.filter((day) => DAY_ALIASES.find((item) => item.day === day)?.aliases.some((alias) => normalized.includes(normalizeText(alias))));
    return Array.from(new Set(found));
};

const parseWeeklyHoursFromText = (value: string) => {
    const weeklyHours = cloneWeeklyHours();
    const notes: string[] = [];
    const source = value.trim();
    if (!source) return { weeklyHours, scheduleNotes: "" };
    const clauses = source
        .split(/\r?\n|;/)
        .map((item) => item.trim())
        .filter(Boolean);

    clauses.forEach((clause) => {
        const dayMatches = extractDaysFromClause(clause);
        const timeMatches = Array.from(clause.matchAll(TIME_TOKEN_REGEX))
            .map((match) => parseTimeToken(match[0]))
            .filter((item): item is string => Boolean(item));

        if (dayMatches.length && timeMatches.length >= 2) {
            dayMatches.forEach((day) => {
                const index = weeklyHours.findIndex((item) => item.day === day);
                if (index >= 0) {
                    weeklyHours[index] = {
                        day,
                        enabled: true,
                        startTime: timeMatches[0],
                        endTime: timeMatches[1],
                    };
                }
            });
            return;
        }

        notes.push(clause);
    });

    const enabledCount = weeklyHours.filter((item) => item.enabled).length;
    return {
        weeklyHours,
        scheduleNotes: notes.join("\n") || (enabledCount === 0 ? source : ""),
    };
};

const findContextField = (fields: ContextFieldV1[], key: string) => fields.find((field) => field.key === key);

const collectContextLines = (fields: ContextFieldV1[], keys: readonly string[]) =>
    keys.flatMap((key) => fields
        .filter((field) => field.key === key)
        .flatMap((field) => toStringLines(field.value)));

const matchLocationName = (text: string, names: string[]) => {
    const normalizedText = canonicalLocationName(text);
    return [...names]
        .sort((left, right) => canonicalLocationName(right).length - canonicalLocationName(left).length)
        .find((name) => {
            const normalizedName = canonicalLocationName(name);
            return normalizedName && (normalizedText.includes(normalizedName) || normalizedName.includes(normalizedText));
        }) || null;
};

const cleanLocationLabel = (value: string) => value
    .replace(/^\s*(agencia|sede|sucursal|oficina|local)\s+/i, "")
    .trim();

const URL_REGEX = /https?:\/\/[^\s),]+/i;

const cleanGoogleMapsUrl = (value: string) => value
    .trim()
    .replace(/[)\].,;]+$/g, "");

const isGoogleMapsUrl = (value: string) =>
    /(?:maps\.app\.goo\.gl|google\.[^/\s]+\/maps|goo\.gl\/maps)/i.test(value);

const decodeGoogleMapsText = (value: string) => {
    try {
        return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
        return value.replace(/\+/g, " ");
    }
};

const extractGoogleMapsPlaceName = (url: string) => {
    const decoded = decodeGoogleMapsText(url);
    const placeMatch = decoded.match(/\/(?:maps\/)?place\/([^/@?]+)/i);
    if (placeMatch?.[1]) {
        return cleanLocationLabel(placeMatch[1].replace(/[+/]+/g, " ")).trim();
    }

    const queryMatch = decoded.match(/[?&](?:q|query)=([^&]+)/i);
    if (queryMatch?.[1]) {
        return cleanLocationLabel(queryMatch[1].replace(/[+/]+/g, " ")).trim();
    }

    return "";
};

const looksLikeHoursText = (value: string) => {
    const normalized = normalizeText(value);
    return /(lunes|martes|miercoles|jueves|viernes|sabado|domingo|horario|atencion|atiende)/.test(normalized)
        && /\d/.test(normalized);
};

const looksLikeAddressText = (value: string) => {
    const normalized = normalizeText(value);
    return /\b(av|avenida|calle|edificio|centro comercial|plaza|local|piso|sector|quito|guayaquil|cuenca|santo domingo|direccion|dirección)\b/.test(normalized);
};

const splitMapLineParts = (value: string, url: string) => value
    .replace(url, "")
    .split(/\s+[|•]\s+|\s+-\s+|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

type GoogleMapsCandidate = {
    name: string;
    address?: string;
    googleMapsUrl: string;
    hoursText?: string;
    rawText: string;
};

const buildGoogleMapsCandidate = (line: string, fallbackIndex: number): GoogleMapsCandidate | null => {
    const urlMatch = line.match(URL_REGEX);
    if (!urlMatch) return null;

    const googleMapsUrl = cleanGoogleMapsUrl(urlMatch[0]);
    if (!isGoogleMapsUrl(googleMapsUrl)) return null;

    const parts = splitMapLineParts(line, googleMapsUrl);
    const nameFromUrl = extractGoogleMapsPlaceName(googleMapsUrl);
    const nameFromText = parts.find((part) => !looksLikeHoursText(part) && !looksLikeAddressText(part));
    const address = parts.find(looksLikeAddressText);
    const hoursText = parts.filter(looksLikeHoursText).join("\n");

    return {
        name: cleanLocationLabel(nameFromText || nameFromUrl || `Ubicación sugerida ${fallbackIndex + 1}`),
        address,
        googleMapsUrl,
        hoursText,
        rawText: line.trim(),
    };
};

type SuggestedLocationDraft = {
    name: string;
    address?: string;
    googleMapsUrl?: string;
    hoursText?: string;
    references: Set<string>;
};

export const hydrateLocationForEditor = (location: BreLocationV1): BreLocationV1 => {
    const parsedSchedule = parseWeeklyHoursFromText(location.hours || location.scheduleNotes || "");
    return {
        ...location,
        weeklyHours: location.weeklyHours?.length ? location.weeklyHours : parsedSchedule.weeklyHours,
        scheduleNotes: location.scheduleNotes || parsedSchedule.scheduleNotes,
    };
};

export const buildSuggestedLocationsFromContext = (fields: ContextFieldV1[]): BreLocationV1[] => {
    const maps = collectContextLines(fields, LOCATION_MAPS_SOURCE_KEYS);
    const mapCandidates = maps
        .map((line, index) => buildGoogleMapsCandidate(line, index))
        .filter((candidate): candidate is GoogleMapsCandidate => Boolean(candidate));

    const nameLines = [
        ...collectContextLines(fields, LOCATION_NAME_SOURCE_KEYS),
        ...collectContextLines(fields, ["hours_by_location"]).map((line) => line.split(":")[0]?.trim()).filter(Boolean),
        ...collectContextLines(fields, ["special_hours"]).map((line) => line.split(":")[0]?.trim()).filter(Boolean),
        ...mapCandidates.map((candidate) => candidate.name),
    ]
        .map((line) => cleanLocationLabel(line))
        .filter(Boolean);

    const uniqueNames = Array.from(new Set(nameLines));
    if (!uniqueNames.length) return [];

    const drafts = new Map<string, SuggestedLocationDraft>();
    uniqueNames.forEach((name) => drafts.set(name, {
        name,
        references: new Set<string>(),
    }));

    const addresses = collectContextLines(fields, LOCATION_ADDRESS_SOURCE_KEYS);
    const references = collectContextLines(fields, LOCATION_REFERENCE_SOURCE_KEYS);
    const hoursLines = collectContextLines(fields, LOCATION_HOURS_SOURCE_KEYS);

    const assignSequential = (lines: string[], assign: (draft: SuggestedLocationDraft, line: string) => void) => {
        const pending = [...drafts.values()].filter((draft) => !draft.address);
        if (lines.length === pending.length) {
            lines.forEach((line, index) => {
                const draft = pending[index];
                if (draft) assign(draft, line);
            });
        }
    };

    addresses.forEach((line) => {
        const name = matchLocationName(line, uniqueNames);
        if (!name) return;
        const draft = drafts.get(name);
        if (draft && !draft.address) draft.address = line.trim();
    });
    assignSequential(addresses.filter((line) => !matchLocationName(line, uniqueNames)), (draft, line) => {
        draft.address = line.trim();
    });

    references.forEach((line) => {
        const matchingName = matchLocationName(line, uniqueNames);
        if (matchingName) {
            drafts.get(matchingName)?.references.add(line.trim());
        }
    });

    hoursLines.forEach((line) => {
        const [rawName, ...rest] = line.split(":");
        const explicitName = cleanLocationLabel(rawName || "");
        const hoursText = rest.join(":").trim();
        const matchingName = explicitName && drafts.has(explicitName) ? explicitName : matchLocationName(line, uniqueNames);
        if (matchingName && hoursText) {
            const draft = drafts.get(matchingName);
            if (draft) draft.hoursText = draft.hoursText ? `${draft.hoursText}\n${hoursText}` : hoursText;
        }
    });

    mapCandidates.forEach((candidate, index) => {
        const matchingName = matchLocationName(candidate.name, uniqueNames)
            || matchLocationName(candidate.rawText, uniqueNames);
        const draft = matchingName ? drafts.get(matchingName) : [...drafts.values()][index];
        if (!draft) return;

        if (!draft.googleMapsUrl) draft.googleMapsUrl = candidate.googleMapsUrl;
        if (!draft.address && candidate.address) draft.address = candidate.address.trim();
        if (!draft.hoursText && candidate.hoursText) draft.hoursText = candidate.hoursText;
        if (candidate.rawText) draft.references.add(candidate.rawText);
    });

    return [...drafts.values()].map((draft) => {
        const parsedSchedule = parseWeeklyHoursFromText(draft.hoursText || "");
        return {
            name: draft.name,
            address: draft.address || "",
            hours: draft.hoursText || "",
            weeklyHours: parsedSchedule.weeklyHours,
            scheduleNotes: parsedSchedule.scheduleNotes,
            googleMapsUrl: draft.googleMapsUrl || "",
            appointmentTimezone: "",
            status: "suggested" as const,
            references: [...draft.references].map((value) => ({
                referenceType: "phrase" as const,
                value,
                confidence: "medium" as const,
            })),
        };
    }).filter((draft) => draft.name.trim() || draft.address.trim() || draft.googleMapsUrl.trim());
};

export const formatWeeklyHours = (weeklyHours: BreWeeklyHourV1[], notes?: string | null) => {
    const enabled = weeklyHours.filter((item) => item.enabled);
    const lines = enabled.map((item) => `${WEEKDAY_LABELS[item.day]}: ${item.startTime} - ${item.endTime}`);
    const cleanNotes = notes?.trim();
    return [...lines, ...(cleanNotes ? [`Notas: ${cleanNotes}`] : [])].join("\n");
};

export const validateLocations = (locations: BreLocationV1[]) => {
    const errors: string[] = [];
    if (!locations.length) errors.push("Agrega al menos una sede real.");
    locations.forEach((location, index) => {
        if (!location.name.trim()) errors.push(`La sede ${index + 1} requiere nombre.`);
        if (!location.address.trim()) errors.push(`La sede ${index + 1} requiere ubicación.`);
        const weeklyHours = location.weeklyHours || [];
        const enabled = weeklyHours.filter((item) => item.enabled);
        if (weeklyHours.length > 0) {
            if (!enabled.length) errors.push(`La sede ${index + 1} requiere al menos un día de atención.`);
            enabled.forEach((item) => {
                if (!isTime(item.startTime) || !isTime(item.endTime)) errors.push(`${WEEKDAY_LABELS[item.day]} de la sede ${index + 1} tiene un horario inválido.`);
                if (item.startTime >= item.endTime) errors.push(`${WEEKDAY_LABELS[item.day]} de la sede ${index + 1} debe terminar después de iniciar.`);
            });
        } else if (!location.hours.trim()) {
            errors.push(`La sede ${index + 1} requiere horario.`);
        }
    });
    return errors;
};

export const validateAgendaConfig = (
    agenda: BreAgendaConfigV1 | null | undefined,
    objective: BreOperationalObjective | null | undefined = "meetings",
) => {
    const errors: string[] = [];
    const isAppointments = objective === "appointments";
    if (!isAppointments) {
        if (!agenda?.timezone?.trim()) {
            errors.push("La zona horaria es obligatoria.");
        } else if (!isValidIanaTimezone(agenda.timezone)) {
            errors.push("La zona horaria debe estar en formato IANA, por ejemplo America/Guayaquil o Europe/Madrid.");
        }
    }
    if (![15, 30, 60].includes(Number(agenda?.startIntervalMinutes))) errors.push("El intervalo debe ser 15, 30 o 60 minutos.");
    if (isAppointments) {
        if (!Number.isFinite(agenda?.capacityPerSlot) || Number(agenda?.capacityPerSlot) < 0) errors.push("Los cupos por bloque deben ser cero o mayores.");
    } else {
        if (![15, 30, 60, 120].includes(Number(agenda?.durationMinutes))) errors.push("La duración debe ser 15, 30, 60 o 120 minutos.");
        if (!Number.isFinite(agenda?.capacityPerSlot) || Number(agenda?.capacityPerSlot) <= 0) errors.push("Los cupos por bloque deben ser mayores que cero.");
    }
    const enabled = agenda?.weeklyHours?.filter((item) => item.enabled) || [];
    if (!enabled.length) errors.push("Activa al menos un día de atención.");
    enabled.forEach((item) => {
        if (!isTime(item.startTime) || !isTime(item.endTime)) errors.push(`${WEEKDAY_LABELS[item.day]} tiene un horario inválido.`);
        if (item.startTime >= item.endTime) errors.push(`${WEEKDAY_LABELS[item.day]} debe terminar después de iniciar.`);
    });
    return errors;
};

export const validateLeadCaptureFields = (fields: BreLeadCaptureFieldV1[], objective: BreOperationalObjective | null | undefined) => {
    const errors: string[] = [];
    const enabled = fields.filter((field) => field.enabled);
    if (!enabled.length) errors.push("Activa al menos un dato para capturar.");
    enabled.forEach((field) => {
        if (!field.label.trim()) errors.push("Cada campo activo necesita una etiqueta visible.");
        if (field.fieldKey === "custom" && !field.customKey?.trim()) errors.push("El campo personalizado necesita una clave interna.");
    });
    return errors;
};

export const validateStylePreference = (style: BreStylePreferenceV1 | null | undefined) => {
    if (!style || !["moderate", "none", "commercial_only"].includes(style.emojiMode)) {
        return ["Selecciona una preferencia de emojis."];
    }
    return [];
};
