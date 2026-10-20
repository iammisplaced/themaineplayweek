-- Adds `staging.showtimes`: one row per showtime, built from `staging.showings` (one row
-- per theatre, film and day, with text time arrays and a free-text note). This is the
-- shape the iOS app reads, and the shape the `showings` table itself is planned to move
-- to, so the app won't need to change when it does.
--
-- Only touches `staging`. The time and note parsing matches `to24HourTime` and
-- `getShowtimeNote` in js/shared.js.

begin;

-- "7:00 PM", "7pm", "7:00 p.m." or "19:00" -> 19:00. Null if it can't be read.
create or replace function staging.parse_show_time(value text)
returns time
language sql
immutable
set search_path = ''
as $$
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
$$;

-- The part of a showing's note that applies to one time: entries prefixed with that time
-- ("7:00 PM: Q&A") plus entries with no time prefix, joined with " · ". Null if none.
create or replace function staging.note_for_time(notes text, show_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(string_agg(part, ' · ' order by ord), '')
  from (
    select
      ord,
      case
        when timed is null then segment
        when staging.parse_show_time(timed[1]) = show_time then btrim(timed[2])
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
$$;

-- The first premium format named in a note, in the scrapers' spelling. Null if none.
create or replace function staging.format_from_note(note text)
returns text
language sql
immutable
set search_path = ''
as $$
  select format
  from unnest(array['3D', 'IMAX', 'ACX', 'ScreenX', 'FPX', '4K Laser', 'RPX', '4DX']) with ordinality as known(format, ord)
  where coalesce(note, '') ~* ('(^|[^[:alnum:]])' || format || '($|[^[:alnum:]])')
  order by ord
  limit 1
$$;

-- `id` identifies a showtime within one read. Like every other id it changes whenever
-- the admin saves, so don't keep it between launches.
create view staging.showtimes
with (security_invoker = true)
as
select
  s.id || '-' || to_char(t.start_time, 'HH24MI') || case when t.is_premium then 'p' else '' end as id,
  s.id as showing_id,
  s.theatre_id,
  s.film_id,
  s.festival_id,
  s.show_date,
  t.start_time,
  (s.show_date + t.start_time) at time zone 'America/New_York' as starts_at,
  t.is_premium,
  case when t.is_premium then coalesce(staging.format_from_note(n.note), 'Premium') end as format,
  n.note,
  nullif(btrim(s.room), '') as room,
  nullif(btrim(tf.ticket_link), '') as ticket_url
from staging.showings s
cross join lateral (
  select distinct on (start_time, is_premium) start_time, is_premium
  from (
    select staging.parse_show_time(raw) as start_time, false as is_premium from unnest(s.times) as raw
    union all
    select staging.parse_show_time(raw), true from unnest(s.premium_times) as raw
  ) parsed
  where start_time is not null
) t
cross join lateral (
  select case when btrim(s.notes) <> '' then staging.note_for_time(s.notes, t.start_time) end as note
) n
left join staging.theatre_films tf
  on tf.theatre_id = s.theatre_id
 and tf.film_id = s.film_id;

grant select on staging.showtimes to anon, authenticated, service_role;
grant execute on function staging.parse_show_time(text) to anon, authenticated, service_role;
grant execute on function staging.note_for_time(text, time) to anon, authenticated, service_role;
grant execute on function staging.format_from_note(text) to anon, authenticated, service_role;

commit;
