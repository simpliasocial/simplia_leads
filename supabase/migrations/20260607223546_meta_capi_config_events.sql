-- ========================================================================
-- Meta CAPI para citas y ventas
-- Guarda configuracion server-side, audita intentos y evita exponer tokens
-- o PII sin hash desde el dashboard.
-- ========================================================================

create schema if not exists cw;
create extension if not exists pgcrypto with schema extensions;

create table if not exists cw.meta_capi_configs (
    id uuid primary key default gen_random_uuid(),
    account_id bigint not null default 0,
    graph_version text not null default 'v20.0',
    dataset_id text not null,
    access_token text not null,
    token_last_four text not null default '',
    event_source_url text not null,
    event_name text not null default 'Schedule',
    source text not null default 'chatwoot',
    system_name text not null default 'Simplia Leads',
    appointment_status text not null default 'scheduled',
    action_source text not null default 'website',
    default_channel text not null default 'whatsapp',
    client_user_agent text not null default 'Mozilla/5.0',
    test_event_code text not null default '',
    enabled boolean not null default true,
    configured_by uuid,
    configured_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (account_id)
);

create index if not exists meta_capi_configs_account_enabled_idx
    on cw.meta_capi_configs (account_id, enabled);

create table if not exists cw.meta_capi_events (
    id uuid primary key default gen_random_uuid(),
    account_id bigint not null default 0,
    event_kind text not null default 'appointment'
        check (event_kind in ('appointment', 'sale', 'test')),
    conversation_id text,
    meeting_id text,
    event_name text,
    event_id text,
    status text not null default 'pending'
        check (status in ('pending', 'success', 'error', 'skipped')),
    test_mode boolean not null default false,
    request_payload jsonb not null default '{}'::jsonb,
    response_payload jsonb not null default '{}'::jsonb,
    error_message text,
    sent_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists meta_capi_events_account_created_idx
    on cw.meta_capi_events (account_id, created_at desc);

create index if not exists meta_capi_events_conversation_idx
    on cw.meta_capi_events (conversation_id, created_at desc);

create index if not exists meta_capi_events_status_idx
    on cw.meta_capi_events (status, created_at desc);

create or replace function cw.touch_meta_capi_configs_updated_at()
returns trigger
language plpgsql
set search_path = cw, pg_catalog
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_meta_capi_configs_updated_at on cw.meta_capi_configs;
create trigger trg_meta_capi_configs_updated_at
    before update on cw.meta_capi_configs
    for each row
    execute function cw.touch_meta_capi_configs_updated_at();

alter table cw.meta_capi_configs enable row level security;
alter table cw.meta_capi_events enable row level security;

revoke all on cw.meta_capi_configs from anon, authenticated;
revoke all on cw.meta_capi_events from anon, authenticated;

grant usage on schema cw to service_role;
grant select, insert, update, delete on cw.meta_capi_configs to service_role;
grant select, insert, update, delete on cw.meta_capi_events to service_role;
