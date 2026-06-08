-- ========================================================================
-- Chatwoot labels vivos, pruning y discovery
-- Funciones idempotentes para limpiar referencias a etiquetas eliminadas y
-- sincronizar dashboard_tag_settings con label_catalog.
-- ========================================================================

create or replace function cw.prune_dashboard_settings_labels(target_account_id bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = cw, pg_catalog
as $$
declare
    current_settings jsonb;
    pruned_settings jsonb;
    label_list text[];
    key_name text;
    label_array_keys text[] := array[
        'sqlTags',
        'appointmentTags',
        'saleTags',
        'unqualifiedTags',
        'scoreHighTags',
        'scoreMediumTags',
        'scoreLowTags',
        'humanFollowupQueueTags',
        'humanSalesQueueTags',
        'scoreAppointmentLabels'
    ];
    auto_label_array_keys text[] := array[
        'sqlTags',
        'appointmentTags',
        'saleTags',
        'unqualifiedTags',
        'humanFollowupQueueTags'
    ];
begin
    select settings
    into current_settings
    from cw.dashboard_tag_settings
    where account_id = target_account_id;

    select coalesce(array_agg(title order by title), array[]::text[])
    into label_list
    from cw.label_catalog
    where account_id = target_account_id;

    pruned_settings := coalesce(current_settings, '{}'::jsonb)
        || jsonb_build_object(
            'availableLabels', to_jsonb(label_list),
            'discoveredLabels', to_jsonb(label_list)
        );

    foreach key_name in array label_array_keys loop
        pruned_settings := jsonb_set(
            pruned_settings,
            array[key_name],
            (
                select coalesce(jsonb_agg(item_label order by item_label), '[]'::jsonb)
                from (
                    select distinct item_label
                    from jsonb_array_elements_text(
                        case
                            when jsonb_typeof(pruned_settings -> key_name) = 'array'
                                then pruned_settings -> key_name
                            else '[]'::jsonb
                        end
                    ) as labels(item_label)
                    where item_label = any(label_list)
                ) kept
            ),
            true
        );
    end loop;

    if not (coalesce(pruned_settings ->> 'humanAppointmentTargetLabel', '') = any(label_list)) then
        pruned_settings := jsonb_set(pruned_settings, '{humanAppointmentTargetLabel}', to_jsonb(''::text), true);
    end if;

    if not (coalesce(pruned_settings ->> 'humanSaleTargetLabel', '') = any(label_list)) then
        pruned_settings := jsonb_set(pruned_settings, '{humanSaleTargetLabel}', to_jsonb(''::text), true);
    end if;

    if jsonb_typeof(pruned_settings -> 'autoTagGroups') = 'object' then
        foreach key_name in array auto_label_array_keys loop
            pruned_settings := jsonb_set(
                pruned_settings,
                array['autoTagGroups', key_name],
                (
                    select coalesce(jsonb_agg(item_label order by item_label), '[]'::jsonb)
                    from (
                        select distinct item_label
                        from jsonb_array_elements_text(
                            case
                                when jsonb_typeof(pruned_settings #> array['autoTagGroups', key_name]) = 'array'
                                    then pruned_settings #> array['autoTagGroups', key_name]
                                else '[]'::jsonb
                            end
                        ) as labels(item_label)
                        where item_label = any(label_list)
                    ) kept
                ),
                true
            );
        end loop;
    end if;

    insert into cw.dashboard_tag_settings (account_id, settings, updated_at)
    values (target_account_id, pruned_settings, now())
    on conflict (account_id)
    do update set settings = excluded.settings, updated_at = now();

    return jsonb_build_object(
        'account_id', target_account_id,
        'labels', label_list,
        'settings', pruned_settings,
        'updated_at', now()
    );
end;
$$;

revoke all on function cw.prune_dashboard_settings_labels(bigint) from anon, authenticated;
grant execute on function cw.prune_dashboard_settings_labels(bigint) to service_role;

create or replace function cw.prune_deleted_label_references(target_account_id bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = cw, pg_catalog
as $$
declare
    active_labels text[];
    conversations_updated integer := 0;
    events_updated integer := 0;
    events_deleted integer := 0;
begin
    select coalesce(array_agg(title order by title), array[]::text[])
    into active_labels
    from cw.label_catalog
    where account_id = target_account_id;

    with pruned as (
        select
            c.chatwoot_conversation_id,
            coalesce((
                select array_agg(label order by label)
                from (
                    select distinct label
                    from unnest(coalesce(c.labels, array[]::text[])) as labels(label)
                    where label = any(active_labels)
                ) kept
            ), array[]::text[]) as labels
        from cw.conversations_current c
        where exists (
            select 1
            from unnest(coalesce(c.labels, array[]::text[])) as labels(label)
            where not (label = any(active_labels))
        )
    )
    update cw.conversations_current c
    set labels = pruned.labels,
        updated_at = now()
    from pruned
    where c.chatwoot_conversation_id = pruned.chatwoot_conversation_id;

    get diagnostics conversations_updated = row_count;

    with pruned as (
        select
            e.id,
            coalesce((
                select array_agg(label order by label)
                from (
                    select distinct label
                    from unnest(coalesce(e.previous_labels, array[]::text[])) as labels(label)
                    where label = any(active_labels)
                ) kept
            ), array[]::text[]) as previous_labels,
            coalesce((
                select array_agg(label order by label)
                from (
                    select distinct label
                    from unnest(coalesce(e.next_labels, array[]::text[])) as labels(label)
                    where label = any(active_labels)
                ) kept
            ), array[]::text[]) as next_labels,
            coalesce((
                select array_agg(label order by label)
                from (
                    select distinct label
                    from unnest(coalesce(e.added_labels, array[]::text[])) as labels(label)
                    where label = any(active_labels)
                ) kept
            ), array[]::text[]) as added_labels,
            coalesce((
                select array_agg(label order by label)
                from (
                    select distinct label
                    from unnest(coalesce(e.removed_labels, array[]::text[])) as labels(label)
                    where label = any(active_labels)
                ) kept
            ), array[]::text[]) as removed_labels
        from cw.conversation_label_events e
        where exists (
            select 1
            from unnest(
                coalesce(e.previous_labels, array[]::text[]) ||
                coalesce(e.next_labels, array[]::text[]) ||
                coalesce(e.added_labels, array[]::text[]) ||
                coalesce(e.removed_labels, array[]::text[])
            ) as labels(label)
            where not (label = any(active_labels))
        )
    )
    update cw.conversation_label_events e
    set previous_labels = pruned.previous_labels,
        next_labels = pruned.next_labels,
        added_labels = pruned.added_labels,
        removed_labels = pruned.removed_labels
    from pruned
    where e.id = pruned.id;

    get diagnostics events_updated = row_count;

    delete from cw.conversation_label_events
    where coalesce(array_length(previous_labels, 1), 0) = 0
      and coalesce(array_length(next_labels, 1), 0) = 0
      and coalesce(array_length(added_labels, 1), 0) = 0
      and coalesce(array_length(removed_labels, 1), 0) = 0;

    get diagnostics events_deleted = row_count;

    return jsonb_build_object(
        'account_id', target_account_id,
        'active_labels', active_labels,
        'conversations_updated', conversations_updated,
        'events_updated', events_updated,
        'events_deleted', events_deleted
    );
end;
$$;

revoke all on function cw.prune_deleted_label_references(bigint) from anon, authenticated;
grant execute on function cw.prune_deleted_label_references(bigint) to service_role;
