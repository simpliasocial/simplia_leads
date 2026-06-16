import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type {
    CreateBreProjectV1,
    InternalBusinessDataV1,
    OnboardingBreProjectSummaryV1,
    OnboardingBreProjectV1,
    SaveBreSourcesV1,
    SaveContextAnswerV1,
} from "../domain/types";
import { buildDynamicQuestions } from "../model/onboardingBreModel";
import { invokeAuthenticatedFunction } from "@/infrastructure/supabase/EdgeFunctionClient";

type ApiResponse<T> = T & { error?: string; success?: boolean };

export class OnboardingBreApiClient {
    constructor(private readonly client: SupabaseClient = supabase) {}

    private async invoke<T>(body: Record<string, unknown>): Promise<T> {
        const data = await invokeAuthenticatedFunction<ApiResponse<T>>("onboarding-bre-api", body, this.client);
        if (data?.error) throw new Error(data.error);
        return data as T;
    }

    async listProjects() {
        return this.invoke<{ projects: OnboardingBreProjectSummaryV1[] }>({ action: "list_projects" });
    }

    async listCompanyAdmins() {
        return this.invoke<{ users: Array<{ id: string; email: string | null }> }>({ action: "list_company_admins" });
    }

    async createProject(input: CreateBreProjectV1) {
        return this.invoke<{ projectId: string }>({ action: "create_project", ...input });
    }

    async getProject(projectId: string): Promise<OnboardingBreProjectV1> {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({ action: "get_project", projectId });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }

    async getDynamicQuestions(projectId: string) {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({ action: "get_project", projectId });
        return buildDynamicQuestions(project.contextFields);
    }

    async saveSources(input: SaveBreSourcesV1) {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({ action: "save_sources", ...input });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }

    startScrape(projectId: string, idempotencyKey: string) {
        return this.invoke<{ runId: string }>({ action: "start_scrape", projectId, idempotencyKey });
    }

    retrySource(projectId: string, sourceId: string, idempotencyKey: string) {
        return this.invoke<{ runId: string }>({ action: "retry_source", projectId, sourceId, idempotencyKey });
    }

    async saveContextAnswer(input: SaveContextAnswerV1) {
        const { action: answerAction, ...payload } = input;
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({
            ...payload,
            action: "save_context_answer",
            answerAction,
        });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }

    async saveContextField(projectId: string, fieldKey: string, value: unknown) {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({
            action: "save_context_field",
            projectId,
            fieldKey,
            value,
        });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }

    async saveInternalData(projectId: string, data: InternalBusinessDataV1) {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({
            action: "save_internal_data",
            projectId,
            data,
        });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }

    async finalizeBaseContext(projectId: string) {
        const { project } = await this.invoke<{ project: OnboardingBreProjectV1 }>({
            action: "finalize_base_context",
            projectId,
        });
        return { ...project, dynamicQuestions: buildDynamicQuestions(project.contextFields) };
    }
}

export const onboardingBreApiClient = new OnboardingBreApiClient();
