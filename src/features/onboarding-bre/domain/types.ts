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
    | "base_context_complete";

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

