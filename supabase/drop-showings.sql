-- Step 4, phase C: the admin save writes `showtimes` directly, and the old structures go:
-- `showings`, `festival_films`, `films.ticket_link` and `showtimes.showing_id`.
-- Run against one schema at a time:
--   psql "$DATABASE_URL" -v schema=staging -f supabase/drop-showings.sql
--
-- * replace_showtimes_data takes the same payload as before. The admin still sends one
--   `showings` entry per theatre, film and day with text time arrays; each time becomes
--   a showtimes row, parsed as the sync trigger did. Showtimes that are still there keep
--   their id, changed ones are updated, and ones no longer in the admin are deleted.
-- * films[].ticket_link in the payload is ignored. Every film-level link was also in
--   theatre_films (checked on live, 2026-10-21), which is where the site reads them.
--
-- Safe while an older admin tab is open: its payload has the same shape.

\set ON_ERROR_STOP on

begin;

create or replace function :"schema".replace_showtimes_data(
  payload jsonb,
  allow_ticket_link_clear boolean default false,
  expected_version bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = :'schema'
as $$
declare
  item jsonb;
  current_version bigint;
  existing_id bigint;
  v_id bigint;
  v_theatre_id bigint;
  v_film_id bigint;
  festival_id_map jsonb := '{}'::jsonb;
  theatre_id_map jsonb := '{}'::jsonb;
  film_id_map jsonb := '{}'::jsonb;
  used_ids bigint[];
  delete_count integer;
  risky_ticket_link_clears integer := 0;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  if payload is null then
    raise exception 'Payload is required';
  end if;

  select version into current_version from data_version where id = 1 for update;
  if expected_version is not null and expected_version is distinct from current_version then
    raise exception 'Blocked save: the data changed after you loaded the admin (for example someone else saved, or the daily TMDb refresh ran). Reload the page, redo your change and save again.';
  end if;

  -- Ticket links that would be cleared (unchanged from the previous version).
  if not coalesce(allow_ticket_link_clear, false) then
    with payload_theatres as (
      select
        value->>'key' as theatre_key,
        nullif(value->>'db_id', '')::bigint as theatre_db_id,
        lower(trim(value->>'name')) as theatre_name_key,
        lower(trim(value->>'city')) as theatre_city_key
      from jsonb_array_elements(coalesce(payload->'theatres', '[]'::jsonb))
    ),
    payload_films as (
      select
        value->>'key' as film_key,
        nullif(value->>'db_id', '')::bigint as film_db_id,
        case
          when nullif(value->>'tmdb_id', '') is not null then 'tmdb:' || (nullif(value->>'tmdb_id', '')::bigint)::text
          else lower(trim(value->>'title')) || '::' || coalesce(value->>'year', '')
        end as film_identity_key
      from jsonb_array_elements(coalesce(payload->'films', '[]'::jsonb))
    ),
    payload_links as (
      select
        coalesce(nullif(link_item->>'theatre_db_id', '')::bigint, pt.theatre_db_id) as theatre_db_id,
        coalesce(nullif(link_item->>'film_db_id', '')::bigint, pf.film_db_id) as film_db_id,
        pt.theatre_name_key,
        pt.theatre_city_key,
        pf.film_identity_key,
        nullif(trim(coalesce(link_item->>'ticket_link', '')), '') as ticket_link
      from jsonb_array_elements(coalesce(payload->'theatre_films', '[]'::jsonb)) link_item
      join payload_theatres pt on pt.theatre_key = link_item->>'theatre_key'
      join payload_films pf on pf.film_key = link_item->>'film_key'
    ),
    payload_non_empty_by_id as (
      select distinct theatre_db_id, film_db_id
      from payload_links
      where theatre_db_id is not null and film_db_id is not null and ticket_link is not null
    ),
    payload_non_empty_by_text as (
      select distinct theatre_name_key, theatre_city_key, film_identity_key
      from payload_links
      where ticket_link is not null
    ),
    existing_links as (
      select
        tf.theatre_id,
        tf.film_id,
        lower(trim(t.name)) as theatre_name_key,
        lower(trim(t.city)) as theatre_city_key,
        case
          when f.tmdb_id is not null then 'tmdb:' || f.tmdb_id::text
          else lower(trim(f.title)) || '::' || coalesce(f.year::text, '')
        end as film_identity_key
      from theatre_films tf
      join theatres t on t.id = tf.theatre_id
      join films f on f.id = tf.film_id
      where nullif(trim(tf.ticket_link), '') is not null
    ),
    risky as (
      select 1
      from existing_links existing
      left join payload_non_empty_by_id pid
        on pid.theatre_db_id = existing.theatre_id
       and pid.film_db_id = existing.film_id
      left join payload_non_empty_by_text ptxt
        on ptxt.theatre_name_key = existing.theatre_name_key
       and ptxt.theatre_city_key = existing.theatre_city_key
       and ptxt.film_identity_key = existing.film_identity_key
      where pid.theatre_db_id is null
        and ptxt.theatre_name_key is null
    )
    select count(*) into risky_ticket_link_clears from risky;

    if risky_ticket_link_clears > 0 then
      raise exception 'Blocked save: payload would clear % existing ticket link(s).', risky_ticket_link_clears;
    end if;
  end if;

  -- Refuse saves that would delete a lot at once (e.g. if ids went missing in the admin).
  select count(*) into delete_count from films
  where id not in (
    select (value->>'db_id')::bigint from jsonb_array_elements(coalesce(payload->'films', '[]'::jsonb))
    where nullif(value->>'db_id', '') is not null
  );
  if delete_count > 10 then
    raise exception 'Blocked save: it would delete % films. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  select count(*) into delete_count from theatres
  where id not in (
    select (value->>'db_id')::bigint from jsonb_array_elements(coalesce(payload->'theatres', '[]'::jsonb))
    where nullif(value->>'db_id', '') is not null
  );
  if delete_count > 3 then
    raise exception 'Blocked save: it would delete % theatres. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  select count(*) into delete_count from festivals
  where id not in (
    select (value->>'id')::bigint from jsonb_array_elements(coalesce(payload->'festivals', '[]'::jsonb))
    where nullif(value->>'id', '') is not null
  );
  if delete_count > 2 then
    raise exception 'Blocked save: it would delete % festivals. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  perform set_config('showtimes.in_full_save', 'on', true);

  -- Rewritten in full below.
  delete from theatre_films where true;

  -- Rows removed in the admin. Deleted first so a renamed festival slug can't clash.
  delete from festivals where id not in (
    select (value->>'id')::bigint from jsonb_array_elements(coalesce(payload->'festivals', '[]'::jsonb))
    where nullif(value->>'id', '') is not null
  );
  delete from theatres where id not in (
    select (value->>'db_id')::bigint from jsonb_array_elements(coalesce(payload->'theatres', '[]'::jsonb))
    where nullif(value->>'db_id', '') is not null
  );
  delete from films where id not in (
    select (value->>'db_id')::bigint from jsonb_array_elements(coalesce(payload->'films', '[]'::jsonb))
    where nullif(value->>'db_id', '') is not null
  );
  delete from promos where id not in (
    select (value->>'db_id')::bigint from jsonb_array_elements(coalesce(payload->'promos', '[]'::jsonb))
    where nullif(value->>'db_id', '') is not null
  );

  used_ids := '{}';
  for item in select value from jsonb_array_elements(coalesce(payload->'festivals', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'id', '')::bigint;
    v_id := null;
    if existing_id is not null and not existing_id = any(used_ids) then
      update festivals set
        slug = coalesce(item->>'slug', ''),
        name = coalesce(item->>'name', ''),
        description = coalesce(item->>'description', ''),
        website = coalesce(item->>'website', ''),
        primary_color = coalesce(item->>'primary_color', ''),
        start_date = nullif(item->>'start_date', '')::date,
        end_date = nullif(item->>'end_date', '')::date,
        enabled = coalesce((item->>'enabled')::boolean, true),
        sort_order = coalesce((item->>'sort_order')::integer, 0)
      where id = existing_id
      returning id into v_id;
    end if;
    if v_id is null then
      insert into festivals (slug, name, description, website, primary_color, start_date, end_date, enabled, sort_order)
      values (
        coalesce(item->>'slug', ''),
        coalesce(item->>'name', ''),
        coalesce(item->>'description', ''),
        coalesce(item->>'website', ''),
        coalesce(item->>'primary_color', ''),
        nullif(item->>'start_date', '')::date,
        nullif(item->>'end_date', '')::date,
        coalesce((item->>'enabled')::boolean, true),
        coalesce((item->>'sort_order')::integer, 0)
      )
      returning id into v_id;
    end if;
    used_ids := used_ids || v_id;
    if coalesce(item->>'slug', '') <> '' then
      festival_id_map := festival_id_map || jsonb_build_object(item->>'slug', v_id);
    end if;
  end loop;

  used_ids := '{}';
  for item in select value from jsonb_array_elements(coalesce(payload->'theatres', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null and not existing_id = any(used_ids) then
      update theatres set
        name = coalesce(item->>'name', ''),
        city = coalesce(item->>'city', ''),
        address = coalesce(item->>'address', ''),
        website = coalesce(item->>'website', ''),
        latitude = nullif(item->>'latitude', '')::double precision,
        longitude = nullif(item->>'longitude', '')::double precision
      where id = existing_id
      returning id into v_id;
    end if;
    if v_id is null then
      insert into theatres (name, city, address, website, latitude, longitude)
      values (
        coalesce(item->>'name', ''),
        coalesce(item->>'city', ''),
        coalesce(item->>'address', ''),
        coalesce(item->>'website', ''),
        nullif(item->>'latitude', '')::double precision,
        nullif(item->>'longitude', '')::double precision
      )
      returning id into v_id;
    end if;
    used_ids := used_ids || v_id;
    theatre_id_map := theatre_id_map || jsonb_build_object(item->>'key', v_id);
  end loop;

  used_ids := '{}';
  for item in select value from jsonb_array_elements(coalesce(payload->'films', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null and not existing_id = any(used_ids) then
      update films set
        title = coalesce(item->>'title', ''),
        year = nullif(item->>'year', '')::integer,
        tmdb_id = nullif(item->>'tmdb_id', '')::bigint,
        synopsis = coalesce(nullif(item->>'synopsis', ''), nullif(item->'tmdb_json'->>'overview', ''), ''),
        metadata_source = case lower(trim(coalesce(item->>'metadata_source', '')))
          when 'tmdb' then 'tmdb'
          when 'manual' then 'manual'
          else case when nullif(item->>'tmdb_id', '') is not null then 'tmdb' else 'manual' end
        end,
        staff_favorite = coalesce((item->>'staff_favorite')::boolean, false),
        staff_favorite_by = coalesce(item->>'staff_favorite_by', ''),
        featured_on_playweek = coalesce((item->>'featured_on_playweek')::boolean, false),
        featured_on_playweek_url = coalesce(item->>'featured_on_playweek_url', ''),
        ranking_override = coalesce((item->>'ranking_override')::boolean, false),
        tmdb_json = item->'tmdb_json'
      where id = existing_id
      returning id into v_id;
    end if;
    if v_id is null then
      insert into films (
        title, year, tmdb_id, synopsis, metadata_source, staff_favorite, staff_favorite_by,
        featured_on_playweek, featured_on_playweek_url, ranking_override, tmdb_json
      )
      values (
        coalesce(item->>'title', ''),
        nullif(item->>'year', '')::integer,
        nullif(item->>'tmdb_id', '')::bigint,
        coalesce(nullif(item->>'synopsis', ''), nullif(item->'tmdb_json'->>'overview', ''), ''),
        case lower(trim(coalesce(item->>'metadata_source', '')))
          when 'tmdb' then 'tmdb'
          when 'manual' then 'manual'
          else case when nullif(item->>'tmdb_id', '') is not null then 'tmdb' else 'manual' end
        end,
        coalesce((item->>'staff_favorite')::boolean, false),
        coalesce(item->>'staff_favorite_by', ''),
        coalesce((item->>'featured_on_playweek')::boolean, false),
        coalesce(item->>'featured_on_playweek_url', ''),
        coalesce((item->>'ranking_override')::boolean, false),
        item->'tmdb_json'
      )
      returning id into v_id;
    end if;
    used_ids := used_ids || v_id;
    film_id_map := film_id_map || jsonb_build_object(item->>'key', v_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'theatre_films', '[]'::jsonb))
  loop
    v_theatre_id := nullif(theatre_id_map->>(item->>'theatre_key'), '')::bigint;
    v_film_id := nullif(film_id_map->>(item->>'film_key'), '')::bigint;
    if v_theatre_id is not null
       and v_film_id is not null
       and nullif(trim(coalesce(item->>'ticket_link', '')), '') is not null then
      insert into theatre_films (theatre_id, film_id, ticket_link)
      values (v_theatre_id, v_film_id, item->>'ticket_link')
      on conflict (theatre_id, film_id) do update set ticket_link = excluded.ticket_link;
    end if;
  end loop;

  -- Showtimes. Each payload entry is one theatre, film and day, with text times
  -- ("7:00 PM"; unreadable ones are skipped, as the site does) and notes that can be
  -- tied to a time ("7:00 PM: Q&A"). If two entries give the same showtime, the first
  -- one wins. Existing rows are matched on theatre, film, start and premium, so they
  -- keep their id; rows the admin no longer has are deleted.
  with entries as (
    select
      nullif(theatre_id_map->>(entry->>'theatre_key'), '')::bigint as theatre_id,
      nullif(film_id_map->>(entry->>'film_key'), '')::bigint as film_id,
      coalesce(
        nullif(festival_id_map->>(entry->>'festival_slug'), '')::bigint,
        (select f.id from festivals f where f.id = nullif(entry->>'festival_id', '')::bigint)
      ) as festival_id,
      (entry->>'show_date')::date as show_date,
      nullif(btrim(coalesce(entry->>'room', '')), '') as room,
      btrim(coalesce(entry->>'notes', '')) as notes,
      entry,
      entry_ord
    from jsonb_array_elements(coalesce(payload->'showings', '[]'::jsonb)) with ordinality as e(entry, entry_ord)
  ),
  parsed as (
    select
      e.theatre_id, e.film_id, e.festival_id, e.show_date, e.room, e.notes, e.entry_ord,
      t.start_time,
      t.is_premium,
      (e.show_date + t.start_time) at time zone 'America/New_York' as starts_at
    from entries e
    cross join lateral (
      select parse_show_time(raw) as start_time, false as is_premium
      from jsonb_array_elements_text(coalesce(e.entry->'times', '[]'::jsonb)) as x(raw)
      union all
      select parse_show_time(raw), true
      from jsonb_array_elements_text(coalesce(e.entry->'premium_times', '[]'::jsonb)) as x(raw)
    ) t
    where e.theatre_id is not null and e.film_id is not null and t.start_time is not null
  ),
  wanted as (
    select distinct on (p.theatre_id, p.film_id, p.starts_at, p.is_premium)
      p.theatre_id, p.film_id, p.festival_id, p.show_date, p.start_time, p.starts_at, p.is_premium, p.room,
      n.note,
      case when p.is_premium then coalesce(format_from_note(n.note), 'Premium') end as format
    from parsed p
    cross join lateral (
      select case when p.notes <> '' then note_for_time(p.notes, p.start_time) end as note
    ) n
    order by p.theatre_id, p.film_id, p.starts_at, p.is_premium, p.entry_ord
  ),
  removed as (
    delete from showtimes s
    where not exists (
      select 1 from wanted w
      where w.theatre_id = s.theatre_id and w.film_id = s.film_id
        and w.starts_at = s.starts_at and w.is_premium = s.is_premium
    )
  )
  insert into showtimes as s (theatre_id, film_id, festival_id, show_date, start_time, starts_at, is_premium, format, note, room)
  select theatre_id, film_id, festival_id, show_date, start_time, starts_at, is_premium, format, note, room
  from wanted
  on conflict (theatre_id, film_id, starts_at, is_premium) do update set
    festival_id = excluded.festival_id,
    show_date = excluded.show_date,
    start_time = excluded.start_time,
    format = excluded.format,
    note = excluded.note,
    room = excluded.room
  where (s.festival_id, s.show_date, s.start_time, s.format, s.note, s.room)
    is distinct from (excluded.festival_id, excluded.show_date, excluded.start_time, excluded.format, excluded.note, excluded.room);

  used_ids := '{}';
  for item in select value from jsonb_array_elements(coalesce(payload->'promos', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null and not existing_id = any(used_ids) then
      update promos set
        title = coalesce(item->>'title', ''),
        button_url = coalesce(item->>'button_url', ''),
        image_path = coalesce(item->>'image_path', ''),
        image_alt = coalesce(item->>'image_alt', ''),
        image_name = coalesce(item->>'image_name', ''),
        button_label = coalesce(item->>'button_label', 'Shop Now'),
        enabled = coalesce((item->>'enabled')::boolean, true),
        sort_order = coalesce((item->>'sort_order')::integer, 0)
      where id = existing_id
      returning id into v_id;
    end if;
    if v_id is null then
      insert into promos (title, button_url, image_path, image_alt, image_name, button_label, enabled, sort_order)
      values (
        coalesce(item->>'title', ''),
        coalesce(item->>'button_url', ''),
        coalesce(item->>'image_path', ''),
        coalesce(item->>'image_alt', ''),
        coalesce(item->>'image_name', ''),
        coalesce(item->>'button_label', 'Shop Now'),
        coalesce((item->>'enabled')::boolean, true),
        coalesce((item->>'sort_order')::integer, 0)
      )
      returning id into v_id;
    end if;
    used_ids := used_ids || v_id;
  end loop;

  perform set_config('showtimes.in_full_save', 'off', true);
  update data_version set version = version + 1, changed_at = now() where id = 1
  returning version into current_version;
  return current_version;
end;
$$;

revoke all on function :"schema".replace_showtimes_data(jsonb, boolean, bigint) from public;
grant execute on function :"schema".replace_showtimes_data(jsonb, boolean, bigint) to authenticated, service_role;

drop trigger if exists trg_sync_showtimes on :"schema".showings;
drop function if exists :"schema".sync_showtimes_from_showing();
drop function if exists :"schema".insert_showtimes_for_showing(:"schema".showings);
alter table :"schema".showtimes drop column showing_id;
drop table :"schema".showings;
drop function if exists :"schema".normalize_showings_festival_fk();
drop table :"schema".festival_films;
alter table :"schema".films drop column ticket_link;

commit;
