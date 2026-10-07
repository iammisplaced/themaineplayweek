import { formatShowtimesCsv, launchBrowser, prompt, sleep, writeCsvToRepoRoot } from './lib/scraper-utils.mjs';

async function scrapeShowtimes() {
  let browser;
  try {
    // Get input from user
    console.log('=== Apple Cinemas Showtimes Scraper ===\n');
    const theatreUrl = await prompt('Enter theatre URL (e.g., https://www.applecinemas.com/home/611fea26f74bab2423301ee4):\n> ');
    const theatreName = await prompt('\nEnter theatre name (e.g., Apple Cinemas Saco and IMAX):\n> ');
    const theatreCity = await prompt('Enter theatre city (e.g., Saco):\n> ');
    const fetchYears = (await prompt('\nFetch film years? (y/n, slower but more complete):\n> ')).toLowerCase() === 'y';

    if (!theatreUrl || !theatreName || !theatreCity) {
      throw new Error('All fields are required');
    }

    console.log(`\nStarting scrape for ${theatreName}, ${theatreCity}...`);
    console.log(`URL: ${theatreUrl}`);
    console.log(`Fetch years: ${fetchYears ? 'yes' : 'no'}\n`);

    let page;
    ({ browser, page } = await launchBrowser());

    console.log('Loading theatre page...');
    await page.goto(theatreUrl, { waitUntil: 'networkidle2' });

    console.log('Finding NOW PLAYING films...\n');

    // Get all NOW PLAYING films with their titles
    const filmLinks = await page.evaluate(() => {
      const allElements = document.querySelectorAll('a');
      const films = [];

      Array.from(allElements).forEach((link, idx) => {
        const text = link.textContent.trim();
        const isPreSales = text.includes('Pre - Sales');
        const isEvent = text.includes('EVENTS');
        const isValidLength = text.length > 30;

        if (isValidLength && !isPreSales && !isEvent && !text.startsWith('By using')) {
          films.push({
            idx,
            title: text.substring(0, 100), // Get the full text as title
            isNowPlaying: !isPreSales && !isEvent,
          });
        }
      });

      // Remove duplicates
      const seen = new Set();
      return films.filter(f => {
        if (seen.has(f.title)) return false;
        seen.add(f.title);
        return true;
      });
    });

    console.log(`Found ${filmLinks.length} NOW PLAYING films\n`);

    const allShowtimesData = [];

    // Process each film
    for (const filmLink of filmLinks) {
      const filmTitle = filmLink.title;
      console.log(`Processing: ${filmTitle.substring(0, 50)}...`);

      // Click the film
      const clicked = await page.evaluate((idx) => {
        const links = document.querySelectorAll('a');
        const validLinks = Array.from(links).filter(l => {
          const text = l.textContent.trim();
          return text.length > 30 && !text.includes('Pre - Sales');
        });
        if (validLinks[idx] && validLinks[idx].click) {
          validLinks[idx].click();
          return true;
        }
        return false;
      }, filmLinks.indexOf(filmLink));

      if (!clicked) {
        console.log('  ✗ Could not click film');
        continue;
      }

      await sleep(1500);

      // Handle any modals that pop up after clicking
      let modalHandled = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const modalAction = await page.evaluate(() => {
          // Check for confirmation modal (yes/no)
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Yes') || btn.textContent.includes('OK') || btn.textContent.includes('Confirm')) {
              btn.click();
              return 'confirmed';
            }
          }
          return null;
        });

        if (modalAction) {
          await sleep(1000);
          modalHandled = true;
          break;
        }
      }

      // Handle location selection modal
      const locationSelected = await page.evaluate((town) => {
        const buttons = document.querySelectorAll('button, a, [role="button"]');
        for (const btn of buttons) {
          if (btn.textContent.includes(town)) {
            btn.click();
            return true;
          }
        }
        return false;
      }, theatreCity);

      if (!locationSelected) {
        console.log(`  ✗ Location "${theatreCity}" not found - skipping film`);
        // Go back to theatre page
        await page.goto(theatreUrl, { waitUntil: 'networkidle2' });
        await sleep(1000);
        continue;
      }

      console.log(`  ✓ Location selected`);
      await sleep(1500);

      // Extract showtimes for 7 days
      const filmShowtimes = await extractSevenDaysShowtimes(page, filmTitle, theatreCity);

      if (filmShowtimes.length > 0) {
        console.log(`  ✓ Found ${filmShowtimes.length} total showings`);
        allShowtimesData.push(...filmShowtimes);
      } else {
        console.log(`  ✗ No showtimes found`);
      }

      // Go back to theatre page for next film
      await page.goto(theatreUrl, { waitUntil: 'networkidle2' });
      await sleep(1000);
    }

    console.log(`\nTotal showings: ${allShowtimesData.length}\n`);

    if (allShowtimesData.length === 0) {
      throw new Error('No showtimes data extracted from the page');
    }

    // Format as CSV
    const csv = formatShowtimesCsv(allShowtimesData, theatreName, theatreCity);

    // Generate filename
    const filename = `scraped-${theatreCity.toLowerCase().replace(/\s+/g, '-')}-apple-showtimes.csv`;
    writeCsvToRepoRoot(filename, csv);
    console.log(`Saved to ${filename}\n`);

    // Show summary
    const byDate = {};
    allShowtimesData.forEach(s => {
      byDate[s.date] = (byDate[s.date] || 0) + 1;
    });

    console.log('Summary by date:');
    Object.entries(byDate).sort().forEach(([date, count]) => {
      console.log(`  ${date}: ${count} showings`);
    });

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

async function extractSevenDaysShowtimes(page, filmTitle, theatreCity) {
  const allShowtimes = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const isoDate = targetDate.toISOString().split('T')[0];

    // If not first day, click the next date button
    if (dayOffset > 0) {
      const nextDateClicked = await page.evaluate(() => {
        // Look for next date button/arrow
        const buttons = document.querySelectorAll('button, a, [role="button"]');
        const nextBtn = Array.from(buttons).find(btn => {
          const text = btn.textContent.trim();
          return text === '>' || text === 'Next' || text.includes('→');
        });

        if (nextBtn) {
          nextBtn.click();
          return true;
        }
        return false;
      });

      if (!nextDateClicked) {
        // No next button found, stop here
        break;
      }

      await sleep(1000);
    }

    // Check if a modal appeared (indicating no more showtimes)
    const modalAppeared = await page.evaluate(() => {
      const modals = document.querySelectorAll('[role="dialog"], .modal');
      return modals.length > 0;
    });

    if (modalAppeared) {
      // Close modal and stop
      await page.evaluate(() => {
        const closeButtons = document.querySelectorAll('button');
        for (const btn of closeButtons) {
          if (btn.textContent.includes('Close') || btn.textContent.includes('OK') || btn.textContent.includes('×')) {
            btn.click();
            return;
          }
        }
      });
      break;
    }

    // Extract showtimes from detail frame
    const showtimes = await page.evaluate(() => {
      // Find the detail frame with showtimes
      const detailFrames = document.querySelectorAll('[class*="detail"], [class*="showtime"], [class*="frame"]');

      if (detailFrames.length === 0) {
        return null; // No data
      }

      // Get text from the first detail frame
      const text = detailFrames[0].innerText || detailFrames[0].textContent || '';

      // Extract times (format: HH:MM AM/PM)
      const times = text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) || [];

      return times.length > 0 ? times : null;
    });

    if (!showtimes) {
      // No data for this date, stop here
      break;
    }

    // Add to results
    showtimes.forEach(time => {
      allShowtimes.push({
        title: filmTitle,
        date: isoDate,
        time: time.toUpperCase(),
      });
    });
  }

  return allShowtimes;
}

scrapeShowtimes().catch(console.error);
