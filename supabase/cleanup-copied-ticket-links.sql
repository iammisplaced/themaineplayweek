-- Deletes ticket links that were copied from one theatre onto dozens of others (e.g.
-- blackbearcinemas.com/movie/the-bride on 37 theatres). They aren't shown anywhere now,
-- but if one of those theatres later added showtimes for that film without a link, the
-- site would offer the other theatre's tickets.
--
-- A row is deleted only when all three are true:
--   * the theatre has no showings of that film,
--   * the same film has the same link at 3 or more theatres,
--   * the link isn't on the theatre's own website domain.
-- Links on films that are playing, links shared by two sister theatres (Patriot and
-- Nickelodeon, Apple Saco and Westbrook) and links unique to one theatre are kept.
--
-- Run with the schema to clean, e.g.:
--   psql "$DATABASE_URL" -v schema=staging -f supabase/cleanup-copied-ticket-links.sql

\set ON_ERROR_STOP on

begin;

create temp table copied_links on commit drop as
select tf.theatre_id, tf.film_id, tf.ticket_link
from (
  select
    tf.*,
    count(*) over (partition by tf.film_id, tf.ticket_link) as theatres_with_link,
    substring(lower(substring(tf.ticket_link from '^(?:https?://)?([^/?#:]+)')) from '([^.]+\.[^.]+)$') as link_domain,
    substring(lower(substring(t.website from '^(?:https?://)?([^/?#:]+)')) from '([^.]+\.[^.]+)$') as theatre_domain
  from :"schema".theatre_films tf
  join :"schema".theatres t on t.id = tf.theatre_id
) tf
where tf.theatres_with_link >= 3
  and tf.link_domain is distinct from tf.theatre_domain
  and not exists (
    select 1 from :"schema".showings s
    where s.theatre_id = tf.theatre_id and s.film_id = tf.film_id
  );

select count(*) as rows_to_delete,
       count(distinct film_id) as films,
       count(distinct theatre_id) as theatres
from copied_links;

delete from :"schema".theatre_films tf
using copied_links c
where tf.theatre_id = c.theatre_id
  and tf.film_id = c.film_id;

select count(*) as theatre_films_rows_left from :"schema".theatre_films;

commit;
