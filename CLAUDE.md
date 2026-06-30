# SimpliaLeads — Contexto para Claude Code

## Propósito del Proyecto

**SimpliaLeads Dashboard** es un sistema de control comercial construido sobre **Chatwoot** (CRM conversacional) y **Supabase** (backend). Es una SPA (Single Page Application) para equipos de ventas y operaciones que permite:

- Monitorear estado y conversión de leads
- Optimizar el embudo de ventas y detectar cuellos de botella
- Gestionar scoring y priorización de leads
- Ejecutar seguimientos manuales y automatización de flujos
- Generar reportes automáticos y exportaciones
- Controlar eficiencia operacional (velocidad, SLA, backlog)

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18.3 + TypeScript 5.8, Vite 5.4 |
| UI | shadcn/ui (Radix UI + Tailwind CSS 3.4) |
| Estado | TanStack Query (React Query 5.83) |
| Gráficos | Recharts 2.15 |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| API externa | Chatwoot REST API |
| Exportaciones | xlsx (Excel), Papa Parse (CSV) |
| AI | OpenAI GPT-4 vía Edge Functions de Supabase |
| Worker Python | FastAPI (servicio separado para scraping BRE) |
| Testing | Node.js test runner (archivos `.mjs`) |
| Deploy | Vercel (SPA) |

---

## Estructura de Carpetas

```
simpliaLeads/
├── src/
│   ├── app/              # Providers globales y router principal (AppProviders, AppRouter)
│   ├── domain/           # Reglas de negocio puras (sin React, sin Supabase)
│   │   ├── auth/         # RBAC: roles, permisos, funciones de acceso
│   │   ├── lead/         # Tipos de lead, etapas, scoring, canales
│   │   ├── conversation/ # Tipos de conversación, eventos de labels
│   │   ├── dashboard/    # KPIs, métricas, config de tags
│   │   ├── report/       # Tipos de reportes
│   │   └── common/       # Utilidades compartidas (UnknownRecord, etc.)
│   ├── application/      # Puertos/interfaces de casos de uso
│   ├── features/         # Módulos de producto (Feature-Sliced Design)
│   │   ├── dashboard/    # Vista ejecutiva, embudo, eficiencia, tendencias
│   │   ├── followup/     # Cola de acción de leads (seguimiento manual)
│   │   ├── scoring/      # Scoring de leads (hot/warm/cold)
│   │   ├── reporting/    # Exportaciones y reportes programados
│   │   ├── conversations/# Vista y sincronización de conversaciones Chatwoot
│   │   ├── import/       # Importación masiva de leads desde Excel
│   │   ├── meta-ads/     # Insights de campañas Meta + CAPI
│   │   └── onboarding-bre/ # Enriquecimiento de registro de negocios (scraping)
│   ├── infrastructure/   # Adaptadores: clientes API, mappers, repositorios
│   │   ├── chatwoot/     # ChatwootClient (axios), ChatwootRepository
│   │   ├── conversation/ # ConversationMapper, HybridConversationRepository
│   │   ├── supabase/     # Clientes para dashboard, sync, Meta, label events
│   │   ├── storage/      # IndexedDB (caché local de conversaciones)
│   │   └── report/       # Exportadores Excel/CSV, AiReportClient
│   ├── context/          # React contexts: AuthContext, DashboardDataContext
│   ├── services/         # Servicios de acceso a datos
│   ├── shared/           # Utilidades transversales (sin lógica de negocio)
│   │   └── ui/           # Componentes UI compartidos (KPICard, DateRangePicker)
│   ├── components/       # Layout shell, DashboardLayout, wrappers de shadcn
│   └── pages/            # Login, NotFound
├── supabase/
│   ├── migrations/       # 19 archivos SQL (2026-04-21 a 2026-06-24)
│   └── functions/        # 8 Edge Functions TypeScript
│       ├── chatwoot-sync/
│       ├── chatwoot-label-webhook/
│       ├── chatwoot-repair-conversations/
│       ├── send-scheduled-reports/
│       ├── generate-ai-report/
│       ├── meta-campaign-insights/
│       ├── meta-capi/
│       └── onboarding-bre-api/
├── workers/
│   └── onboarding-bre/   # Servicio Python FastAPI (scraping BRE)
│       ├── main.py       # Entry point, polling de trabajos Supabase
│       ├── site_spider.py
│       ├── normalizer.py  # Normalización con OpenAI
│       ├── social.py      # Extracción de redes sociales
│       └── security.py   # Validación JWT + secret token
└── tests/
    ├── domain/           # Tests de reglas de negocio
    ├── application/      # Tests de view models / casos de uso
    ├── infrastructure/   # Tests de mappers
    └── features/         # Tests de modelos de features
```

---

## Arquitectura: Feature-Sliced Design + Clean Architecture

**Regla de dependencias:** el flujo siempre va hacia abajo. `features/` puede usar `domain/`, `application/`, `infrastructure/`, `shared/`, pero nunca al revés.

```
features/ → application/ → domain/
                         → infrastructure/
                         → shared/
```

- **Sin lógica de negocio en componentes.** Los hooks manejan estado, los componentes renderizan view models.
- **Sin `any`** en código nuevo. Usar `unknown` + `UnknownRecord` para payloads externos.
- **Imports:** usar alias `@/` (configurado en tsconfig + vite).

---

## RBAC (Control de Acceso por Rol)

Definido en `src/domain/auth/permissions.ts`:

| Rol | Acceso | Tab por defecto | Tabs visibles |
|-----|--------|----------------|---------------|
| `platform_admin` | Admin total | overview | Todos (9 tabs) |
| `company_admin` | Admin de empresa | overview | Todos (9 tabs) |
| `operator` | Solo ventas | followup | followup, performance, reporting |

- Roles almacenados en `public.user_profiles` (Supabase)
- Sin auth → rol `operator` por defecto

---

## Módulos Principales

### Features

| Módulo | Tab | Propósito |
|--------|-----|-----------|
| `dashboard/` | overview, funnel, operational, performance, trends | Analítica ejecutiva y operacional |
| `followup/` | followup | Cola de acción manual de leads |
| `scoring/` | scoring | Clasificación hot/warm/cold |
| `reporting/` | reporting | Exportaciones y reportes programados |
| `conversations/` | conversations | Vista y sync de conversaciones |
| `import/` | import | Importación masiva desde Excel |
| `meta-ads/` | campaigns | Insights de campañas Meta |
| `onboarding-bre/` | — | Enriquecimiento de datos de negocios |

### Dominio de Leads

- **LeadStage**: `"sale" | "appointment" | "unqualified" | "followup" | "sql" | "other"`
- **ScoreBucket**: `"hot" | "warm" | "cold"` (umbrales configurables)
- Función clave: `resolveLeadStage()` determina la etapa desde labels y config de tags

### Base de Datos (tablas principales)

| Tabla | Propósito |
|-------|-----------|
| `cw.conversation_label_events` | Historial de cambios de labels |
| `public.chatwoot_snapshots` | Copia comprimida del estado de conversaciones |
| `public.reporting_exports` | Definiciones de reportes programados |
| `public.meta_ads_insights_cache` | Caché de métricas de campañas Meta |
| `public.meta_capi_config_events` | Credenciales Meta CAPI |
| `public.onboarding_bre_base_context` | Metadata de proyectos BRE |
| `public.user_profiles` | Roles y empresa por usuario |
| `public.lead_field_capture_timing` | Timing de captura de campos de leads |

---

## Cómo Ejecutar Localmente

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con credenciales de Supabase y Chatwoot

# 3. Servidor de desarrollo
npm run dev
# Disponible en http://localhost:8080 (puerto configurado en vite.config.ts)
```

### Scripts disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor de desarrollo con hot-reload |
| `npm run build` | Build de producción en `/dist` |
| `npm run preview` | Preview del build de producción |
| `npm run typecheck` | Chequeo de tipos TypeScript |
| `npm run lint` | Validación ESLint |
| `npm run test:unit` | Todos los tests |
| `npm run check` | typecheck + tests + build (CI completo) |

---

## Variables de Entorno

```env
# Supabase
VITE_SUPABASE_URL=https://XXX.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Chatwoot
VITE_CHATWOOT_BASE_URL=https://chatwoot.example.com
VITE_CHATWOOT_API_TOKEN=...

# Secretos de Edge Functions (configurar via Supabase CLI, NO en frontend):
# supabase secrets set OPENAI_API_KEY=sk-...
# supabase secrets set META_AD_ACCOUNT_ID=...
# supabase secrets set META_SYSTEM_USER_TOKEN=...
```

El proxy de Chatwoot en dev está configurado en `vite.config.ts` en `/chatwoot-api/`.

---

## Worker Python (BRE)

Servicio FastAPI separado en `workers/onboarding-bre/`:

```bash
cd workers/onboarding-bre
pip install -r requirements.txt
# o con Docker:
docker build -t bre-worker .
docker run --env-file .env bre-worker
```

**Variables de entorno adicionales para el worker:**
```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
OPENAI_API_KEY=...
BRE_NORMALIZATION_MODEL=gpt-4o-mini
YOUTUBE_API_KEY=...       # Opcional
BRE_WORKER_SECRET=...     # Autenticación del worker
```

---

## Convenciones de Código

- **Idioma del código:** Inglés (identificadores, comentarios, nombres de funciones)
- **Texto de UI:** Español (etiquetas, KPIs, mensajes al usuario)
- **Tipos:** No usar `any` en código nuevo. Usar `unknown` + `UnknownRecord` para payloads externos
- **Arquitectura:** Sin lógica de negocio en componentes React. Los hooks manejan estado
- **TypeScript config:** `strict: false` (modo de migración gradual), `noImplicitAny: false`
- **Imports:** Siempre usar alias `@/` en lugar de rutas relativas largas

---

## Archivos Clave de Referencia

| Propósito | Archivo |
|-----------|---------|
| Configuración de la app | `src/config.ts` |
| Router principal | `src/app/AppRouter.tsx` |
| Providers globales | `src/app/AppProviders.tsx` |
| Permisos RBAC | `src/domain/auth/permissions.ts` |
| Tipos de lead | `src/domain/lead/types.ts` |
| Config de Vite | `vite.config.ts` |
| Cliente Chatwoot | `src/infrastructure/chatwoot/ChatwootClient.ts` |
| Contexto de datos | `src/context/DashboardDataContext.tsx` |
| Layout principal | `src/components/DashboardLayout.tsx` |
| Edge Function sync | `supabase/functions/chatwoot-sync/index.ts` |

---

## Historial de Commits Reciente

- `onboarding bre and conversations dashboard` — Módulo BRE y vista de conversaciones
- `fix BRE normalization and optional sources` — Correcciones en normalización BRE
- `fix BRE source retry state` — Estado de reintentos BRE
- `fix BRE scraping for JavaScript sites` — Scraping en sitios JavaScript
- `fix production edge function authentication` — Auth en Edge Functions
- `feature of BRE part1` — Primera parte del módulo BRE
- `updated metrics to page Operation` — Métricas en pestaña Operacional
- `pagination real en Seguimiento, Calidad y Conversaciones` — Paginación real
- `feature Meta CAPI` — Integración Meta Conversions API
- `new feature campaigns/insights` — Insights de campañas Meta
