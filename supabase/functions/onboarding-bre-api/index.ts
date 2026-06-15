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
        const workerActions = new Set(["claim_worker_job", "register_discovered_sources", "update_worker_progress", "complete_worker_job", "fail_worker_job"]);

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
                await bre.from("sources").update({
                    status,
                    pages_processed: Number(sourceResult.pagesProcessed || 0),
                    error_code: sourceResult.errorCode || null,
                    error_message: sourceResult.errorMessage || null,
                    last_scraped_at: new Date().toISOString(),
                }).eq("id", sourceResult.sourceId).eq("project_id", projectId);
                await bre.from("scrape_source_runs").update({
                    status,
                    pages_processed: Number(sourceResult.pagesProcessed || 0),
                    error_code: sourceResult.errorCode || null,
                    error_message: sourceResult.errorMessage || null,
                    finished_at: new Date().toISOString(),
                }).eq("run_id", runId).eq("source_id", sourceResult.sourceId);
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
                await bre.from("source_documents").upsert({
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
                }, { onConflict: "run_id,source_id,content_hash" });
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
                    if (rows.length) await bre.from("field_evidence").upsert(rows, {
                        onConflict: "context_field_id,url,content_hash",
                        ignoreDuplicates: true,
                    });
                }
            }

            const websiteResult = sourceResults.find((item: any) => item.sourceType === "website");
            const websiteSucceeded = websiteResult?.status === "completed";
            const completedCount = sourceResults.filter((item: any) => item.status === "completed").length;
            const runStatus = websiteSucceeded
                ? completedCount === sourceResults.length ? "completed" : "partial"
                : "failed";
            await bre.from("scrape_runs").update({
                status: runStatus,
                pages_processed: sourceResults.reduce((sum: number, item: any) => sum + Number(item.pagesProcessed || 0), 0),
                sources_completed: completedCount,
                error_summary: sourceResults.filter((item: any) => item.errorCode).map((item: any) => ({
                    sourceId: item.sourceId,
                    code: item.errorCode,
                    message: item.errorMessage,
                })),
                finished_at: new Date().toISOString(),
            }).eq("id", runId).eq("project_id", projectId);
            await bre.from("projects").update({
                status: websiteSucceeded ? "review_context" : "sources_ready",
                current_step: websiteSucceeded ? "context" : "processing",
            }).eq("id", projectId);
            await bre.from("ai_runs").insert({
                project_id: projectId,
                scrape_run_id: runId,
                purpose: "normalize_context",
                model: body.aiModel || Deno.env.get("BRE_NORMALIZATION_MODEL") || "gpt-5.4",
                status: body.aiError ? "failed" : "completed",
                input_hash: body.aiInputHash || null,
                output_payload: { fieldCount: fields.length },
                error_message: body.aiError || null,
                completed_at: new Date().toISOString(),
            });
            if (body.messageId) await admin.rpc("bre_archive_scrape_job", { message_id: body.messageId });
            await bre.from("audit_logs").insert({
                project_id: projectId,
                actor_type: "worker",
                action: "scrape_completed",
                entity_type: "scrape_run",
                entity_id: runId,
                payload: { runStatus, sourceCount: sourceResults.length, fieldCount: fields.length },
            });
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
                        errorCode: row.error_code,
                        errorMessage: row.error_message,
                    })),
                } : null,
                contextFields,
                dynamicQuestions: dynamicQuestionRequirements(contextFields),
                internalData: internalAnswer?.value || null,
                completionEvent: project.completion_payload || null,
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
            assert(project.status !== "base_context_complete", "El contexto base ya fue finalizado.");
            const sources = Array.isArray(body.sources) ? body.sources : [];
            const normalized = sources.map((source: any) => ({
                type: sourceTypes.has(source.type) ? source.type : "other",
                url: normalizePublicUrl(source.url),
            }));
            const unique = Array.from(new Map(normalized.map((source: any) => [source.url, source])).values());
            assert(unique.filter((source: any) => source.type === "website").length === 1, "Debes ingresar exactamente un sitio web oficial.");
            const { data: activeRun } = await bre.from("scrape_runs").select("id").eq("project_id", project.id).in("status", ["queued", "processing"]).maybeSingle();
            assert(!activeRun, "No puedes cambiar fuentes mientras existe un procesamiento activo.", 409);
            await bre.from("sources").delete().eq("project_id", project.id).eq("source_origin", "user");
            const { error } = await bre.from("sources").insert(unique.map((source: any) => ({
                project_id: project.id,
                source_type: source.type,
                url: source.url,
                normalized_url: source.url,
                source_origin: "user",
                status: "pending",
            })));
            if (error) throw error;
            await bre.from("projects").update({ status: "sources_ready", current_step: "sources" }).eq("id", project.id);
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "start_scrape" || action === "retry_source") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(project.status !== "base_context_complete", "El contexto base ya fue finalizado.");
            const { data: allSources, error: sourceError } = await bre.from("sources").select("*").eq("project_id", project.id);
            if (sourceError) throw sourceError;
            const website = (allSources || []).find((source: any) => source.source_type === "website");
            assert(website, "Debes guardar el sitio web oficial antes de procesar.");
            const retrySourceId = action === "retry_source" ? String(body.sourceId || "") : null;
            const selectedSources = retrySourceId ? (allSources || []).filter((source: any) => source.id === retrySourceId) : (allSources || []);
            assert(selectedSources.length > 0, "La fuente seleccionada no existe.");
            if (retrySourceId && selectedSources[0].source_type !== "website") {
                assert(website.status === "completed", "El sitio web debe completarse antes de reintentar una red social.");
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
                status: "queued",
            })));
            await bre.from("sources").update({ status: "queued", error_code: null, error_message: null }).in("id", selectedSources.map((source: any) => source.id));
            await bre.from("projects").update({ status: "scraping", current_step: "processing" }).eq("id", project.id);
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
            assert(project.status !== "base_context_complete", "El contexto base ya fue finalizado.");
            const fieldKey = String(body.fieldKey || "");
            assert(dynamicFieldKeys.has(fieldKey), "El campo no pertenece a las preguntas permitidas.");
            assert(body.value !== undefined && body.value !== null && String(body.value).trim() !== "", "La respuesta es obligatoria.");
            const actionType = body.answerAction === "confirm" ? "confirm" : "correct";
            const { data: existing, error: existingError } = await bre.from("context_fields").select("id,value").eq("project_id", project.id).eq("field_key", fieldKey).single();
            if (existingError) throw existingError;
            await validateManualAnswer(admin, bre, project.id, fieldKey, body.value, existing.value);
            const sameValue = JSON.stringify(existing.value) === JSON.stringify(body.value);
            const status = actionType === "confirm" && sameValue ? "confirmed" : "corrected";
            await bre.from("context_fields").update({
                value: body.value,
                origin: "user",
                confidence: "high",
                status,
                contradiction: false,
                updated_by: user.id,
            }).eq("id", existing.id);
            await bre.from("section_answers").upsert({
                project_id: project.id,
                section_key: "context_gaps",
                field_key: fieldKey,
                value: body.value,
                answer_status: "validated",
                answered_by: user.id,
            }, { onConflict: "project_id,section_key,field_key" });
            await bre.from("projects").update({ status: "collecting_answers", current_step: "gaps" }).eq("id", project.id);
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_context_field") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(project.status !== "base_context_complete", "El contexto base ya fue finalizado.");
            const fieldKey = String(body.fieldKey || "");
            const { data: existing, error: existingError } = await bre.from("context_fields")
                .select("id,value").eq("project_id", project.id).eq("field_key", fieldKey).single();
            if (existingError) throw existingError;
            assert(body.value !== undefined && body.value !== null && String(body.value).trim() !== "", "El valor es obligatorio.");
            await validateManualAnswer(admin, bre, project.id, fieldKey, body.value, existing.value);
            await bre.from("context_fields").update({
                value: body.value,
                origin: "user",
                confidence: "high",
                status: "corrected",
                contradiction: false,
                updated_by: user.id,
            }).eq("id", existing.id);
            await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "context_field_corrected",
                entity_type: "context_field",
                entity_id: existing.id,
                payload: { fieldKey },
            });
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "save_internal_data") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            assert(project.status !== "base_context_complete", "El contexto base ya fue finalizado.");
            validateInternalData(body.data);
            await bre.from("section_answers").upsert({
                project_id: project.id,
                section_key: "internal_data",
                field_key: "payload",
                value: body.data,
                answer_status: "validated",
                answered_by: user.id,
            }, { onConflict: "project_id,section_key,field_key" });
            await bre.from("projects").update({ status: "collecting_answers", current_step: "internal" }).eq("id", project.id);
            return json({ project: await getProjectDto(project.id) });
        }

        if (action === "finalize_base_context") {
            const project = await assertProjectAccess(String(body.projectId || ""));
            if (project.status === "base_context_complete") return json({ project: await getProjectDto(project.id), idempotent: true });
            const { data: website } = await bre.from("sources").select("status").eq("project_id", project.id).eq("source_type", "website").single();
            assert(website?.status === "completed", "El sitio web debe finalizar correctamente.");
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
            const { data: sources } = await bre.from("sources").select("*").eq("project_id", project.id);
            const completedAt = new Date().toISOString();
            const completionPayload = {
                eventType: "BaseBusinessContextCompletedV1",
                version: 1,
                projectId: project.id,
                completedAt,
                context: fields,
                internalData: internalAnswer.value,
                sources,
            };
            await bre.from("projects").update({
                status: "base_context_complete",
                current_step: "complete",
                completion_payload: completionPayload,
                completed_at: completedAt,
            }).eq("id", project.id);
            await bre.from("audit_logs").insert({
                project_id: project.id,
                actor_id: user.id,
                actor_type: "user",
                action: "base_context_completed",
                entity_type: "project",
                entity_id: project.id,
                payload: { eventType: completionPayload.eventType, version: 1 },
            });
            return json({ project: await getProjectDto(project.id) });
        }

        throw Object.assign(new Error("Acción no soportada."), { status: 404 });
    } catch (error) {
        const status = Number((error as any)?.status || 400);
        return json({ success: false, error: errorMessage(error) }, status);
    }
});
