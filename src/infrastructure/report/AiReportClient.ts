import { config } from "@/config";
import { supabase } from "@/lib/supabase";
import { getValidAccessToken } from "@/infrastructure/supabase/EdgeFunctionClient";
import type { CriticalProfileKey, ReportFileFormat } from "@/domain/report";

export type AiReportDownloadResponse = {
    ok?: boolean;
    error?: string;
    details?: unknown;
    jobId?: string;
    status?: "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete";
    responseId?: string;
    rangeLabel?: string;
    pollAfterMs?: number;
    filename?: string;
    mimeType?: string;
    contentBase64?: string;
};

export type AiReportAction = "start" | "status" | "download";

export type AiReportFunctionPayload = {
    action: AiReportAction;
    profileKey: CriticalProfileKey;
    formatId: ReportFileFormat;
    responseId?: string;
    rangeLabel?: string;
    companyContext?: string;
    filters?: {
        startDate?: string;
        endDate?: string;
        selectedInboxes?: number[];
    };
};

const stringifyAiDetail = (value: unknown): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

export const readableAiReportError = (body: AiReportDownloadResponse | null, fallback: string) => {
    const detail = stringifyAiDetail(body?.details);
    if (body?.error && body.error !== "[object Object]") return body.error;
    if (detail.includes("max_output_tokens")) {
        return "OpenAI cortó la respuesta por límite de salida; el reporte se reducirá o se debe reintentar con menor rango.";
    }
    return detail || fallback;
};

export const invokeAiReportFunction = async (payload: AiReportFunctionPayload): Promise<AiReportDownloadResponse> => {
    const request = async (forceRefresh: boolean) => {
        const token = await getValidAccessToken(supabase, forceRefresh);
        return fetch(`${config.supabase.url}/functions/v1/generate-ai-report`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: config.supabase.anonKey,
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
    };

    let response = await request(false);
    if (response.status === 401) response = await request(true);

    const text = await response.text();
    let body: AiReportDownloadResponse | null = null;
    try {
        body = text ? JSON.parse(text) as AiReportDownloadResponse : null;
    } catch {
        body = null;
    }

    if (!response.ok) {
        throw new Error(readableAiReportError(body, `Edge Function ${response.status}: ${text || "sin detalle"}`));
    }
    if (body?.ok === false || body?.error) {
        throw new Error(readableAiReportError(body, "No se pudo generar el reporte."));
    }
    if (!body) throw new Error("El servicio de reportes no devolvió una respuesta válida.");
    return body;
};

export const downloadBase64File = (params: { filename: string; mimeType: string; contentBase64: string }) => {
    const binary = atob(params.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    const blob = new Blob([bytes], { type: params.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = params.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
