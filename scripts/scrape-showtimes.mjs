import { formatShowtimesCsv, launchBrowser, prompt, sleep, writeCsvToRepoRoot } from './lib/scraper-utils.mjs';

async function clickDateButton(page, dayOfMonth) {
  return await page.evaluate((day) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const dayStr = String(day);

    // Look for button with text like "Thu24", "Fri25", etc that contains the day number
    const dayButton = buttons.find(btn => {
      const text = btn.textContent.trim();
      // Match buttons that have the day number at the end (e.g., "Thu24", "Oct1")
      return text.endsWith(dayStr) && text.match(/^[A-Z][a-z]+\d+$|^[A-Z][a-z]+\s*\d+$|^Today\d+$/);
    });

    if (dayButton) {
      dayButton.click();
      return true;
    }

    return false;
  }, dayOfMonth);
}

async function scrapeShowtimes() {
  let browser;
  try {
    // Get input from user
    console.log('=== Regal Cinemas Showtimes Scraper ===\n');
    const theatreUrl = await prompt('Enter theatre URL (e.g., https://www.regmovies.com/theatres/regal-augusta-1704):\n> ');
    const theatreName = await prompt('\nEnter theatre name (e.g., Regal Cinemas):\n> ');
    const theatreCity = await prompt('Enter theatre city (e.g., Augusta):\n> ');
    const fetchYears = (await prompt('\nFetch film years from Regal? (y/n, slower but more complete):\n> ')).toLowerCase() === 'y';

    if (!theatreUrl || !theatreName || !theatreCity) {
      throw new Error('All fields are required');
    }

    console.log(`\nStarting scrape for ${theatreName}, ${theatreCity}...`);
    console.log(`URL: ${theatreUrl}`);
    console.log(`Fetch years: ${fetchYears ? 'yes' : 'no'}\n`);

    let page;
    ({ browser, page } = await launchBrowser());

    console.log('Navigating to theatre page...');
    await page.goto(theatreUrl, {
      waitUntil: 'networkidle2',
    });

    console.log('Scraping showtimes for the next 7 days...\n');

    const allShowtimesData = [];
    const filmYearsCache = {};

    // Collect data for each of the next 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const isoDate = targetDate.toISOString().split('T')[0];
      const dateDisplay = targetDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      console.log(`Day ${dayOffset + 1}: ${dateDisplay} (${isoDate})`);

      // For day 0, showtimes are already loaded
      // For subsequent days, click the date button to move to next day
      if (dayOffset > 0) {
        const dayOfMonth = targetDate.getDate();
        const success = await clickDateButton(page, dayOfMonth);
        if (!success) {
          console.log('  Warning: Could not click date button');
        }
        // Wait for page to load new content
        await sleep(1000);
      }

      // Extract showtimes for current date
      const showtimes = await extractShowtimesForDate(page, isoDate);
      console.log(`  Found ${showtimes.length} movies`);

      // If we got the same movies as the previous day with same times, something went wrong
      if (dayOffset > 0 && allShowtimesData.length > 0) {
        const prevDayMovies = allShowtimesData.filter(s => {
          const prevDate = new Date(s.date);
          prevDate.setDate(prevDate.getDate() + 1);
          return prevDate.toISOString().split('T')[0] === isoDate;
        });

        if (prevDayMovies.length > 0 && prevDayMovies.length === showtimes.length) {
          const sameMovies = prevDayMovies.every(prev =>
            showtimes.some(curr =>
              curr.title === prev.title && curr.times.join('|') === prev.times.join('|')
            )
          );

          if (sameMovies) {
            console.log('  ERROR: Same movies as previous day! Date navigation may not be working.');
            console.log('  Stopping here to avoid duplicate data.');
            break;
          }
        }
      }

      // Fetch years if requested
      if (fetchYears && showtimes.length > 0) {
        console.log(`  Fetching film years...`);
        for (const showing of showtimes) {
          if (!filmYearsCache[showing.title]) {
            const year = await fetchFilmYear(page, showing.title);
            filmYearsCache[showing.title] = year;
          }
          showing.year = filmYearsCache[showing.title];
        }
      }

      allShowtimesData.push(...showtimes);

      // If no showtimes found, we've probably reached the end
      if (showtimes.length === 0) {
        console.log('  No showtimes found, stopping');
        break;
      }
    }

    console.log(`\nTotal showings: ${allShowtimesData.length}\n`);

    if (allShowtimesData.length === 0) {
      throw new Error('No showtimes data extracted from the page');
    }

    // Format as CSV
    const csv = formatShowtimesCsv(allShowtimesData, theatreName, theatreCity);

    // Generate filename based on theatre
    const filename = `scraped-${theatreCity.toLowerCase().replace(/\s+/g, '-')}-showtimes.csv`;
    writeCsvToRepoRoot(filename, csv);
    console.log(`Saved to ${filename}\n`);

    // Show summary by date
    const byDate = {};
    allShowtimesData.forEach(s => {
      byDate[s.date] = (byDate[s.date] || 0) + 1;
    });
    console.log('Summary by date:');
    Object.entries(byDate).sort().forEach(([date, count]) => {
      console.log(`  ${date}: ${count} movies`);
    });

    console.log('\nPreview (first 30 rows):');
    console.log(csv.split('\n').slice(0, 30).join('\n'));

    return allShowtimesData;
  } catch (error) {
    console.error('Scraping failed:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function extractShowtimesForDate(page, isoDate) {
  return await page.evaluate((dateStr) => {
    const timeToMinutes = (timeStr) => {
      const match = timeStr.match(/(\d{1,2}):(\d{2})(am|pm)/i);
      if (!match) return 0;
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const isPm = match[3].toUpperCase() === 'PM';
      if (isPm && hours !== 12) hours += 12;
      if (!isPm && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };

    const showings = [];
    const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);

    // Find all duration lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^\d+HR\s+\d+MINS$/)) {
        const movieTitle = lines[i - 1];

        // Collect showtimes that follow
        const times = [];
        let j = i + 1;
        let foundNonTime = false;

        while (j < lines.length && !foundNonTime) {
          const nextLine = lines[j];

          // Stop if we hit another duration line
          if (nextLine.match(/^\d+HR\s+\d+MINS$/)) {
            foundNonTime = true;
            break;
          }

          // Collect times
          if (/^\d{1,2}:\d{2}(?:am|pm)$/i.test(nextLine)) {
            times.push(nextLine.toUpperCase());
          } else if (times.length > 0 && nextLine.length > 0 && !nextLine.match(/^(Watch|Standard|Recliner|DETAILS|RELEASE|Filter|Select|Language|SUB|TITLED|Pre-order|SHOWTIMES)$/i)) {
            // If we collected times and hit a non-time non-UI line, stop
            foundNonTime = true;
            break;
          }

          j += 1;
        }

        if (times.length > 0 && movieTitle && movieTitle.length > 1 && !movieTitle.match(/^(Filter|Select|SHOWTIMES)$/i)) {
          showings.push({
            title: movieTitle,
            times: [...new Set(times)].sort((a, b) => timeToMinutes(a) - timeToMinutes(b)),
            date: dateStr,
            year: null,
          });
        }
      }
    }

    return showings;
  }, isoDate);
}

async function fetchFilmYear(page, filmTitle) {
  try {
    // Try to find a link to the film page for this title
    const filmUrl = await page.evaluate((title) => {
      const links = Array.from(document.querySelectorAll('a[href*="/movies/"]'));
      for (const link of links) {
        if (link.textContent.includes(title)) {
          return link.href;
        }
      }
      return null;
    }, filmTitle);

    if (!filmUrl) {
      return null;
    }

    // Open the film page in a new tab
    const newPage = await page.browser().newPage();
    await newPage.goto(filmUrl, { waitUntil: 'networkidle2' });

    // Extract the year
    const year = await newPage.evaluate(() => {
      const text = document.body.innerText;
      const releaseMatch = text.match(/RELEASE DATE\s+(\w+\s+\d+,?\s+(\d{4}))/i);
      if (releaseMatch) {
        return parseInt(releaseMatch[2], 10);
      }
      const yearMatch = text.match(/\b(19|20)\d{2}\b/);
      return yearMatch ? parseInt(yearMatch[0], 10) : null;
    });

    await newPage.close();
    return year;
  } catch (error) {
    console.error(`    Error fetching year for "${filmTitle}":`, error.message);
    return null;
  }
}

scrapeShowtimes().catch(console.error);
