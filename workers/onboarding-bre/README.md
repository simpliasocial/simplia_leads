# Onboarding BRE Worker

Worker independiente que consume `bre_scrape_jobs`, extrae contenido público y devuelve documentos, evidencias y contexto normalizado a `onboarding-bre-api`.

## Variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `BRE_WORKER_SECRET`
- `OPENAI_API_KEY`
- `BRE_NORMALIZATION_MODEL` (por defecto `gpt-5.4`)
- `BRE_VALIDATION_MODEL` (reservado para validación manual, por defecto `gpt-5.4-mini`)
- `YOUTUBE_API_KEY` (opcional, cuota gratuita)
- `BRE_POLL_SECONDS` (por defecto `5`)

## Ejecución

```bash
docker build -t simplia/onboarding-bre-worker .
docker run --rm --env-file .env simplia/onboarding-bre-worker
```

La función Edge debe desplegarse sin verificación JWT del gateway porque autentica internamente dos tipos de llamada: JWT de usuario y `x-bre-worker-secret` para el worker.

```bash
supabase functions deploy onboarding-bre-api --no-verify-jwt
```

No usa proxies pagados, cuentas personales ni resolución de CAPTCHA. Facebook, LinkedIn, TikTok e Instagram pueden devolver `platform_blocked`; ese resultado se conserva y no se sustituye por información inventada.
