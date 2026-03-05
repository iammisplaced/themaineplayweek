# Showtimes Starter

A showtimes website with three audience views:
- Films
- Theatres
- Dates

Data now supports Supabase as the primary backend, with JSON/local fallback.

## Files
- `index.html` - page structure
- `styles.css` - styling
- `app.js` - frontend logic + Supabase read/write + admin UI
- `data/showtimes.json` - fallback seed data
- `supabase/schema.sql` - Supabase tables + RLS policies
- `scripts/enrich-tmdb.mjs` - TMDb metadata enrichment script (local/offline workflow)

## Revert note (film card newspaper style)
- The "torn newspaper" film card treatment touches:
  - `styles.css` (`.group-card.film-card` block and related pseudo-elements)
  - `app.js` (adds `film-card` class in `render()` for films view cards)
- Fast rollback target (last commit before newspaper styling): `57c0f2a`
- To restore pre-newspaper look quickly:
  - `git checkout 57c0f2a -- app.js styles.css`

## Run locally

```bash
python3 -m http.server 8080
```

Open <http://localhost:8080>.

## Supabase setup (required for production admin)
1. In Supabase SQL editor, run `supabase/schema.sql`.
2. In Supabase Auth settings:
- enable Email provider
- enable Magic Link
- set site URL to your deployed URL (or local URL while testing)
3. Add at least one admin user in Supabase Auth (or allow self-serve signup if desired).
4. If you already set this up earlier, re-run `supabase/schema.sql` to install the latest transactional save function (`replace_showtimes_data`).

## Current Supabase config in app
`app.js` is configured with:
- URL: `https://rjfsjoratsfqcyyjseqm.supabase.co`
- anon key: your provided key

## Admin workflow (magic link)
1. Click `Admin`.
2. Enter email and click `Send Magic Link`.
3. Open email, click link, return to site.
4. Use search boxes to find and select theatre/film.
5. Use `+ Add Theatre` and `+ Add Film` modals for new entries.
6. `+ Add Film` creates that film across all theatres so it is available everywhere.
7. Set `Ticket Link (selected theatre + film)` for the current theatre/film pair (ticket links are not entered in Add Film modal).
8. Use `Refresh TMDb` to pull movie metadata for the selected film (needs film `tmdbId` + local TMDb key input).
9. Add showings with date + comma-separated times (optionally set number of days to auto-extend across consecutive dates).
10. Click `Save All Changes` to push to Supabase.

## Fallback behavior
- On load, app tries Supabase first.
- If Supabase is unavailable or empty, app falls back to:
1. `localStorage` draft data
2. `data/showtimes.json`

This keeps the app usable during transition/deployment issues.

## Data shape (app-level)

```json
{
  "theatreGroups": [
    {
      "name": "Theatre Name",
      "city": "City",
      "address": "Street, City, ST ZIP",
      "website": "https://example.com",
      "films": [
        {
          "title": "Film Title",
          "year": 2026,
          "tmdbId": 12345,
          "ticketLink": "https://tickets.example.com/theatre/film",
          "tmdb": {
            "posterUrl": "https://image.tmdb.org/t/p/w342/abc123.jpg",
            "director": "Director Name",
            "stars": ["Star 1", "Star 2", "Star 3"],
            "genres": ["Drama", "Mystery"]
          },
          "showings": [
            {
              "date": "2026-03-04",
              "times": ["7:00 PM", "9:30 PM"]
            }
          ]
        }
      ]
    }
  ]
}
```

Showtimes in the past (date+time) are hidden automatically.

## Schema update note
Ticket links are theatre-specific. Re-run `supabase/schema.sql` so `public.theatre_films` exists.

If you see `DELETE requires a WHERE clause`, re-run `supabase/schema.sql` to install the updated `replace_showtimes_data` function.
