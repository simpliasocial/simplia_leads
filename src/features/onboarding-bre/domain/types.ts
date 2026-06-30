export type OnboardingBreRole = "platform_admin" | "company_admin" | "operator";

export interface OnboardingActor {
    id: string;
    role: OnboardingBreRole;
    email?: string | null;
}

export type BreProjectStatus =
    | "draft"
    | "sources_ready"
    | "scraping"
    | "review_context"
    | "collecting_answers"
    | "base_context_complete"
    | "objective_selected"
    | "locations_configured"
    | "agenda_configured"
    | "lead_fields_configured"
    | "style_configured"
    | "generating_bot"
    | "ready_for_technical_review";

export type BreSourceType =
    | "website"
    | "instagram"
    | "facebook"
    | "tiktok"
    | "linkedin"
    | "youtube"
    | "other";

export type BreSourceStatus =
    | "pending"
    | "queued"
    | "processing"
    | "completed"
    | "partial"
    | "platform_blocked"
    | "failed";

export type ContextFieldOrigin = "extracted" | "inferred" | "user";
export type ContextConfidence = "high" | "medium" | "low" | null;
export type ContextFieldStatus =
    | "extracted"
    | "inferred"
    | "not_found"
    | "pending_validation"
    | "confirmed"
    | "corrected";

export type ContextCategory =
    | "identity"
    | "classification"
    | "offer"
    | "icp"
    | "communication"
    | "faqs"
    | "locations"
    | "hours"
    | "contacts"
    | "marketing"
    | "legal";

export interface EvidenceV1 {
    id?: string;
    url: string;
    sourceType: BreSourceType;
    originalText: string;
    capturedAt: string;
    contentHash: string;
}

export interface ContextFieldV1 {
    key: string;
    category: ContextCategory;
    value: unknown;
    origin: ContextFieldOrigin;
    confidence: ContextConfidence;
    status: ContextFieldStatus;
    evidence: EvidenceV1[];
    alternatives?: Array<{ value: unknown; evidenceIds?: string[] }>;
    contradiction?: boolean;
    requiredForBase?: boolean;
}

export interface OnboardingBreSourceV1 {
    id?: string;
    type: BreSourceType;
    url: string;
    origin: "user" | "discovered";
    status: BreSourceStatus;
    pagesProcessed?: number;
    attemptCount?: number;
    retryCount?: number;
    retryLimitReached?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface OnboardingBreProjectSummaryV1 {
    id: string;
    name: string;
    status: BreProjectStatus;
    currentStep: string;
    assignedUserIds: string[];
    updatedAt: string;
}

export interface ScrapeSourceProgressV1 {
    sourceId: string;
    sourceType: BreSourceType;
    status: BreSourceStatus;
    pagesProcessed: number;
    attemptCount?: number;
    retryCount?: number;
    retryLimitReached?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface ScrapeRunV1 {
    id: string;
    status: "queued" | "processing" | "completed" | "partial" | "failed";
    pagesProcessed: number;
    sourcesTotal: number;
    sourcesCompleted: number;
    sourceProgress: ScrapeSourceProgressV1[];
    startedAt?: string | null;
    finishedAt?: string | null;
}

export interface MoneyMetricV1 {
    currency: string;
    mode: "single" | "range";
    value?: number | null;
    min?: number | null;
    max?: number | null;
}

export interface InternalBusinessDataV1 {
    averageTicket: MoneyMetricV1;
    ltv: MoneyMetricV1;
    cac: MoneyMetricV1;
    businessModels: string[];
    otherBusinessModel?: string | null;
}

export type BreOperationalObjective = "appointments" | "meetings";
export type BreMeetSetupStatus = "not_applicable" | "pending_technical_setup" | "configured";

export interface OperationalObjectiveConfigV1 {
    objective: BreOperationalObjective;
    meetingSetupFeeUsd?: number | null;
    calendarEmail?: string | null;
    meetStatus?: BreMeetSetupStatus;
    locationTerm?: string | null;
    updatedAt?: string | null;
}

export interface BreLocationReferenceV1 {
    id?: string;
    locationId?: string;
    referenceType: "alias" | "city" | "sector" | "phrase";
    value: string;
    confidence: ContextConfidence;
}

export interface BreLocationV1 {
    id?: string;
    name: string;
    address: string;
    hours: string;
    weeklyHours?: BreWeeklyHourV1[];
    scheduleNotes?: string | null;
    googleMapsUrl?: string | null;
    appointmentTimezone?: string | null;
    status: "confirmed" | "suggested";
    references: BreLocationReferenceV1[];
}

export type BreWeekday =
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";

export interface BreWeeklyHourV1 {
    day: BreWeekday;
    enabled: boolean;
    startTime: string;
    endTime: string;
}

export interface BreAgendaConfigV1 {
    timezone: string;
    startIntervalMinutes: 15 | 30 | 60;
    durationMinutes: number;
    capacityPerSlot: number;
    weeklyHours: BreWeeklyHourV1[];
    notes?: string | null;
}

export type BreLeadFieldKey = "full_name" | "phone" | "email" | "national_id" | "age" | "city" | "custom";
export type BreLeadFieldCaptureTiming = "conversation_start" | "when_scheduling";

export interface BreLeadCaptureFieldV1 {
    fieldKey: BreLeadFieldKey;
    label: string;
    enabled: boolean;
    required: boolean;
    captureTiming?: BreLeadFieldCaptureTiming;
    blocksEarlyFlow?: boolean;
    reason?: string | null;
    customKey?: string | null;
}

export type BreEmojiMode = "moderate" | "none" | "commercial_only";

export interface BreStylePreferenceV1 {
    emojiMode: BreEmojiMode;
}

export type BrePromptBlockKey =
    | "business_context"
    | "objective_config"
    | "locations_block"
    | "agenda_block"
    | "lead_fields_block"
    | "filters_block"
    | "lopdp_block"
    | "templates_block"
    | "variables_block"
    | "faq_products_block"
    | "compiled_prompt";

export interface BrePromptBlockV1 {
    id?: string;
    blockKey: BrePromptBlockKey;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface BrePromptVersionV1 {
    id: string;
    versionNumber: number;
    status: "candidate" | "published" | "archived";
    compiledPrompt: string;
    blocks: BrePromptBlockV1[];
    createdAt: string;
}

export interface BreMatcherVersionV1 {
    id: string;
    versionNumber: number;
    status: "candidate" | "published" | "archived";
    labels: Array<"bienvenida" | "solicita_informacion" | "interesado" | "desinteresado" | "cita_agendada" | "tiene_dudas">;
    matcherConfig: Record<string, unknown>;
    matcherCode: string;
    createdAt: string;
}

export interface OperationalOnboardingCompletedV1 {
    eventType: "OperationalOnboardingCompletedV1";
    version: 1;
    projectId: string;
    completedAt: string;
    reviewStatus: "ready_for_technical_review";
    objective: OperationalObjectiveConfigV1;
    agenda: BreAgendaConfigV1;
    locations: BreLocationV1[];
    leadCaptureFields: BreLeadCaptureFieldV1[];
    stylePreference: BreStylePreferenceV1;
    promptVersionId: string;
    matcherVersionId: string;
}

export interface DynamicQuestionV1 {
    fieldKey: DynamicContextFieldKey;
    label: string;
    prompt: string;
    reason: "not_found" | "low_confidence" | "confirmation" | "contradiction";
    suggestedValue?: unknown;
    alternatives?: Array<{ value: unknown; evidenceIds?: string[] }>;
    infoSeal: InfoSealV1;
}

export interface InfoSealV1 {
    definition: string;
    examples: string[];
    reason: string;
    expectedFormat: string;
}

export const DYNAMIC_CONTEXT_FIELD_KEYS = [
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
] as const;

export type DynamicContextFieldKey = typeof DYNAMIC_CONTEXT_FIELD_KEYS[number];

export interface OnboardingBreProjectV1 extends OnboardingBreProjectSummaryV1 {
    sources: OnboardingBreSourceV1[];
    latestRun: ScrapeRunV1 | null;
    contextFields: ContextFieldV1[];
    dynamicQuestions: DynamicQuestionV1[];
    internalData: InternalBusinessDataV1 | null;
    completionEvent: BaseBusinessContextCompletedV1 | null;
    operationalObjective: OperationalObjectiveConfigV1 | null;
    locations: BreLocationV1[];
    agendaConfig: BreAgendaConfigV1 | null;
    leadCaptureFields: BreLeadCaptureFieldV1[];
    stylePreference: BreStylePreferenceV1 | null;
    promptVersion: BrePromptVersionV1 | null;
    matcherVersion: BreMatcherVersionV1 | null;
    operationalCompletionEvent: OperationalOnboardingCompletedV1 | null;
}

export interface BaseBusinessContextCompletedV1 {
    eventType: "BaseBusinessContextCompletedV1";
    version: 1;
    projectId: string;
    completedAt: string;
    context: ContextFieldV1[];
    internalData: InternalBusinessDataV1;
    sources: OnboardingBreSourceV1[];
}

export interface CreateBreProjectV1 {
    name: string;
    assignedUserIds: string[];
}

export interface SaveBreSourcesV1 {
    projectId: string;
    sources: Array<Pick<OnboardingBreSourceV1, "type" | "url">>;
}

export interface SaveContextAnswerV1 {
    projectId: string;
    fieldKey: DynamicContextFieldKey;
    value: unknown;
    action: "confirm" | "correct";
}

export interface SaveOperationalObjectiveV1 {
    projectId: string;
    objective: BreOperationalObjective;
    calendarEmail?: string | null;
    locationTerm?: string | null;
}

export interface SaveBreLocationsV1 {
    projectId: string;
    locationTerm: string;
    locations: Array<Omit<BreLocationV1, "references"> & { references?: BreLocationReferenceV1[] }>;
}

export interface SaveBreAgendaConfigV1 {
    projectId: string;
    agenda: BreAgendaConfigV1;
}

export interface SaveBreLeadCaptureFieldsV1 {
    projectId: string;
    fields: BreLeadCaptureFieldV1[];
}

export interface SaveBreStylePreferenceV1 {
    projectId: string;
    stylePreference: BreStylePreferenceV1;
}
