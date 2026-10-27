-- The admin's Save sends only what changed, instead of the whole dataset.
-- Run against one schema at a time:
--   psql "$DATABASE_URL" -v schema=staging -f supabase/targeted-saves.sql
--
-- * apply_showtimes_changes takes the rows the admin added, changed or removed since it
--   last loaded or saved. Showtimes come as whole days (one theatre, film and date):
--   every showtime of a day that's sent is rebuilt from it, and other days are left alone.
-- * It keeps replace_showtimes_data's checks: the data_version lock, no clearing ticket
--   links, and no deleting more than 10 films, 3 theatres or 2 festivals at once. It
--   bumps data_version once, and deletes showtimes that have already started.
-- * replace_showtimes_data stays, so an admin tab opened before this change still saves.

\set ON_ERROR_STOP on

begin;

create or replace function :"schema".apply_showtimes_changes(
  changes jsonb,
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
  festival_id_map jsonb := '{}'::jsonb;
  theatre_id_map jsonb := '{}'::jsonb;
  film_id_map jsonb := '{}'::jsonb;
  delete_count integer;
  ticket_link_clears integer;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  if changes is null then
    raise exception 'Changes are required';
  end if;

  select version into current_version from data_version where id = 1 for update;
  if expected_version is not null and expected_version is distinct from current_version then
    raise exception 'Blocked save: the data changed after you loaded the admin (for example someone else saved, or the daily TMDb refresh ran). Reload the page, redo your change and save again.';
  end if;

  -- Ticket links that would go, removed directly or with their theatre or film.
  select count(*) into ticket_link_clears
  from theatre_films tf
  where nullif(trim(tf.ticket_link), '') is not null
    and (
      tf.theatre_id in (
        select value::bigint from jsonb_array_elements_text(coalesce(changes->'theatres'->'delete', '[]'::jsonb))
      )
      or tf.film_id in (
        select value::bigint from jsonb_array_elements_text(coalesce(changes->'films'->'delete', '[]'::jsonb))
      )
      or exists (
        select 1 from jsonb_array_elements(coalesce(changes->'theatre_films'->'delete', '[]'::jsonb)) d
        where (d->>'theatre_db_id')::bigint = tf.theatre_id and (d->>'film_db_id')::bigint = tf.film_id
      )
    );
  if ticket_link_clears > 0 then
    raise exception 'Blocked save: it would clear % existing ticket link(s).', ticket_link_clears;
  end if;

  -- Refuse saves that would delete a lot at once (e.g. if ids went missing in the admin).
  select count(*) into delete_count from films
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'films'->'delete', '[]'::jsonb)));
  if delete_count > 10 then
    raise exception 'Blocked save: it would delete % films. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  select count(*) into delete_count from theatres
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'theatres'->'delete', '[]'::jsonb)));
  if delete_count > 3 then
    raise exception 'Blocked save: it would delete % theatres. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  select count(*) into delete_count from festivals
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'festivals'->'delete', '[]'::jsonb)));
  if delete_count > 2 then
    raise exception 'Blocked save: it would delete % festivals. Reload the admin and try again; if this is intended, ask for it to be done directly in the database.', delete_count;
  end if;

  perform set_config('showtimes.in_full_save', 'on', true);

  -- Removed rows go first, so a renamed festival slug can't clash.
  delete from theatre_films tf
  using jsonb_array_elements(coalesce(changes->'theatre_films'->'delete', '[]'::jsonb)) d
  where tf.theatre_id = (d->>'theatre_db_id')::bigint and tf.film_id = (d->>'film_db_id')::bigint;
  delete from festivals
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'festivals'->'delete', '[]'::jsonb)));
  delete from theatres
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'theatres'->'delete', '[]'::jsonb)));
  delete from films
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'films'->'delete', '[]'::jsonb)));
  delete from promos
  where id in (select value::bigint from jsonb_array_elements_text(coalesce(changes->'promos'->'delete', '[]'::jsonb)));

  -- Changed rows are updated by id; new ones (no id) are inserted. Theatres and films
  -- also have a `key`, which the day and ticket link entries use for a new row.
  for item in select value from jsonb_array_elements(coalesce(changes->'festivals'->'upsert', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'id', '')::bigint;
    v_id := null;
    if existing_id is not null then
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
    if coalesce(item->>'slug', '') <> '' then
      festival_id_map := festival_id_map || jsonb_build_object(item->>'slug', v_id);
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'theatres'->'upsert', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null then
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
    theatre_id_map := theatre_id_map || jsonb_build_object(item->>'key', v_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'films'->'upsert', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null then
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
    film_id_map := film_id_map || jsonb_build_object(item->>'key', v_id);
  end loop;

  insert into theatre_films (theatre_id, film_id, ticket_link)
  select theatre_id, film_id, ticket_link
  from (
    select
      coalesce(nullif(l->>'theatre_db_id', '')::bigint, nullif(theatre_id_map->>(l->>'theatre_key'), '')::bigint) as theatre_id,
      coalesce(nullif(l->>'film_db_id', '')::bigint, nullif(film_id_map->>(l->>'film_key'), '')::bigint) as film_id,
      nullif(trim(coalesce(l->>'ticket_link', '')), '') as ticket_link
    from jsonb_array_elements(coalesce(changes->'theatre_films'->'upsert', '[]'::jsonb)) l
  ) links
  where theatre_id is not null and film_id is not null and ticket_link is not null
  on conflict (theatre_id, film_id) do update set ticket_link = excluded.ticket_link;

  -- Showtimes, for the days sent. Each entry is one theatre, film and day, with text
  -- times ("7:00 PM"; unreadable ones are skipped, as the site does) and notes that can
  -- be tied to a time ("7:00 PM: Q&A"). If two entries give the same showtime, the first
  -- one wins. Existing rows are matched on theatre, film, start and premium, so they
  -- keep their id; rows of a sent day that the admin no longer has are deleted.
  with days as (
    select distinct
      coalesce(nullif(d->>'theatre_db_id', '')::bigint, nullif(theatre_id_map->>(d->>'theatre_key'), '')::bigint) as theatre_id,
      coalesce(nullif(d->>'film_db_id', '')::bigint, nullif(film_id_map->>(d->>'film_key'), '')::bigint) as film_id,
      (d->>'show_date')::date as show_date
    from jsonb_array_elements(coalesce(changes->'showings'->'days', '[]'::jsonb)) d
  ),
  entries as (
    select
      coalesce(nullif(entry->>'theatre_db_id', '')::bigint, nullif(theatre_id_map->>(entry->>'theatre_key'), '')::bigint) as theatre_id,
      coalesce(nullif(entry->>'film_db_id', '')::bigint, nullif(film_id_map->>(entry->>'film_key'), '')::bigint) as film_id,
      coalesce(
        nullif(festival_id_map->>(entry->>'festival_slug'), '')::bigint,
        (select f.id from festivals f where f.id = nullif(entry->>'festival_id', '')::bigint)
      ) as festival_id,
      (entry->>'show_date')::date as show_date,
      nullif(btrim(coalesce(entry->>'room', '')), '') as room,
      btrim(coalesce(entry->>'notes', '')) as notes,
      entry,
      entry_ord
    from jsonb_array_elements(coalesce(changes->'showings'->'entries', '[]'::jsonb)) with ordinality as e(entry, entry_ord)
  ),
  parsed as (
    select
      e.theatre_id, e.film_id, e.festival_id, e.show_date, e.room, e.notes, e.entry_ord,
      t.start_time,
      t.is_premium,
      (e.show_date + t.start_time) at time zone 'America/New_York' as starts_at
    from entries e
    join days d on d.theatre_id = e.theatre_id and d.film_id = e.film_id and d.show_date = e.show_date
    cross join lateral (
      select parse_show_time(raw) as start_time, false as is_premium
      from jsonb_array_elements_text(coalesce(e.entry->'times', '[]'::jsonb)) as x(raw)
      union all
      select parse_show_time(raw), true
      from jsonb_array_elements_text(coalesce(e.entry->'premium_times', '[]'::jsonb)) as x(raw)
    ) t
    where t.start_time is not null
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
    using days d
    where s.theatre_id = d.theatre_id and s.film_id = d.film_id and s.show_date = d.show_date
      and not exists (
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

  for item in select value from jsonb_array_elements(coalesce(changes->'promos'->'upsert', '[]'::jsonb))
  loop
    existing_id := nullif(item->>'db_id', '')::bigint;
    v_id := null;
    if existing_id is not null then
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
      );
    end if;
  end loop;

  -- As the full save did, every save clears out showtimes that have already started.
  delete from showtimes where starts_at < now();

  perform set_config('showtimes.in_full_save', 'off', true);
  update data_version set version = version + 1, changed_at = now() where id = 1
  returning version into current_version;
  return current_version;
end;
$$;

revoke all on function :"schema".apply_showtimes_changes(jsonb, bigint) from public;
grant execute on function :"schema".apply_showtimes_changes(jsonb, bigint) to authenticated, service_role;

commit;
