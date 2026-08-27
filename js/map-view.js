/**
 * Theatre Map View
 * Manages the interactive map for displaying nearby theatres
 */

let mapInstance = null;
let markers = [];
let currentTheatreId = null;
let cachedTheatres = [];
let cachedUserLocation = null;
let cachedGroups = null;
let cachedTheatreGroups = null;

// Helper to compare times (copied from app.js logic)
function compareTimes(a, b) {
  const toMinutes = (time) => {
    const match = String(time || '').match(/(\d+):(\d+)/);
    if (!match) return 0;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (String(time).toLowerCase().includes('pm') && hours !== 12) hours += 12;
    if (String(time).toLowerCase().includes('am') && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };
  return toMinutes(a) - toMinutes(b);
}

const mapElements = {
  toggleWrap: null,
  toggleBtn: null,
  mapContainer: null,
  mapEl: null,
  sidebar: null,
  sidebarContent: null,
  sidebarClose: null,
};

// Initialize map elements on page load
function initMapElements() {
  mapElements.toggleWrap = document.getElementById('theatreMapToggleWrap');
  mapElements.toggleBtn = document.getElementById('theatreMapToggle');
  mapElements.mapContainer = document.getElementById('mapViewContainer');
  mapElements.mapEl = document.getElementById('theatreMap');
  mapElements.sidebar = document.getElementById('theatreSidebar');
  mapElements.sidebarContent = document.getElementById('theatreSidebarContent');
  mapElements.sidebarClose = document.getElementById('theatreSidebarClose');

  if (mapElements.toggleBtn) {
    mapElements.toggleBtn.addEventListener('click', toggleMapView);
  }
  if (mapElements.sidebarClose) {
    mapElements.sidebarClose.addEventListener('click', closeSidebar);
  }
}

// Toggle between map and list view
function toggleMapView() {
  const isMapActive = mapElements.mapContainer.classList.toggle('hidden');
  const resultsSection = document.getElementById('results');

  if (resultsSection) {
    resultsSection.classList.toggle('hidden');
  }

  mapElements.toggleBtn.textContent = isMapActive ? 'Show Map' : 'Show List';
  mapElements.toggleBtn.setAttribute('aria-pressed', String(!isMapActive));

  // Initialize map on first toggle
  if (!mapInstance && !isMapActive) {
    initializeMap();
  }

  // Request fresh location when opening map
  if (!isMapActive) {
    requestFreshLocation();
  }

  // Refresh map size when shown
  if (!isMapActive && mapInstance) {
    // Force multiple size recalculations
    setTimeout(() => mapInstance.invalidateSize(), 50);
    setTimeout(() => mapInstance.invalidateSize(), 150);
    setTimeout(() => mapInstance.invalidateSize(), 300);
    setTimeout(() => mapInstance.invalidateSize(), 500);
  }

  // Listen for window resize to keep map sized correctly
  window.addEventListener('resize', () => {
    if (mapInstance && !mapElements.mapContainer.classList.contains('hidden')) {
      mapInstance.invalidateSize();
    }
  });
}

// Initialize Leaflet map
function initializeMap() {
  // Default center (will be updated with user location)
  const center = [40.0, -95.0];

  // Ensure container has visible dimensions
  mapElements.mapEl.style.height = '600px';
  mapElements.mapEl.style.width = '100%';

  mapInstance = L.map(mapElements.mapEl, {
    preferCanvas: true,
  }).setView(center, 4);

  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(mapInstance);

  // Force size calculation
  setTimeout(() => {
    mapInstance.invalidateSize();
  }, 100);

  // Render any cached theatre data
  if (cachedTheatres.length > 0) {
    renderCachedMarkers();
  }
}

// Render the cached theatre data
function renderCachedMarkers() {
  if (!mapInstance || cachedTheatres.length === 0) return;

  clearMarkers();
  currentTheatreId = null;

  let userLat = null;
  let userLng = null;

  // Use user location if available
  if (cachedUserLocation && cachedUserLocation.lat && cachedUserLocation.lng) {
    userLat = cachedUserLocation.lat;
    userLng = cachedUserLocation.lng;
  }

  // Set map view based on available data
  if (userLat && userLng) {
    // User location available: center on user with radius
    mapInstance.setView([userLat, userLng], 11);

    // Add user location marker
    L.circleMarker([userLat, userLng], {
      radius: 8,
      fillColor: '#c54828',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(mapInstance);
  } else {
    // No user location: fit all theatres in view
    if (cachedTheatres.length > 0) {
      const bounds = L.latLngBounds();
      cachedTheatres.forEach(theatre => {
        if (theatre.latitude && theatre.longitude) {
          bounds.extend([theatre.latitude, theatre.longitude]);
        }
      });
      if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }

  // Add theatre markers
  cachedTheatres.forEach(theatre => {
    if (!theatre.latitude || !theatre.longitude) {
      return;
    }

    const marker = L.marker(
      [theatre.latitude, theatre.longitude],
      { icon: createMarkerIcon(false) }
    ).addTo(mapInstance);

    marker.on('click', () => {
      selectTheatre(theatre, marker);
    });

    markers.push({ marker, theatre });
  });
}

// Clear existing markers
function clearMarkers() {
  markers.forEach(m => mapInstance.removeLayer(m.marker));
  markers = [];
}

// Create custom marker icon
function createMarkerIcon(isSelected = false) {
  const iconColor = isSelected ? '#c54828' : '#2d5f58'; // accent or accent-2
  return L.divIcon({
    html: `
      <div style="
        width: 36px;
        height: 36px;
        background: ${iconColor};
        border: 2px solid white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: all 200ms ease;
      ">
        📍
      </div>
    `,
    iconSize: [36, 36],
    className: 'theatre-marker',
  });
}

// Add theatre markers to map
export function renderMapMarkers(theatres, userLocation, groups = null, theatreGroups = null) {
  // Cache the data for when map is initialized
  cachedTheatres = theatres;
  cachedUserLocation = userLocation;
  cachedGroups = groups;
  cachedTheatreGroups = theatreGroups;

  if (!mapInstance) {
    return;
  }

  // If map exists, render immediately
  renderCachedMarkers();
}

// Select theatre and show sidebar
function selectTheatre(theatre, marker) {
  // Update selected marker
  if (currentTheatreId !== theatre.id) {
    markers.forEach(m => {
      m.marker.setIcon(createMarkerIcon(m.theatre.id === theatre.id));
    });
    currentTheatreId = theatre.id;
  }

  // Populate sidebar with theatre details
  populateSidebar(theatre);

  // Show sidebar
  mapElements.sidebar.classList.remove('hidden');
}

// Populate sidebar with theatre card - use theatre group's shows (already processed)
function populateSidebar(theatre) {
  // Find the theatre group from cached groups
  if (!cachedTheatreGroups || !Array.isArray(cachedTheatreGroups)) {
    console.log('ERROR: cachedTheatreGroups not available');
    return;
  }

  console.log('DEBUG: Looking for theatre ID', theatre.id, 'in', cachedTheatreGroups.length, 'groups');
  if (cachedTheatreGroups.length > 0) {
    console.log('First group:', cachedTheatreGroups[0]);
  }

  const theatreGroup = cachedTheatreGroups.find(group =>
    group.theatreInfo && group.theatreInfo.id === theatre.id
  );

  console.log('DEBUG: theatreGroup found?', !!theatreGroup, 'Shows:', theatreGroup?.shows?.length);
  if (!theatreGroup || !theatreGroup.shows || theatreGroup.shows.length === 0) {
    console.log('ERROR: Theatre group not found or has no shows');
    mapElements.sidebarContent.innerHTML = `
      <article class="group-card" data-theatre-id="${theatre.id}">
        <h3 class="group-title">${theatre.name}</h3>
        <p class="group-subtitle">${theatre.city}</p>
        <a class="group-link" href="${theatre.website}" target="_blank" rel="noopener noreferrer">Visit theatre website</a>
        <ul class="show-list"></ul>
      </article>
    `;
    return;
  }

  // Use the shows array from the theatre group - it already has dates/premiumDates processed
  const shows = theatreGroup.shows;

  // Build the theatre card HTML
  const card = document.createElement('article');
  card.className = 'group-card';
  card.setAttribute('data-theatre-id', theatre.id);

  // Title
  const title = document.createElement('h3');
  title.className = 'group-title';
  title.textContent = theatre.name;
  card.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'group-subtitle';
  subtitle.textContent = theatre.city;
  card.appendChild(subtitle);

  // Website link
  const link = document.createElement('a');
  link.className = 'group-link';
  link.href = theatre.website;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Visit theatre website';
  card.appendChild(link);

  // Shows list
  const list = document.createElement('ul');
  list.className = 'show-list';

  // Render all shows - same as list view
  shows.forEach((show, idx) => {
    const item = document.createElement('li');
    item.className = 'show-item';
    item.innerHTML = `
      <div class="show-row has-poster">
        <img class="show-poster" alt="" />
        <div>
          <div class="show-main">${show.film}</div>
          <div class="show-meta"></div>
          <div class="show-schedule hidden"></div>
        </div>
      </div>
      <a class="show-link hidden" target="_blank" rel="noopener noreferrer">Tickets</a>
    `;

    // Set poster
    const poster = item.querySelector('.show-poster');
    poster.src = show.posterUrl || './assets/images/noposter.webp';
    poster.alt = `Poster for ${show.film}`;

    // Set up expand button - same as list view
    const meta = item.querySelector('.show-meta');
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'film-expand-toggle theatre-row-toggle';
    expandBtn.textContent = 'Expand';
    expandBtn.dataset.showIndex = idx;
    meta.appendChild(expandBtn);

    // Set ticket link - same as list view
    const ticketLink = item.querySelector('.show-link');
    if (show.ticketLink) {
      ticketLink.href = show.ticketLink;
    }

    list.appendChild(item);
  });

  card.appendChild(list);
  mapElements.sidebarContent.innerHTML = '';
  mapElements.sidebarContent.appendChild(card);

  // Attach event listeners
  attachCardEventListeners(card, shows);
}

// Attach event listeners to card elements
function attachCardEventListeners(card, shows) {
  const expandButtons = card.querySelectorAll('.film-expand-toggle.theatre-row-toggle');

  expandButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const showItem = button.closest('.show-item');
      if (!showItem) return;

      const schedule = showItem.querySelector('.show-schedule');
      if (!schedule) return;

      const showIndex = Number(button.dataset.showIndex);
      const show = shows[showIndex];
      if (!show) return;

      const isExpanded = !schedule.classList.contains('hidden');

      if (isExpanded) {
        // COLLAPSING
        schedule.classList.add('hidden');
        button.textContent = 'Expand';

        const ticketLink = showItem.querySelector('.show-link');
        if (ticketLink) ticketLink.classList.add('hidden');

        const rowActions = showItem.querySelector('.theatre-row-actions');
        if (rowActions) rowActions.remove();

        const meta = showItem.querySelector('.show-meta');
        if (meta && !meta.contains(button)) {
          meta.appendChild(button);
        }
      } else {
        // EXPANDING - same as list view
        schedule.classList.remove('hidden');
        button.textContent = 'Collapse';

        // Populate schedule with dates/times (same format as renderSchedule)
        if (!schedule.hasChildNodes()) {
          const allDates = new Set([
            ...Object.keys(show.dates || {}),
            ...Object.keys(show.premiumDates || {})
          ]);
          Array.from(allDates).sort().forEach(date => {
            const times = show.dates[date] || [];
            const premiumTimes = show.premiumDates[date] || [];
            const allTimes = [...times, ...premiumTimes];
            const dateStr = new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const div = document.createElement('div');
            div.innerHTML = `<strong>${dateStr.toUpperCase()}</strong><br>${allTimes.join(', ')}`;
            schedule.appendChild(div);
          });
        }

        // Show ticket link
        const ticketLink = showItem.querySelector('.show-link');
        if (ticketLink && show.ticketLink) {
          ticketLink.classList.remove('hidden');
        }

        // Create row actions
        let rowActions = showItem.querySelector('.theatre-row-actions');
        if (!rowActions) {
          rowActions = document.createElement('div');
          rowActions.className = 'theatre-row-actions';

          // Move button to row actions
          const meta = showItem.querySelector('.show-meta');
          if (meta && meta.contains(button)) {
            meta.removeChild(button);
          }
          button.textContent = 'Collapse';
          rowActions.appendChild(button);

          // Add ticket link to row actions
          if (ticketLink && show.ticketLink) {
            rowActions.appendChild(ticketLink);
          }

          // Add film page link
          if (show.film) {
            const filmPageLink = document.createElement('a');
            filmPageLink.className = 'theatre-row-film-link';
            const slug = show.film
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .replace(/--+/g, '-')
              .slice(0, 80);
            filmPageLink.href = `films/${slug}/`;
            filmPageLink.target = '_blank';
            filmPageLink.rel = 'noopener noreferrer';
            filmPageLink.textContent = 'View Film Page';
            rowActions.appendChild(filmPageLink);
          }

          showItem.appendChild(rowActions);
        }
      }
    });
  });
}

// Close sidebar
function closeSidebar() {
  mapElements.sidebar.classList.add('hidden');

  // Deselect marker
  if (currentTheatreId) {
    markers.forEach(m => {
      m.marker.setIcon(createMarkerIcon(false));
    });
    currentTheatreId = null;
  }
}

// Show map toggle only in theatre view
export function showMapToggle() {
  if (mapElements.toggleWrap) {
    mapElements.toggleWrap.classList.remove('hidden');
  }
}

// Hide map toggle for other views
export function hideMapToggle() {
  if (mapElements.toggleWrap) {
    mapElements.toggleWrap.classList.add('hidden');
  }

  // Reset to list view if map was open
  if (mapElements.mapContainer && !mapElements.mapContainer.classList.contains('hidden')) {
    toggleMapView();
  }
}

// Request fresh geolocation and update map
async function requestFreshLocation() {
  if (!("geolocation" in navigator)) {
    // Still render with fallback
    if (mapInstance) {
      renderCachedMarkers();
    }
    return;
  }

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0, // Don't use cached position
      });
    });

    // Update cached location
    cachedUserLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch (error) {
    // Geolocation failed - will use fallback in renderCachedMarkers
  } finally {
    // Always render the map with whatever location we have (or fallback)
    if (mapInstance) {
      renderCachedMarkers();
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initMapElements);