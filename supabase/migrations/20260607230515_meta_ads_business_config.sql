-- ========================================================================
-- Meta Ads configurable por negocio
-- Guarda cuenta publicitaria y token server-side para que el frontend nunca
-- reciba el Bearer Token completo.
-- ========================================================================

create schema if not exists cw;
create extension if not exists pgcrypto with schema extensions;

create table if not exists cw.meta_ads_configs (
    id uuid primary key default gen_random_uuid(),
    account_id bigint not null default 0,
    ad_account_id text not null,
    access_token text not null,
    token_last_four text not null default '',
    graph_api_version text not null default 'v20.0',
    enabled boolean not null default true,
    configured_by uuid,
    configured_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (account_id)
);

create index if not exists meta_ads_configs_account_enabled_idx
    on cw.meta_ads_configs (account_id, enabled);

create or replace function cw.touch_meta_ads_configs_updated_at()
returns trigger
language plpgsql
set search_path = cw, pg_catalog
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_meta_ads_configs_updated_at on cw.meta_ads_configs;
create trigger trg_meta_ads_configs_updated_at
    before update on cw.meta_ads_configs
    for each row
    execute function cw.touch_meta_ads_configs_updated_at();

alter table cw.meta_ads_configs enable row level security;

revoke all on cw.meta_ads_configs from anon, authenticated;

grant usage on schema cw to service_role;
grant select, insert, update, delete on cw.meta_ads_configs to service_role;
