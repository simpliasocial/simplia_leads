create extension if not exists pgcrypto;
create extension if not exists pgmq;

create schema if not exists bre;
revoke all on schema bre from public, anon, authenticated;
grant usage on schema bre to service_role;
grant usage on schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;
grant select, insert, update, delete on all tables in schema pgmq to service_role;

create or replace function bre.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create table bre.projects (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 2 and 160),
    status text not null default 'draft' check (status in (
        'draft', 'sources_ready', 'scraping', 'review_context',
        'collecting_answers', 'base_context_complete'
    )),
    current_step text not null default 'sources',
    created_by uuid not null references auth.users(id),
    completion_payload jsonb,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table bre.project_members (
    project_id uuid not null references bre.projects(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    member_role text not null check (member_role in ('owner', 'assignee')),
    created_at timestamptz not null default now(),
    primary key (project_id, user_id)
);

create table bre.sources (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    source_type text not null check (source_type in (
        'website', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'other'
    )),
    url text not null,
    normalized_url text not null,
    source_origin text not null default 'user' check (source_origin in ('user', 'discovered')),
    status text not null default 'pending' check (status in (
        'pending', 'queued', 'processing', 'completed', 'partial',
        'platform_blocked', 'failed'
    )),
    pages_processed integer not null default 0 check (pages_processed >= 0),
    error_code text,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    last_scraped_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, normalized_url)
);

create unique index bre_one_website_per_project
    on bre.sources(project_id)
    where source_type = 'website';

create table bre.scrape_runs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    status text not null default 'queued' check (status in (
        'queued', 'processing', 'completed', 'partial', 'failed'
    )),
    idempotency_key text not null,
    pages_processed integer not null default 0,
    sources_total integer not null default 0,
    sources_completed integer not null default 0,
    error_summary jsonb not null default '[]'::jsonb,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, idempotency_key)
);

create table bre.scrape_source_runs (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references bre.scrape_runs(id) on delete cascade,
    source_id uuid not null references bre.sources(id) on delete cascade,
    status text not null default 'queued' check (status in (
        'queued', 'processing', 'completed', 'partial', 'platform_blocked', 'failed'
    )),
    pages_processed integer not null default 0,
    attempt integer not null default 1,
    error_code text,
    error_message text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (run_id, source_id, attempt)
);

create table bre.source_documents (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    run_id uuid not null references bre.scrape_runs(id) on delete cascade,
    source_id uuid not null references bre.sources(id) on delete cascade,
    url text not null,
    title text,
    extracted_text text,
    content_hash text not null,
    storage_path text,
    metadata jsonb not null default '{}'::jsonb,
    captured_at timestamptz not null,
    raw_expires_at timestamptz not null default (now() + interval '30 days'),
    created_at timestamptz not null default now(),
    unique (run_id, source_id, content_hash)
);

create table bre.context_fields (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    field_key text not null,
    category text not null check (category in (
        'identity', 'classification', 'offer', 'icp', 'communication',
        'faqs', 'locations', 'hours', 'contacts', 'marketing', 'legal'
    )),
    value jsonb,
    origin text not null check (origin in ('extracted', 'inferred', 'user')),
    confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
    status text not null check (status in (
        'extracted', 'inferred', 'not_found', 'pending_validation', 'confirmed', 'corrected'
    )),
    contradiction boolean not null default false,
    alternatives jsonb not null default '[]'::jsonb,
    required_for_base boolean not null default false,
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, field_key)
);

create table bre.field_evidence (
    id uuid primary key default gen_random_uuid(),
    context_field_id uuid not null references bre.context_fields(id) on delete cascade,
    source_id uuid references bre.sources(id) on delete set null,
    url text not null,
    source_type text not null check (source_type in (
        'website', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'other'
    )),
    original_text text not null,
    captured_at timestamptz not null,
    content_hash text not null,
    created_at timestamptz not null default now(),
    unique (context_field_id, url, content_hash)
);

create table bre.section_answers (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    section_key text not null check (section_key in ('context_gaps', 'internal_data')),
    field_key text not null,
    value jsonb not null,
    answer_status text not null default 'submitted' check (answer_status in ('submitted', 'validated', 'rejected')),
    answered_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, section_key, field_key)
);

create table bre.validation_runs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    field_key text not null,
    model text not null,
    status text not null check (status in ('queued', 'completed', 'failed')),
    input_payload jsonb not null default '{}'::jsonb,
    output_payload jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table bre.ai_runs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    scrape_run_id uuid references bre.scrape_runs(id) on delete set null,
    purpose text not null check (purpose in ('normalize_context', 'validate_answer')),
    model text not null,
    status text not null check (status in ('queued', 'completed', 'failed')),
    input_hash text,
    output_payload jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table bre.audit_logs (
    id bigint generated always as identity primary key,
    project_id uuid references bre.projects(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    actor_type text not null check (actor_type in ('user', 'worker', 'system')),
    action text not null,
    entity_type text not null,
    entity_id text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index bre_project_members_user_idx on bre.project_members(user_id, project_id);
create index bre_sources_project_idx on bre.sources(project_id, source_type);
create index bre_scrape_runs_project_idx on bre.scrape_runs(project_id, created_at desc);
create index bre_documents_project_idx on bre.source_documents(project_id, captured_at desc);
create index bre_context_fields_project_idx on bre.context_fields(project_id, category);
create index bre_evidence_field_idx on bre.field_evidence(context_field_id);
create index bre_answers_project_idx on bre.section_answers(project_id, section_key);
create index bre_audit_project_idx on bre.audit_logs(project_id, created_at desc);

create trigger bre_projects_updated_at before update on bre.projects
for each row execute function bre.set_updated_at();
create trigger bre_sources_updated_at before update on bre.sources
for each row execute function bre.set_updated_at();
create trigger bre_scrape_runs_updated_at before update on bre.scrape_runs
for each row execute function bre.set_updated_at();
create trigger bre_scrape_source_runs_updated_at before update on bre.scrape_source_runs
for each row execute function bre.set_updated_at();
create trigger bre_context_fields_updated_at before update on bre.context_fields
for each row execute function bre.set_updated_at();
create trigger bre_section_answers_updated_at before update on bre.section_answers
for each row execute function bre.set_updated_at();

alter table bre.projects enable row level security;
alter table bre.project_members enable row level security;
alter table bre.sources enable row level security;
alter table bre.scrape_runs enable row level security;
alter table bre.scrape_source_runs enable row level security;
alter table bre.source_documents enable row level security;
alter table bre.context_fields enable row level security;
alter table bre.field_evidence enable row level security;
alter table bre.section_answers enable row level security;
alter table bre.validation_runs enable row level security;
alter table bre.ai_runs enable row level security;
alter table bre.audit_logs enable row level security;

revoke all on all tables in schema bre from public, anon, authenticated;
revoke all on all sequences in schema bre from public, anon, authenticated;
grant all on all tables in schema bre to service_role;
grant all on all sequences in schema bre to service_role;

alter default privileges in schema bre revoke all on tables from public, anon, authenticated;
alter default privileges in schema bre revoke all on sequences from public, anon, authenticated;
alter default privileges in schema bre grant all on tables to service_role;
alter default privileges in schema bre grant all on sequences to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'bre-raw',
    'bre-raw',
    false,
    5242880,
    array['text/html', 'text/plain', 'application/json']
)
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
    if not exists (select 1 from pgmq.meta where queue_name = 'bre_scrape_jobs') then
        perform pgmq.create('bre_scrape_jobs');
    end if;
end;
$$;

create or replace function public.bre_enqueue_scrape_job(message jsonb)
returns bigint
language sql
set search_path = ''
as $$
    select pgmq.send('bre_scrape_jobs', message);
$$;

create or replace function public.bre_read_scrape_jobs(
    visibility_timeout integer default 900,
    quantity integer default 1
)
returns table (
    msg_id bigint,
    read_ct integer,
    enqueued_at timestamptz,
    vt timestamptz,
    message jsonb,
    headers jsonb
)
language sql
set search_path = ''
as $$
    select * from pgmq.read('bre_scrape_jobs', visibility_timeout, quantity);
$$;

create or replace function public.bre_archive_scrape_job(message_id bigint)
returns boolean
language sql
set search_path = ''
as $$
    select pgmq.archive('bre_scrape_jobs', message_id);
$$;

revoke all on function public.bre_enqueue_scrape_job(jsonb) from public, anon, authenticated;
revoke all on function public.bre_read_scrape_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.bre_archive_scrape_job(bigint) from public, anon, authenticated;
grant execute on function public.bre_enqueue_scrape_job(jsonb) to service_role;
grant execute on function public.bre_read_scrape_jobs(integer, integer) to service_role;
grant execute on function public.bre_archive_scrape_job(bigint) to service_role;

comment on schema bre is 'Isolated base-context onboarding bounded context.';
comment on table bre.context_fields is 'Normalized public context. Inferred values always require user validation.';
comment on table bre.field_evidence is 'Source evidence retained independently from temporary raw payloads.';
comment on table bre.source_documents is 'Extracted documents; raw Storage objects expire after 30 days by application policy.';
