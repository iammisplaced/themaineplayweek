-- Creates the `staging` schema: a copy of the live `public` tables, data, row-level
-- security, grants, trigger and save functions, for trying out changes before they go
-- live. Generated from the live database on 2026-10-20 (not from ../schema.sql, which
-- has drifted from live before).
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
create table staging.showings (like public.showings including all);
create table staging.festival_films (like public.festival_films including all);
create table staging.promos (like public.promos including all);

-- Foreign keys (LIKE doesn't copy them).
alter table staging.theatre_films
  add constraint theatre_films_theatre_id_fkey foreign key (theatre_id) references staging.theatres(id) on delete cascade,
  add constraint theatre_films_film_id_fkey foreign key (film_id) references staging.films(id) on delete cascade;
alter table staging.showings
  add constraint showings_theatre_id_fkey foreign key (theatre_id) references staging.theatres(id) on delete cascade,
  add constraint showings_film_id_fkey foreign key (film_id) references staging.films(id) on delete cascade,
  add constraint showings_festival_id_fkey foreign key (festival_id) references staging.festivals(id) on delete set null;
alter table staging.festival_films
  add constraint festival_films_festival_id_fkey foreign key (festival_id) references staging.festivals(id) on delete cascade,
  add constraint festival_films_film_id_fkey foreign key (film_id) references staging.films(id) on delete cascade;

-- Data, keeping the live ids so rows can be compared with live.
insert into staging.theatres overriding system value select * from public.theatres;
insert into staging.films overriding system value select * from public.films;
insert into staging.festivals overriding system value select * from public.festivals;
insert into staging.theatre_films select * from public.theatre_films;
insert into staging.showings overriding system value select * from public.showings;
insert into staging.festival_films select * from public.festival_films;
insert into staging.promos overriding system value select * from public.promos;

-- Continue the id sequences after the copied rows.
select setval(pg_get_serial_sequence('staging.theatres', 'id'), coalesce((select max(id) from staging.theatres), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.films', 'id'), coalesce((select max(id) from staging.films), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.festivals', 'id'), coalesce((select max(id) from staging.festivals), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.showings', 'id'), coalesce((select max(id) from staging.showings), 0) + 1, false);
select setval(pg_get_serial_sequence('staging.promos', 'id'), coalesce((select max(id) from staging.promos), 0) + 1, false);

-- Row-level security and policies, as on live: anyone can read, signed-in admins can write.
do $$
declare
  t text;
begin
  foreach t in array array['theatres', 'films', 'festivals', 'theatre_films', 'showings', 'festival_films', 'promos']
  loop
    execute format('alter table staging.%I enable row level security', t);
    execute format('create policy %I on staging.%I for select using (true)', 'Public read ' || t, t);
    execute format('create policy %I on staging.%I for all to authenticated using (true) with check (true)', 'Auth write ' || t, t);
  end loop;
end $$;

-- Grants, as on live (row-level security above is what limits anon).
grant all on all tables in schema staging to anon, authenticated, service_role;
grant all on all sequences in schema staging to anon, authenticated, service_role;

-- Functions and trigger, copied from live with `public` replaced by `staging`.

CREATE OR REPLACE FUNCTION staging.normalize_showings_festival_fk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.festival_id is not null
     and not exists (
       select 1
       from staging.festivals f
       where f.id = new.festival_id
     ) then
    new.festival_id := null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION staging.replace_showtimes_data(payload jsonb, allow_ticket_link_clear boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'staging'
AS $function$declare
  festival_item jsonb;
  theatre_item jsonb;
  film_item jsonb;
  theatre_film_item jsonb;
  showing_item jsonb;
  promo_item jsonb;
  festival_id_map jsonb := '{}'::jsonb;
  theatre_id_map jsonb := '{}'::jsonb;
  film_id_map jsonb := '{}'::jsonb;
  v_festival_id bigint;
  v_theatre_id bigint;
  v_film_id bigint;
  festival_key text;
  theatre_key text;
  film_key text;
  risky_ticket_link_clears integer := 0;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;
  if payload is null then
    raise exception 'Payload is required';
  end if;
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
      join payload_theatres pt
        on pt.theatre_key = link_item->>'theatre_key'
      join payload_films pf
        on pf.film_key = link_item->>'film_key'
    ),
    payload_non_empty_by_id as (
      select distinct theatre_db_id, film_db_id
      from payload_links
      where theatre_db_id is not null
        and film_db_id is not null
        and ticket_link is not null
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
      from staging.theatre_films tf
      join staging.theatres t
        on t.id = tf.theatre_id
      join staging.films f
        on f.id = tf.film_id
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
  delete from staging.showings where true;
  delete from staging.festival_films where true;
  delete from staging.theatre_films where true;
  delete from staging.theatres where true;
  delete from staging.films where true;
  delete from staging.festivals where true;
  delete from staging.promos where true;
  for festival_item in
    select value from jsonb_array_elements(coalesce(payload->'festivals', '[]'::jsonb))
  loop
    insert into staging.festivals (
      slug,
      name,
      description,
      website,
      primary_color,
      start_date,
      end_date,
      enabled,
      sort_order
    )
    values (
      coalesce(festival_item->>'slug', ''),
      coalesce(festival_item->>'name', ''),
      coalesce(festival_item->>'description', ''),
      coalesce(festival_item->>'website', ''),
      coalesce(festival_item->>'primary_color', ''),
      nullif(festival_item->>'start_date', '')::date,
      nullif(festival_item->>'end_date', '')::date,
      coalesce((festival_item->>'enabled')::boolean, true),
      coalesce((festival_item->>'sort_order')::integer, 0)
    )
    returning id into v_festival_id;
    festival_key := coalesce(festival_item->>'slug', '');
    if festival_key <> '' then
      festival_id_map := festival_id_map || jsonb_build_object(festival_key, v_festival_id);
    end if;
  end loop;
  for theatre_item in
    select value from jsonb_array_elements(coalesce(payload->'theatres', '[]'::jsonb))
  loop
    insert into staging.theatres (name, city, address, website, latitude, longitude)
    values (
      coalesce(theatre_item->>'name', ''),
      coalesce(theatre_item->>'city', ''),
      coalesce(theatre_item->>'address', ''),
      coalesce(theatre_item->>'website', ''),
      nullif(theatre_item->>'latitude', '')::double precision,
      nullif(theatre_item->>'longitude', '')::double precision
    )
    returning id into v_theatre_id;
    theatre_key := theatre_item->>'key';
    theatre_id_map := theatre_id_map || jsonb_build_object(theatre_key, v_theatre_id);
  end loop;
  for film_item in
    select value from jsonb_array_elements(coalesce(payload->'films', '[]'::jsonb))
  loop
    insert into staging.films (
      title,
      year,
      tmdb_id,
      synopsis,
      metadata_source,
      ticket_link,
      staff_favorite,
      staff_favorite_by,
      featured_on_playweek,
      featured_on_playweek_url,
      ranking_override,
      tmdb_json
    )
    values (
      coalesce(film_item->>'title', ''),
      nullif(film_item->>'year', '')::integer,
      nullif(film_item->>'tmdb_id', '')::bigint,
      coalesce(nullif(film_item->>'synopsis', ''), nullif(film_item->'tmdb_json'->>'overview', ''), ''),
      case lower(trim(coalesce(film_item->>'metadata_source', '')))
        when 'tmdb' then 'tmdb'
        when 'manual' then 'manual'
        else case
          when nullif(film_item->>'tmdb_id', '') is not null then 'tmdb'
          else 'manual'
        end
      end,
      coalesce(film_item->>'ticket_link', ''),
      coalesce((film_item->>'staff_favorite')::boolean, false),
      coalesce(film_item->>'staff_favorite_by', ''),
      coalesce((film_item->>'featured_on_playweek')::boolean, false),
      coalesce(film_item->>'featured_on_playweek_url', ''),
      coalesce((film_item->>'ranking_override')::boolean, false),
      film_item->'tmdb_json'
    )
    returning id into v_film_id;
    film_key := film_item->>'key';
    film_id_map := film_id_map || jsonb_build_object(film_key, v_film_id);
  end loop;
  for theatre_film_item in
    select value from jsonb_array_elements(coalesce(payload->'theatre_films', '[]'::jsonb))
  loop
    v_theatre_id := nullif(theatre_id_map->>(theatre_film_item->>'theatre_key'), '')::bigint;
    v_film_id := nullif(film_id_map->>(theatre_film_item->>'film_key'), '')::bigint;
    if v_theatre_id is not null
       and v_film_id is not null
       and nullif(trim(coalesce(theatre_film_item->>'ticket_link', '')), '') is not null then
      insert into staging.theatre_films (theatre_id, film_id, ticket_link)
      values (v_theatre_id, v_film_id, coalesce(theatre_film_item->>'ticket_link', ''));
    end if;
  end loop;
  for showing_item in
    select value from jsonb_array_elements(coalesce(payload->'showings', '[]'::jsonb))
  loop
    v_theatre_id := nullif(theatre_id_map->>(showing_item->>'theatre_key'), '')::bigint;
    v_film_id := nullif(film_id_map->>(showing_item->>'film_key'), '')::bigint;
    if v_theatre_id is not null and v_film_id is not null then
      insert into staging.showings (theatre_id, film_id, festival_id, show_date, room, notes, times, premium_times)
      values (
        v_theatre_id,
        v_film_id,
        coalesce(
          nullif(festival_id_map->>(showing_item->>'festival_slug'), '')::bigint,
          (
            select f.id
            from staging.festivals f
            where f.id = nullif(showing_item->>'festival_id', '')::bigint
            limit 1
          ),
          null
        ),
        (showing_item->>'show_date')::date,
        coalesce(showing_item->>'room', ''),
        coalesce(showing_item->>'notes', ''), 
        array(select jsonb_array_elements_text(coalesce(showing_item->'times', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(showing_item->'premium_times', '[]'::jsonb)))
      );
    end if;
  end loop;
  insert into staging.festival_films (festival_id, film_id)
  select distinct s.festival_id, s.film_id
  from staging.showings s
  where s.festival_id is not null;
  for promo_item in
    select value from jsonb_array_elements(coalesce(payload->'promos', '[]'::jsonb))
  loop
    insert into staging.promos (
      title,
      button_url,
      image_path,
      image_alt,
      image_name,
      button_label,
      enabled,
      sort_order
    )
    values (
      coalesce(promo_item->>'title', ''),
      coalesce(promo_item->>'button_url', ''),
      coalesce(promo_item->>'image_path', ''),
      coalesce(promo_item->>'image_alt', ''),
      coalesce(promo_item->>'image_name', ''),
      coalesce(promo_item->>'button_label', 'Shop Now'),
      coalesce((promo_item->>'enabled')::boolean, true),
      coalesce((promo_item->>'sort_order')::integer, 0)
    );
  end loop;
end;$function$;

CREATE OR REPLACE FUNCTION staging.apply_showtimes_delta(payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'staging'
AS $function$
declare
  festival_item jsonb;
  theatre_item jsonb;
  film_item jsonb;
  theatre_film_item jsonb;
  showing_pair_item jsonb;
  showing_item jsonb;
  promo_item jsonb;
  delete_id_item jsonb;
  festival_id_map jsonb := '{}'::jsonb;
  theatre_id_map jsonb := '{}'::jsonb;
  film_id_map jsonb := '{}'::jsonb;
  v_festival_id bigint;
  v_theatre_id bigint;
  v_film_id bigint;
  promo_id bigint;
  resolved_theatre_id bigint;
  resolved_film_id bigint;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;
  if payload is null then
    raise exception 'Payload is required';
  end if;
  for festival_item in
    select value from jsonb_array_elements(coalesce(payload->'festivals_upsert', '[]'::jsonb))
  loop
    v_festival_id := null;
    if nullif(festival_item->>'id', '') is not null then
      update staging.festivals
      set
        slug = coalesce(festival_item->>'slug', ''),
        name = coalesce(festival_item->>'name', ''),
        description = coalesce(festival_item->>'description', ''),
        website = coalesce(festival_item->>'website', ''),
        primary_color = coalesce(festival_item->>'primary_color', ''),
        start_date = nullif(festival_item->>'start_date', '')::date,
        end_date = nullif(festival_item->>'end_date', '')::date,
        enabled = coalesce((festival_item->>'enabled')::boolean, true),
        sort_order = coalesce((festival_item->>'sort_order')::integer, 0)
      where id = nullif(festival_item->>'id', '')::bigint
      returning id into v_festival_id;
    end if;
    if v_festival_id is null then
      insert into staging.festivals (
        slug,
        name,
        description,
        website,
        primary_color,
        start_date,
        end_date,
        enabled,
        sort_order
      )
      values (
        coalesce(festival_item->>'slug', ''),
        coalesce(festival_item->>'name', ''),
        coalesce(festival_item->>'description', ''),
        coalesce(festival_item->>'website', ''),
        coalesce(festival_item->>'primary_color', ''),
        nullif(festival_item->>'start_date', '')::date,
        nullif(festival_item->>'end_date', '')::date,
        coalesce((festival_item->>'enabled')::boolean, true),
        coalesce((festival_item->>'sort_order')::integer, 0)
      )
      returning id into v_festival_id;
    end if;
    if nullif(festival_item->>'slug', '') is not null then
      festival_id_map := festival_id_map || jsonb_build_object(festival_item->>'slug', v_festival_id);
    end if;
  end loop;
  for delete_id_item in
    select value from jsonb_array_elements(coalesce(payload->'festivals_delete_ids', '[]'::jsonb))
  loop
    delete from staging.festivals where id = (delete_id_item #>> '{}')::bigint;
  end loop;
  for theatre_item in
    select value from jsonb_array_elements(coalesce(payload->'theatres_upsert', '[]'::jsonb))
  loop
    v_theatre_id := null;
    if nullif(theatre_item->>'db_id', '') is not null then
      update staging.theatres
      set
        name = coalesce(theatre_item->>'name', ''),
        city = coalesce(theatre_item->>'city', ''),
        address = coalesce(theatre_item->>'address', ''),
        website = coalesce(theatre_item->>'website', ''),
        latitude = nullif(theatre_item->>'latitude', '')::double precision,
        longitude = nullif(theatre_item->>'longitude', '')::double precision
      where id = nullif(theatre_item->>'db_id', '')::bigint
      returning id into v_theatre_id;
    end if;
    if v_theatre_id is null then
      insert into staging.theatres (name, city, address, website, latitude, longitude)
      values (
        coalesce(theatre_item->>'name', ''),
        coalesce(theatre_item->>'city', ''),
        coalesce(theatre_item->>'address', ''),
        coalesce(theatre_item->>'website', ''),
        nullif(theatre_item->>'latitude', '')::double precision,
        nullif(theatre_item->>'longitude', '')::double precision
      )
      returning id into v_theatre_id;
    end if;
    if nullif(theatre_item->>'key', '') is not null then
      theatre_id_map := theatre_id_map || jsonb_build_object(theatre_item->>'key', v_theatre_id);
    end if;
  end loop;
  for film_item in
    select value from jsonb_array_elements(coalesce(payload->'films_upsert', '[]'::jsonb))
  loop
    v_film_id := null;
    if nullif(film_item->>'db_id', '') is not null then
      update staging.films
      set
        title = coalesce(film_item->>'title', ''),
        year = nullif(film_item->>'year', '')::integer,
        tmdb_id = nullif(film_item->>'tmdb_id', '')::bigint,
        synopsis = coalesce(nullif(film_item->>'synopsis', ''), nullif(film_item->'tmdb_json'->>'overview', ''), ''),
        metadata_source = case lower(trim(coalesce(film_item->>'metadata_source', '')))
          when 'tmdb' then 'tmdb'
          when 'manual' then 'manual'
          else case
            when nullif(film_item->>'tmdb_id', '') is not null then 'tmdb'
            else 'manual'
          end
        end,
        ticket_link = coalesce(film_item->>'ticket_link', ''),
        staff_favorite = coalesce((film_item->>'staff_favorite')::boolean, false),
        staff_favorite_by = coalesce(film_item->>'staff_favorite_by', ''),
        featured_on_playweek = coalesce((film_item->>'featured_on_playweek')::boolean, false),
        featured_on_playweek_url = coalesce(film_item->>'featured_on_playweek_url', ''),
        ranking_override = coalesce((film_item->>'ranking_override')::boolean, false),
        tmdb_json = film_item->'tmdb_json'
      where id = nullif(film_item->>'db_id', '')::bigint
      returning id into v_film_id;
    end if;
    if v_film_id is null then
      insert into staging.films (
        title,
        year,
        tmdb_id,
        synopsis,
        metadata_source,
        ticket_link,
        staff_favorite,
        staff_favorite_by,
        featured_on_playweek,
        featured_on_playweek_url,
        ranking_override,
        tmdb_json
      )
      values (
        coalesce(film_item->>'title', ''),
        nullif(film_item->>'year', '')::integer,
        nullif(film_item->>'tmdb_id', '')::bigint,
        coalesce(nullif(film_item->>'synopsis', ''), nullif(film_item->'tmdb_json'->>'overview', ''), ''),
        case lower(trim(coalesce(film_item->>'metadata_source', '')))
          when 'tmdb' then 'tmdb'
          when 'manual' then 'manual'
          else case
            when nullif(film_item->>'tmdb_id', '') is not null then 'tmdb'
            else 'manual'
          end
        end,
        coalesce(film_item->>'ticket_link', ''),
        coalesce((film_item->>'staff_favorite')::boolean, false),
        coalesce(film_item->>'staff_favorite_by', ''),
        coalesce((film_item->>'featured_on_playweek')::boolean, false),
        coalesce(film_item->>'featured_on_playweek_url', ''),
        coalesce((film_item->>'ranking_override')::boolean, false),
        film_item->'tmdb_json'
      )
      returning id into v_film_id;
    end if;
    if nullif(film_item->>'key', '') is not null then
      film_id_map := film_id_map || jsonb_build_object(film_item->>'key', v_film_id);
    end if;
  end loop;
  for theatre_film_item in
    select value from jsonb_array_elements(coalesce(payload->'theatre_films_delete', '[]'::jsonb))
  loop
    resolved_theatre_id := nullif(theatre_film_item->>'theatre_db_id', '')::bigint;
    resolved_film_id := nullif(theatre_film_item->>'film_db_id', '')::bigint;
    if resolved_theatre_id is not null and resolved_film_id is not null then
      delete from staging.theatre_films
      where theatre_id = resolved_theatre_id
        and film_id = resolved_film_id;
    end if;
  end loop;
  for theatre_film_item in
    select value from jsonb_array_elements(coalesce(payload->'theatre_films_upsert', '[]'::jsonb))
  loop
    resolved_theatre_id := coalesce(
      nullif(theatre_film_item->>'theatre_db_id', '')::bigint,
      nullif(theatre_id_map->>(theatre_film_item->>'theatre_key'), '')::bigint
    );
    resolved_film_id := coalesce(
      nullif(theatre_film_item->>'film_db_id', '')::bigint,
      nullif(film_id_map->>(theatre_film_item->>'film_key'), '')::bigint
    );
    if resolved_theatre_id is not null
       and resolved_film_id is not null
       and nullif(trim(coalesce(theatre_film_item->>'ticket_link', '')), '') is not null then
      insert into staging.theatre_films (theatre_id, film_id, ticket_link)
      values (resolved_theatre_id, resolved_film_id, coalesce(theatre_film_item->>'ticket_link', ''))
      on conflict (theatre_id, film_id)
      do update set ticket_link = excluded.ticket_link;
    end if;
  end loop;
  for showing_pair_item in
    select value from jsonb_array_elements(coalesce(payload->'showings_replace_pairs', '[]'::jsonb))
  loop
    resolved_theatre_id := coalesce(
      nullif(showing_pair_item->>'theatre_db_id', '')::bigint,
      nullif(theatre_id_map->>(showing_pair_item->>'theatre_key'), '')::bigint
    );
    resolved_film_id := coalesce(
      nullif(showing_pair_item->>'film_db_id', '')::bigint,
      nullif(film_id_map->>(showing_pair_item->>'film_key'), '')::bigint
    );
    if resolved_theatre_id is not null and resolved_film_id is not null then
      delete from staging.showings
      where theatre_id = resolved_theatre_id
        and film_id = resolved_film_id;
    end if;
  end loop;
  for showing_item in
    select value from jsonb_array_elements(coalesce(payload->'showings_upsert', '[]'::jsonb))
  loop
    resolved_theatre_id := coalesce(
      nullif(showing_item->>'theatre_db_id', '')::bigint,
      nullif(theatre_id_map->>(showing_item->>'theatre_key'), '')::bigint
    );
    resolved_film_id := coalesce(
      nullif(showing_item->>'film_db_id', '')::bigint,
      nullif(film_id_map->>(showing_item->>'film_key'), '')::bigint
    );
    if resolved_theatre_id is not null and resolved_film_id is not null then
      insert into staging.showings (theatre_id, film_id, festival_id, show_date, room, times, premium_times)
      values (
        resolved_theatre_id,
        resolved_film_id,
        coalesce(
          nullif(festival_id_map->>(showing_item->>'festival_slug'), '')::bigint,
          (
            select f.id
            from staging.festivals f
            where f.id = nullif(showing_item->>'festival_id', '')::bigint
            limit 1
          ),
          null
        ),
        (showing_item->>'show_date')::date,
        coalesce(showing_item->>'room', ''),
        array(select jsonb_array_elements_text(coalesce(showing_item->'times', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(showing_item->'premium_times', '[]'::jsonb)))
      );
    end if;
  end loop;
  delete from staging.festival_films where true;
  insert into staging.festival_films (festival_id, film_id)
  select distinct s.festival_id, s.film_id
  from staging.showings s
  where s.festival_id is not null;
  for delete_id_item in
    select value from jsonb_array_elements(coalesce(payload->'promos_delete_ids', '[]'::jsonb))
  loop
    delete from staging.promos where id = (delete_id_item #>> '{}')::bigint;
  end loop;
  for promo_item in
    select value from jsonb_array_elements(coalesce(payload->'promos_upsert', '[]'::jsonb))
  loop
    promo_id := null;
    if nullif(promo_item->>'db_id', '') is not null then
      update staging.promos
      set
        title = coalesce(promo_item->>'title', ''),
        button_url = coalesce(promo_item->>'button_url', ''),
        image_path = coalesce(promo_item->>'image_path', ''),
        image_alt = coalesce(promo_item->>'image_alt', ''),
        image_name = coalesce(promo_item->>'image_name', ''),
        button_label = coalesce(promo_item->>'button_label', 'Shop Now'),
        enabled = coalesce((promo_item->>'enabled')::boolean, true),
        sort_order = coalesce((promo_item->>'sort_order')::integer, 0)
      where id = nullif(promo_item->>'db_id', '')::bigint
      returning id into promo_id;
    end if;
    if promo_id is null then
      insert into staging.promos (
        title,
        button_url,
        image_path,
        image_alt,
        image_name,
        button_label,
        enabled,
        sort_order
      )
      values (
        coalesce(promo_item->>'title', ''),
        coalesce(promo_item->>'button_url', ''),
        coalesce(promo_item->>'image_path', ''),
        coalesce(promo_item->>'image_alt', ''),
        coalesce(promo_item->>'image_name', ''),
        coalesce(promo_item->>'button_label', 'Shop Now'),
        coalesce((promo_item->>'enabled')::boolean, true),
        coalesce((promo_item->>'sort_order')::integer, 0)
      );
    end if;
  end loop;
  for delete_id_item in
    select value from jsonb_array_elements(coalesce(payload->'films_delete_ids', '[]'::jsonb))
  loop
    delete from staging.films where id = (delete_id_item #>> '{}')::bigint;
  end loop;
  for delete_id_item in
    select value from jsonb_array_elements(coalesce(payload->'theatres_delete_ids', '[]'::jsonb))
  loop
    delete from staging.theatres where id = (delete_id_item #>> '{}')::bigint;
  end loop;
end;
$function$;

create trigger trg_normalize_showings_festival_fk
  before insert or update on staging.showings
  for each row execute function staging.normalize_showings_festival_fk();

revoke all on function staging.replace_showtimes_data(jsonb, boolean) from public;
revoke all on function staging.apply_showtimes_delta(jsonb) from public;
grant execute on function staging.replace_showtimes_data(jsonb, boolean) to authenticated, service_role;
grant execute on function staging.apply_showtimes_delta(jsonb) to authenticated, service_role;

commit;
