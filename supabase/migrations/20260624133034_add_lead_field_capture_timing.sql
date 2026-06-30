alter table bre.lead_capture_fields
    add column if not exists capture_timing text not null default 'when_scheduling',
    add column if not exists blocks_early_flow boolean not null default false;

alter table bre.lead_capture_fields
    drop constraint if exists lead_capture_fields_capture_timing_check;

alter table bre.lead_capture_fields
    add constraint lead_capture_fields_capture_timing_check
    check (capture_timing in ('conversation_start', 'when_scheduling'));

update bre.lead_capture_fields
set capture_timing = 'when_scheduling',
    blocks_early_flow = false
where capture_timing is null;
