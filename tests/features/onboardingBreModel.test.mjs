import assert from "node:assert/strict";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url);
const {
    buildDynamicQuestions,
    buildSuggestedLocationsFromContext,
    canFinalizeBaseContext,
    areProvidedSourcesReady,
    CONTEXT_FIELD_LABELS,
    DEFAULT_LEAD_FIELDS,
    DYNAMIC_FIELD_PLACEHOLDERS,
    emptyAgendaConfig,
    emptyLocation,
    validateAgendaConfig,
    validateInternalBusinessData,
    validateLeadCaptureFields,
    validateLocations,
    validateStylePreference,
} = jiti("../../src/features/onboarding-bre/model/onboardingBreModel.ts");

const test = (name, fn) => {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
};

const field = (overrides = {}) => ({
    key: "industry",
    category: "classification",
    value: "Tecnología",
    origin: "extracted",
    confidence: "high",
    status: "extracted",
    evidence: [],
    ...overrides,
});

const validInternal = {
    averageTicket: { currency: "USD", mode: "single", value: 100 },
    ltv: { currency: "USD", mode: "range", min: 500, max: 1000 },
    cac: { currency: "USD", mode: "single", value: 25 },
    businessModels: ["Suscripción"],
};

test("high-confidence extracted values do not create confirmation questions", () => {
    assert.equal(buildDynamicQuestions([field()]).length, 0);
});

test("inferred values always require confirmation even with high confidence", () => {
    const questions = buildDynamicQuestions([field({ origin: "inferred", status: "inferred" })]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].reason, "confirmation");
});

test("questions are only generated for the eleven permitted context fields", () => {
    const questions = buildDynamicQuestions([
        field({ key: "mission", status: "not_found", value: null }),
        field({ key: "commercial_name", status: "not_found", value: null }),
    ]);
    assert.deepEqual(questions.map((question) => question.fieldKey), ["commercial_name"]);
});

test("context field labels and writing examples are Spanish user-facing text", () => {
    assert.equal(CONTEXT_FIELD_LABELS.communication_tone, "Tono de comunicación");
    assert.equal(CONTEXT_FIELD_LABELS.faqs, "FAQs (preguntas frecuentes) candidatas");
    assert.match(DYNAMIC_FIELD_PLACEHOLDERS.faqs, /¿Qué servicios ofrecen\?/);
});

test("contradictions generate a resolution question and keep alternatives", () => {
    const alternatives = [{ value: "Ecuador" }, { value: "Colombia" }];
    const [question] = buildDynamicQuestions([
        field({ key: "country", contradiction: true, alternatives }),
    ]);
    assert.equal(question.reason, "contradiction");
    assert.deepEqual(question.alternatives, alternatives);
});

test("all internal metrics and a business model are mandatory", () => {
    const errors = validateInternalBusinessData({
        ...validInternal,
        cac: { currency: "USD", mode: "single", value: 0 },
        businessModels: [],
    });
    assert.ok(errors.cac);
    assert.ok(errors.businessModels);
});

test("base context only finalizes with resolved questions and valid internal data", () => {
    assert.equal(canFinalizeBaseContext([field()], validInternal), true);
    assert.equal(canFinalizeBaseContext([field({ origin: "inferred", status: "inferred" })], validInternal), false);
});

test("provided sources must produce evidence while discovered failures stay complementary", () => {
    const website = { type: "website", origin: "user", status: "completed", url: "https://example.com" };
    const facebook = { type: "facebook", origin: "user", status: "partial", url: "https://facebook.com/example" };
    const discovered = { type: "linkedin", origin: "discovered", status: "platform_blocked", url: "https://linkedin.com/company/example" };

    assert.equal(areProvidedSourcesReady([website, facebook, discovered]), true);
    assert.equal(areProvidedSourcesReady([website, { ...facebook, status: "failed" }]), false);
    assert.equal(areProvidedSourcesReady([website, { ...facebook, status: "failed", retryLimitReached: true }]), true);
});

test("appointments require at least one confirmed location with address and hours", () => {
    assert.deepEqual(validateLocations([]), ["Agrega al menos una sede real."]);

    const location = {
        ...emptyLocation(),
        name: "Matriz",
        address: "Av. Amazonas y Naciones Unidas, Quito",
        hours: "Lunes a viernes de 09:00 a 17:00",
    };
    assert.deepEqual(validateLocations([location]), []);
});

test("location suggestions prioritize scraping context and use Google Maps only as fallback", () => {
    const locations = buildSuggestedLocationsFromContext([
        field({
            key: "possible_agencies",
            category: "locations",
            value: "Agencia Matriz",
        }),
        field({
            key: "visible_addresses",
            category: "locations",
            value: "Agencia Matriz: Av. Contexto 123, Quito",
        }),
        field({
            key: "hours_by_location",
            category: "hours",
            value: "Agencia Matriz: Lunes a viernes 09:00 a 17:00",
        }),
        field({
            key: "google_maps_links",
            category: "locations",
            value: "Agencia Matriz - Av. Google 999 - Horario: Lunes a viernes 10:00 a 18:00 - https://www.google.com/maps/place/Agencia+Matriz",
        }),
        field({
            key: "google_maps_links",
            category: "locations",
            value: "https://maps.app.goo.gl/example",
        }),
    ]);

    const matriz = locations.find((location) => location.name === "Matriz");
    assert.ok(matriz);
    assert.match(matriz.address, /Contexto 123/);
    assert.match(matriz.hours, /09:00/);
    assert.doesNotMatch(matriz.hours, /10:00/);
    assert.equal(matriz.googleMapsUrl, "https://www.google.com/maps/place/Agencia+Matriz");

    const mapsOnly = locations.find((location) => location.name === "Ubicación sugerida 2");
    assert.ok(mapsOnly);
    assert.equal(mapsOnly.googleMapsUrl, "https://maps.app.goo.gl/example");
});

test("agenda validation enforces intervals, duration, capacity and enabled days", () => {
    const agenda = emptyAgendaConfig("America/Guayaquil");
    assert.deepEqual(validateAgendaConfig(agenda), []);

    const invalidAgenda = {
        ...agenda,
        startIntervalMinutes: 10,
        durationMinutes: 0,
        capacityPerSlot: 0,
        weeklyHours: agenda.weeklyHours.map((day) => ({ ...day, enabled: false })),
    };
    const errors = validateAgendaConfig(invalidAgenda);
    assert.ok(errors.some((error) => error.includes("intervalo")));
    assert.ok(errors.some((error) => error.includes("duración")));
    assert.ok(errors.some((error) => error.includes("cupos")));
    assert.ok(errors.some((error) => error.includes("día")));
});

test("lead fields let the user decide which enabled fields are mandatory", () => {
    const configurableFields = DEFAULT_LEAD_FIELDS.map((field) => ({ ...field, required: false }));
    assert.deepEqual(validateLeadCaptureFields(configurableFields, "meetings"), []);
    assert.deepEqual(validateLeadCaptureFields(configurableFields, "appointments"), []);
});

test("style preference accepts only configured emoji modes", () => {
    assert.deepEqual(validateStylePreference({ emojiMode: "moderate" }), []);
    assert.ok(validateStylePreference({ emojiMode: "loud" }).length > 0);
});
