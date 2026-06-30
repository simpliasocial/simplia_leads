alter table bre.agenda_configs
    drop constraint if exists agenda_configs_duration_minutes_check;

alter table bre.agenda_configs
    add constraint agenda_configs_duration_minutes_check
    check (duration_minutes >= 0 and duration_minutes <= 480);

alter table bre.agenda_configs
    drop constraint if exists agenda_configs_capacity_per_slot_check;

alter table bre.agenda_configs
    add constraint agenda_configs_capacity_per_slot_check
    check (capacity_per_slot >= 0 and capacity_per_slot <= 500);
