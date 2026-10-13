# How the film quiz recommends a film

The quiz in `quiz/` (Go See a Movie) asks a few questions and picks one film playing in Maine. This file explains how it makes that pick. All of the logic is in `quiz/quiz.js`, mainly in `rankFilms`, `buildTasteProfile` and `scoreFilm`.

There's no AI or outside recommendation service. The quiz gives every film that's playing a points score from the answers and picks the highest.

## The data

On page load, the quiz reads these tables from Supabase (read-only):

- `films`: title, year, ticket link, staff favourite, Substack article, and the TMDb data (genres, director, stars, runtime, rating, vote count, release date, poster, synopsis)
- `theatres`: name, town and coordinates
- `theatre_films`: per-theatre ticket links
- `showings`: today onward only

## The questions

The full quiz asks six questions. **I'm Feeling Lucky** asks only the first two.

| Question | Options |
| --- | --- |
| Where are you? | Use my location, near a town (from your theatres' cities), or anywhere in Maine |
| When can you go? | Today, tomorrow, this weekend (Friday to Sunday) or any day this week (the next 7 days) |
| What do you usually like? | Any number of genres, or none |
| What are you in the mood for? | One of five moods, each tied to a set of genres (below) |
| Have you seen it? | Five well-known films, one at a time: Loved it, Not for me, or Haven't seen it |
| New or old? | New releases, classics and revivals, or either |

The genre list comes from the films in the database. TV Movie, Short, Short Film, Film Festival, Experimental and Nature are hidden.

The five "Have you seen it?" films are picked at random from films in the database with a poster and at least 2,000 TMDb votes, so people are likely to know them. The quiz tries to give each of the five a different main genre.

### Moods

| Mood | Genres it favours |
| --- | --- |
| Something light and fun | Comedy, Animation, Family, Romance, Music |
| On the edge of my seat | Thriller, Horror, Action, Mystery, Crime |
| Make me feel something | Drama, Romance, Music, History, War |
| Make me think | Documentary, Drama, Science Fiction, Mystery, History |
| Big-screen spectacle | Action, Adventure, Science Fiction, Fantasy, Animation |

## Step 1: Narrow to films you can actually see

1. Take every upcoming showtime, regular and premium. Drop anything starting within the next 10 minutes. If the same time is listed twice (for example "3:49pm" and "3:49 PM"), keep one, and keep the premium one if either is premium.
2. Keep only showtimes on the days you chose.
3. If you gave a location, keep theatres within 35 miles. If nothing is playing that close, widen to 70 miles, then 140.
4. Remove any film you rated in "Have you seen it?", whether you loved it or not.

## Step 2: Build a taste profile

Each genre gets a running score from your answers:

| Answer | Points per genre |
| --- | --- |
| A genre you picked | +1 |
| A genre tied to your mood | +0.6 |
| A genre of a film you loved | +0.5 |
| A genre of a film you said was "not for me" | −0.4 |

## Step 3: Score each film

| What it checks | Points |
| --- | --- |
| **Genre fit:** adds up the profile score for each of the film's genres, then divides by the square root of how many genres it has, so a film with many genres doesn't win by volume | varies |
| **Same director** as a film you loved | +1.5 |
| **Same actor** as a film you loved | +0.5 per actor |
| **Same director** as a film you disliked | −1 |
| **Asked for new:** released in the last 120 days | +0.8 |
| **Asked for new:** more than 10 years old | −0.6 |
| **Asked for classics:** 15 or more years old | +0.8 |
| **Asked for classics:** under 2 years old | −0.4 |
| **TMDb rating:** the rating out of 10, discounted when few people have voted (full weight at about 10,000 votes) | up to +0.8 |
| **Playweek staff favourite** | +0.3 |
| **Distance** to the nearest theatre showing it | up to −0.8 (at 96 miles or more) |
| **Randomness**, so starting over can give a different answer | up to +0.08 (up to +0.6 in I'm Feeling Lucky) |

The films are sorted by score. The top one is the pick, the next two are under "Also worth a look", and "Show me another" moves down the list.

Having a Substack article doesn't change a film's score. It only adds a link on the result.

## Step 4: Explain the pick

While scoring, the quiz records each reason that applied and shows the three strongest. In order of strength:

1. It's from [director], who directed [a film you loved].
2. [Actor] is in it, like in [a film you loved].
3. It's [genres], which you said you're into.
4. You loved [film], and this is cut from similar cloth. (Shares two or more genres.)
5. It's a Playweek staff favourite.
6. It's a new release, or it's a [decade]s film back on the big screen.
7. It fits [your mood].
8. It averages [rating] out of 10 on TMDb. (Only at 7.5 or higher, with 500 or more votes.)

## I'm Feeling Lucky

This mode asks only where and when, so there are no genre, mood, "seen it" or era answers. That leaves the TMDb rating, staff favourite and distance, and the randomness goes up to as much as 0.6 points. It leans toward well-rated films close to you but mixes them up a lot from one run to the next.

## The result page

- The film's title on the marquee, with the poster, director, runtime and rating
- The reasons, then the synopsis
- A link to the Substack article, if the film has `featured_on_playweek` set with a `featured_on_playweek_url`
- Showtimes at up to three theatres (nearest first, or earliest first with no location), up to three days each, with ticket links
- A link to the film's page on the main site
- Two runner-up films
- A footer linking to the main showtimes site, the Substack and Instagram

## Known weak spots

- **Films without TMDb data** have no genres, director or rating, so they score near zero and are rarely picked.
- **Names have to match exactly.** TMDb gives one director per film, so co-directors only match on whichever one is listed.
- **The weights are educated guesses** and haven't been tuned against real users. To change them, edit `buildTasteProfile` and `scoreFilm` in `quiz/quiz.js`, and update this file to match.
