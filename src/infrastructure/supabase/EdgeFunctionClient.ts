import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type FunctionErrorPayload = {
    error?: unknown;
    message?: unknown;
    details?: unknown;
};

type FunctionErrorWithContext = Error & {
    context?: Response;
};

const SESSION_REFRESH_MARGIN_SECONDS = 60;

const payloadMessage = (payload: FunctionErrorPayload | null) => {
    const value = payload?.error || payload?.message || payload?.details;
    if (!value) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const readFunctionError = async (error: unknown, functionName: string) => {
    const typedError = error as FunctionErrorWithContext;
    const response = typedError?.context;
    let payload: FunctionErrorPayload | null = null;
    let status: number | undefined;

    if (response && typeof response.clone === "function") {
        status = response.status;
        try {
            const text = await response.clone().text();
            payload = text ? JSON.parse(text) as FunctionErrorPayload : null;
        } catch {
            payload = null;
        }
    }

    const message = payloadMessage(payload) || typedError?.message || `No se pudo ejecutar ${functionName}.`;
    return { message, status };
};

export const getValidAccessToken = async (
    client: SupabaseClient = supabase,
    forceRefresh = false,
) => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    let session = data.session;
    const expiresSoon = !session?.expires_at || session.expires_at <= Math.floor(Date.now() / 1000) + SESSION_REFRESH_MARGIN_SECONDS;

    if (forceRefresh || expiresSoon) {
        const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
        if (!refreshError && refreshed.session) session = refreshed.session;
        else if (!session || forceRefresh) {
            await client.auth.signOut().catch(() => undefined);
            throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
        }
    }

    if (!session?.access_token) {
        throw new Error("No existe una sesion activa. Inicia sesion nuevamente.");
    }

    return session.access_token;
};

export const invokeAuthenticatedFunction = async <T>(
    functionName: string,
    body: Record<string, unknown>,
    client: SupabaseClient = supabase,
): Promise<T> => {
    const invoke = async (forceRefresh: boolean) => {
        const accessToken = await getValidAccessToken(client, forceRefresh);
        return client.functions.invoke<T>(functionName, {
            body,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
    };

    let result = await invoke(false);
    if (result.error) {
        const firstError = await readFunctionError(result.error, functionName);
        if (firstError.status !== 401) throw new Error(firstError.message);

        result = await invoke(true);
        if (result.error) {
            const retryError = await readFunctionError(result.error, functionName);
            if (retryError.status === 401) {
                await client.auth.signOut().catch(() => undefined);
                throw new Error("La sesion de produccion ya no es valida. Inicia sesion nuevamente.");
            }
            throw new Error(retryError.message);
        }
    }

    return result.data as T;
};
