-- Creates the `staging` schema: a copy of the live `public` tables, data, row-level
-- security, grants, triggers and functions, for trying out changes before they go
-- live. Generated from the live database on 2026-10-26, after step 4 phase C (not from
-- ../schema.sql, which has drifted from live before).
--
-- Only touches `staging`. It reads from `public` but never writes to it.
-- Runs in one transaction and fails if `staging` already exists; to rebuild it, run
-- `drop schema staging cascade;` first.
-- After running it, add `staging` to Project Settings > Data API > Exposed schemas.

begin;

create schema staging;
grant usage on schema staging to anon, authenticated, service_role;

-- Tables: same columns, defaults, identity, checks and indexes as live.
create table staging.theatres (like public.theatres including all);
create table staging.films (like public.films including all);
create table staging.festivals (like public.festivals including all);
create table staging.theatre_films (like public.theatre_films including all);
create table staging.showtimes (like public.showtimes including all);
create table staging.promos (like public.promos including all);
create table staging.data_version (like public.data_version including all);

-- Foreign keys (LIKE doesn't copy them).
alter table staging.theatre_films
  add constraint theatre_films_theatre_id_fkey foreign key (theatre_id) references staging.theatres(id) on delete cascade,
  add constraint theatre_films_film_id_fkey foreign key (film_id) references staging.films(id) on delete cascade;
alter table staging.showtimes
  add constraint showtimes_theatre_id_fkey foreign key (theatre_id) references staging.theatres(id) on delete cascade,
  add constraint showtimes_film_id_fkey foreign key (film_id) references staging.films(id) on delete cascade,
  add constraint showtimes_festival_id_fkey foreign key (festival_id) references staging.festivals(id) on delete set null;

-- Data, keeping the live ids so rows can be compared with live.
insert into staging.theatres overriding system value select * from public.theatres;
insert into staging.films overriding system value select * from public.films;
insert into staging.festivals overriding system value select * from public.festivals;
insert into staging.theatre_films select * from public.theatre_films;
insert into staging.showtimes overriding system value select * from public.showtimes;
insert into staging.promos overriding system value select * from public.promos;
insert into staging.data_version select * from public.data_version;

-- Continue the id sequences after the copied rows.
select setval(pg_get_serial_sequence('staging.theatres', 'id'), coalesce((select max(id) from staging.theatres), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.films', 'id'), coalesce((select max(id) from staging.films), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.festivals', 'id'), coalesce((select max(id) from staging.festivals), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.showtimes', 'id'), coalesce((select max(id) from staging.showtimes), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.promos', 'id'), coalesce((select max(id) from staging.promos), 0) + 1, false);

-- Row-level security and policies, as on live: anyone can read, signed-in admins can
-- write. data_version is read-only; only the save function and triggers change it.
do $$
declare
  t text;
begin
  foreach t in array array['theatres', 'films', 'festivals', 'theatre_films', 'showtimes', 'promos', 'data_version']
  loop
    execute format('alter table staging.%I enable row level security', t);
    execute format('create policy %I on staging.%I for select using (true)', 'Public read ' || t, t);
    if t <> 'data_version' then
      execute format('create policy %I on staging.%I for all to authenticated using (true) with check (true)', 'Auth write ' || t, t);
    end if;
  end loop;
end $$;

-- Grants, as on live (row-level security above is what limits anon).
grant all on all tables in schema staging to anon, authenticated, service_role;
grant all on all sequences in schema staging to anon, authenticated, service_role;
revoke all on staging.data_version from anon, authenticated;
grant select on staging.data_version to anon, authenticated;

-- Functions, copied from live with `public` replaced by `staging`.

CREATE OR REPLACE FUNCTION staging.parse_show_time(value text)
 RETURNS time without time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'staging'
AS $function$
  select case
    when m24 is not null and m24[1]::int between 0 and 23
      then make_time(m24[1]::int, m24[2]::int, 0)
    when m12 is not null and m12[1]::int between 1 and 12
      then make_time(m12[1]::int % 12 + case when upper(m12[3]) = 'PM' then 12 else 0 end, coalesce(m12[2], '0')::int, 0)
  end
  from (
    select
      regexp_match(v, '^(\d{1,2}):([0-5]\d)$') as m24,
      regexp_match(v, '^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$', 'i') as m12
    from (select regexp_replace(replace(btrim(coalesce(value, '')), '.', ''), '\s+', ' ', 'g') as v) cleaned
  ) matched
$function$
;
CREATE OR REPLACE FUNCTION staging.note_for_time(notes text, show_time time without time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'staging'
AS $function$
  select nullif(string_agg(part, ' · ' order by ord), '')
  from (
    select
      ord,
      case
        when timed is null then segment
        when parse_show_time(timed[1]) = show_time then btrim(timed[2])
      end as part
    from regexp_split_to_table(
      coalesce(notes, ''),
      ';\s*(?=\d{1,2}(?::[0-5]\d)?\s*[ap]\.?m\.?\s*[:–—-]\s*)',
      'i'
    ) with ordinality as split(raw_segment, ord)
    cross join lateral (select btrim(raw_segment) as segment) trimmed
    cross join lateral (
      select regexp_match(segment, '^(\d{1,2}(?::[0-5]\d)?\s*[ap]\.?m\.?)\s*[:–—-]\s*(.+)$', 'i') as timed
    ) matched
    where segment <> ''
  ) parts
  where part is not null and part <> ''
$function$
;
CREATE OR REPLACE FUNCTION staging.format_from_note(note text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'staging'
AS $function$
  select format
  from (values
    (1, 'IMAX', 'IMAX'),
    (2, 'ACX', 'ACX'),
    (3, 'ScreenX', 'ScreenX'),
    (4, 'FPX', 'FPX'),
    (5, '4K Laser', '4K Laser'),
    (6, 'RPX', 'RPX'),
    (7, '4DX', '4DX'),
    (8, '3D', '3-?D')
  ) as known(ord, format, pattern)
  where coalesce(note, '') ~* ('(^|[^[:alnum:]])' || pattern || '($|[^[:alnum:]])')
  order by ord
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION staging.ticket_url(s staging.showtimes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'staging'
AS $function$
  select nullif(btrim(tf.ticket_link), '')
  from theatre_films tf
  where tf.theatre_id = s.theatre_id and tf.film_id = s.film_id
$function$
;
CREATE OR REPLACE FUNCTION staging.bump_data_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'staging'
AS $function$
begin
  if coalesce(current_setting('showtimes.in_full_save', true), '') = 'on' then
    return null;
  end if;
  update data_version set version = version + 1, changed_at = now() where id = 1;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION staging.replace_showtimes_data(payload jsonb, allow_ticket_link_clear boolean DEFAULT false, expected_version bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'staging'
AS $function$
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
$function$
;

-- Triggers, as on live.
do $$
declare
  t text;
begin
  foreach t in array array['theatres', 'films', 'festivals', 'theatre_films', 'showtimes', 'promos']
  loop
    execute format('create trigger trg_bump_data_version after insert or update or delete on staging.%I for each statement execute function staging.bump_data_version()', t);
  end loop;
end $$;

revoke all on function staging.replace_showtimes_data(jsonb, boolean, bigint) from public;
grant execute on function staging.replace_showtimes_data(jsonb, boolean, bigint) to authenticated, service_role;

commit;
