-- Makes admin saves keep row ids, and refuses saves that are stale or would delete
-- a lot at once. Run against one schema at a time:
--   psql "$DATABASE_URL" -v schema=staging -f supabase/stable-ids.sql
--
-- * data_version: a counter that goes up whenever the showtimes tables change (admin
--   saves, the films page, the TMDb refresh Action). The admin sends the version it
--   loaded, and replace_showtimes_data refuses the save if it has changed since, so an
--   old tab can't undo someone else's changes.
-- * replace_showtimes_data still receives the admin's complete data, but updates
--   theatres, films, festivals and promos by id instead of deleting and re-inserting
--   them. Showings, ticket links and festival_films are still rewritten on every save.
--   It also refuses saves that would delete more than 10 films, 3 theatres or
--   2 festivals, and now returns the new data version.
-- * apply_showtimes_delta is dropped: it could save showings separately from their
--   films, which wiped every showtime in March 2026.
--
-- Safe to run while the current site is live: the old admin calls
-- replace_showtimes_data(payload, allow_ticket_link_clear) and ignores the result, and
-- that call still works (expected_version defaults to null, which skips the check).

\set ON_ERROR_STOP on

begin;

create table if not exists :"schema".data_version (
  id integer primary key default 1 check (id = 1),
  version bigint not null default 1,
  changed_at timestamptz not null default now()
);
insert into :"schema".data_version (id) values (1) on conflict (id) do nothing;

alter table :"schema".data_version enable row level security;
drop policy if exists "Public read data_version" on :"schema".data_version;
create policy "Public read data_version" on :"schema".data_version for select using (true);
revoke all on :"schema".data_version from anon, authenticated;
grant select on :"schema".data_version to anon, authenticated;
grant all on :"schema".data_version to service_role;

-- Bumps the version once per changing statement, except inside replace_showtimes_data,
-- which bumps it once at the end.
create or replace function :"schema".bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = :'schema'
as $$
begin
  if coalesce(current_setting('showtimes.in_full_save', true), '') = 'on' then
    return null;
  end if;
  update data_version set version = version + 1, changed_at = now() where id = 1;
  return null;
end;
$$;
revoke all on function :"schema".bump_data_version() from public;

select set_config('showtimes.target_schema', :'schema', true);

do $$
declare
  t text;
begin
  foreach t in array array['theatres', 'films', 'festivals', 'theatre_films', 'showings', 'festival_films', 'promos']
  loop
    execute format('drop trigger if exists trg_bump_data_version on %I.%I', current_setting('showtimes.target_schema'), t);
    execute format(
      'create trigger trg_bump_data_version after insert or update or delete on %I.%I for each statement execute function %I.bump_data_version()',
      current_setting('showtimes.target_schema'), t, current_setting('showtimes.target_schema')
    );
  end loop;
end $$;

drop function if exists :"schema".apply_showtimes_delta(jsonb);
drop function if exists :"schema".replace_showtimes_data(jsonb, boolean);

create function :"schema".replace_showtimes_data(
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
  delete from showings where true;
  delete from festival_films where true;
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
        ticket_link = coalesce(item->>'ticket_link', ''),
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
        title, year, tmdb_id, synopsis, metadata_source, ticket_link, staff_favorite, staff_favorite_by,
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
        coalesce(item->>'ticket_link', ''),
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

  for item in select value from jsonb_array_elements(coalesce(payload->'showings', '[]'::jsonb))
  loop
    v_theatre_id := nullif(theatre_id_map->>(item->>'theatre_key'), '')::bigint;
    v_film_id := nullif(film_id_map->>(item->>'film_key'), '')::bigint;
    if v_theatre_id is not null and v_film_id is not null then
      insert into showings (theatre_id, film_id, festival_id, show_date, room, notes, times, premium_times)
      values (
        v_theatre_id,
        v_film_id,
        coalesce(
          nullif(festival_id_map->>(item->>'festival_slug'), '')::bigint,
          (select f.id from festivals f where f.id = nullif(item->>'festival_id', '')::bigint)
        ),
        (item->>'show_date')::date,
        coalesce(item->>'room', ''),
        coalesce(item->>'notes', ''),
        array(select jsonb_array_elements_text(coalesce(item->'times', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(item->'premium_times', '[]'::jsonb)))
      );
    end if;
  end loop;

  insert into festival_films (festival_id, film_id)
  select distinct s.festival_id, s.film_id
  from showings s
  where s.festival_id is not null;

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

commit;
