-- Drops `films.festival_only`. Nothing reads or writes it (the save function doesn't
-- set it) and every film had it false (checked on live, 2026-10-26).
-- Run against one schema at a time:
--   psql "$DATABASE_URL" -v schema=staging -f supabase/drop-festival-only.sql

\set ON_ERROR_STOP on

begin;

alter table :"schema".films drop column festival_only;

commit;
