# onboarding-bre-api

API exclusiva del bounded context `onboarding-bre`. El navegador entra con JWT de Supabase y el worker con `x-bre-worker-secret`; por eso debe desplegarse con validación JWT del gateway desactivada y mantener la validación interna de `index.ts`.

```bash
supabase functions deploy onboarding-bre-api --no-verify-jwt
```

## Secretos

- `BRE_WORKER_SECRET`
- `OPENAI_API_KEY`
- `BRE_NORMALIZATION_MODEL` (por defecto `gpt-5.4`)
- `BRE_VALIDATION_MODEL` (por defecto `gpt-5.4-mini`)

El esquema `bre` debe incluirse en los esquemas expuestos por la Data API del proyecto para que la función pueda usar `supabase-js` con service role. No se conceden permisos a `anon` ni `authenticated`; todas las tablas tienen RLS y solo la función opera con `service_role`.
