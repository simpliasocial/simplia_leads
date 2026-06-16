import {
    DYNAMIC_CONTEXT_FIELD_KEYS,
    type ContextFieldV1,
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
        expectedFormat: "Entre 3 y 5 preguntas con su respuesta cuando sea posible.",
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
        && provided.every((source) => source.status === "completed" || source.status === "partial");
};
