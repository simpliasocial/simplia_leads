alter table bre.projects
    add column if not exists operational_completion_payload jsonb,
    add column if not exists operational_completed_at timestamptz;

alter table bre.projects drop constraint if exists projects_status_check;
alter table bre.projects add constraint projects_status_check check (status in (
    'draft',
    'sources_ready',
    'scraping',
    'review_context',
    'collecting_answers',
    'base_context_complete',
    'objective_selected',
    'locations_configured',
    'agenda_configured',
    'lead_fields_configured',
    'style_configured',
    'generating_bot',
    'ready_for_technical_review'
));

alter table bre.ai_runs drop constraint if exists ai_runs_purpose_check;
alter table bre.ai_runs add constraint ai_runs_purpose_check check (purpose in (
    'normalize_context',
    'validate_answer',
    'geo_enricher',
    'ai_brain',
    'matcher_config_builder'
));

create table bre.operational_objectives (
    project_id uuid primary key references bre.projects(id) on delete cascade,
    objective text not null check (objective in ('appointments', 'meetings')),
    meeting_setup_fee_usd numeric(12, 2),
    calendar_email text,
    meet_status text not null default 'not_applicable' check (meet_status in (
        'not_applicable', 'pending_technical_setup', 'configured'
    )),
    location_term text,
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint operational_meetings_require_email check (
        objective <> 'meetings'
        or (calendar_email is not null and char_length(trim(calendar_email)) > 3)
    ),
    constraint operational_appointments_have_no_meet_fee check (
        objective <> 'appointments'
        or (calendar_email is null and meeting_setup_fee_usd is null)
    )
);

create table bre.locations (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    display_order integer not null default 0,
    name text not null check (char_length(trim(name)) > 0),
    address text not null check (char_length(trim(address)) > 0),
    hours text not null check (char_length(trim(hours)) > 0),
    google_maps_url text,
    location_status text not null default 'confirmed' check (location_status in ('confirmed', 'suggested')),
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table bre.location_references (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    location_id uuid not null references bre.locations(id) on delete cascade,
    reference_type text not null check (reference_type in ('alias', 'city', 'sector', 'phrase')),
    value text not null check (char_length(trim(value)) > 0),
    confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
    created_at timestamptz not null default now(),
    unique (location_id, reference_type, value)
);

create table bre.agenda_configs (
    project_id uuid primary key references bre.projects(id) on delete cascade,
    timezone text not null default 'America/Guayaquil',
    start_interval_minutes integer not null check (start_interval_minutes in (15, 30, 60)),
    duration_minutes integer not null check (duration_minutes >= 0 and duration_minutes <= 480),
    capacity_per_slot integer not null check (capacity_per_slot >= 0 and capacity_per_slot <= 500),
    weekly_hours jsonb not null default '[]'::jsonb,
    notes text,
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint agenda_weekly_hours_array check (jsonb_typeof(weekly_hours) = 'array')
);

create table bre.lead_capture_fields (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    display_order integer not null default 0,
    field_key text not null check (field_key in ('full_name', 'phone', 'email', 'national_id', 'age', 'city', 'custom')),
    custom_key text,
    label text not null check (char_length(trim(label)) > 0),
    enabled boolean not null default true,
    required boolean not null default false,
    reason text,
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table bre.style_preferences (
    project_id uuid primary key references bre.projects(id) on delete cascade,
    emoji_mode text not null check (emoji_mode in ('moderate', 'none', 'commercial_only')),
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table bre.filter_rules (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    display_order integer not null default 0,
    rule_key text not null,
    question text not null,
    gate_type text not null check (gate_type in ('blocking', 'non_blocking')),
    placement text not null check (placement in ('welcome', 'after_welcome', 'before_scheduling')),
    reason text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table bre.lopdp_config (
    project_id uuid primary key references bre.projects(id) on delete cascade,
    country text,
    placement_option integer not null check (placement_option between 1 and 4),
    legal_text text not null,
    status text not null default 'generated' check (status in ('generated', 'pending_legal_review')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table bre.prompt_versions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    version_number integer not null,
    status text not null default 'candidate' check (status in ('candidate', 'published', 'archived')),
    compiled_prompt text not null,
    input_snapshot jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    unique (project_id, version_number)
);

create table bre.prompt_blocks (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    prompt_version_id uuid not null references bre.prompt_versions(id) on delete cascade,
    block_key text not null check (block_key in (
        'business_context',
        'objective_config',
        'locations_block',
        'agenda_block',
        'lead_fields_block',
        'filters_block',
        'lopdp_block',
        'templates_block',
        'variables_block',
        'faq_products_block',
        'compiled_prompt'
    )),
    content text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (prompt_version_id, block_key)
);

create table bre.matcher_versions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    version_number integer not null,
    status text not null default 'candidate' check (status in ('candidate', 'published', 'archived')),
    labels jsonb not null,
    matcher_config jsonb not null,
    matcher_code text not null,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    constraint matcher_labels_array check (jsonb_typeof(labels) = 'array'),
    unique (project_id, version_number)
);

create table bre.technical_review_queue (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references bre.projects(id) on delete cascade,
    prompt_version_id uuid not null references bre.prompt_versions(id) on delete cascade,
    matcher_version_id uuid not null references bre.matcher_versions(id) on delete cascade,
    review_status text not null default 'pending_review' check (review_status in (
        'pending_review', 'in_review', 'approved', 'rejected'
    )),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, prompt_version_id, matcher_version_id)
);

create index bre_locations_project_idx on bre.locations(project_id, display_order);
create index bre_location_references_project_idx on bre.location_references(project_id, location_id);
create index bre_lead_capture_fields_project_idx on bre.lead_capture_fields(project_id, display_order);
create index bre_filter_rules_project_idx on bre.filter_rules(project_id, display_order);
create index bre_prompt_versions_project_idx on bre.prompt_versions(project_id, version_number desc);
create index bre_prompt_blocks_version_idx on bre.prompt_blocks(prompt_version_id);
create index bre_matcher_versions_project_idx on bre.matcher_versions(project_id, version_number desc);
create index bre_technical_review_project_idx on bre.technical_review_queue(project_id, created_at desc);

create trigger bre_operational_objectives_updated_at before update on bre.operational_objectives
for each row execute function bre.set_updated_at();
create trigger bre_locations_updated_at before update on bre.locations
for each row execute function bre.set_updated_at();
create trigger bre_agenda_configs_updated_at before update on bre.agenda_configs
for each row execute function bre.set_updated_at();
create trigger bre_lead_capture_fields_updated_at before update on bre.lead_capture_fields
for each row execute function bre.set_updated_at();
create trigger bre_style_preferences_updated_at before update on bre.style_preferences
for each row execute function bre.set_updated_at();
create trigger bre_lopdp_config_updated_at before update on bre.lopdp_config
for each row execute function bre.set_updated_at();
create trigger bre_technical_review_queue_updated_at before update on bre.technical_review_queue
for each row execute function bre.set_updated_at();

alter table bre.operational_objectives enable row level security;
alter table bre.locations enable row level security;
alter table bre.location_references enable row level security;
alter table bre.agenda_configs enable row level security;
alter table bre.lead_capture_fields enable row level security;
alter table bre.style_preferences enable row level security;
alter table bre.filter_rules enable row level security;
alter table bre.lopdp_config enable row level security;
alter table bre.prompt_versions enable row level security;
alter table bre.prompt_blocks enable row level security;
alter table bre.matcher_versions enable row level security;
alter table bre.technical_review_queue enable row level security;

revoke all on all tables in schema bre from public, anon, authenticated;
revoke all on all sequences in schema bre from public, anon, authenticated;
grant all on all tables in schema bre to service_role;
grant all on all sequences in schema bre to service_role;

comment on table bre.operational_objectives is 'Operational branch selected after base context completion.';
comment on table bre.locations is 'Confirmed appointment locations; suggestions become operational only after user confirmation.';
comment on table bre.prompt_versions is 'Candidate, published and archived prompt versions generated from versioned blocks.';
comment on table bre.matcher_versions is 'Deterministic matcher config/code versioned with prompt versions.';
