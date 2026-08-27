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
export function renderMapMarkers(theatres, userLocation, groups = null) {
  // Cache the data for when map is initialized
  cachedTheatres = theatres;
  cachedUserLocation = userLocation;
  cachedGroups = groups;

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

// Populate sidebar with theatre card from original DOM
function populateSidebar(theatre) {
  // Find the original theatre card in the DOM
  const originalCard = document.querySelector(`[data-theatre-id="${theatre.id}"]`);

  if (!originalCard) {
    // Fallback: show basic theatre info
    const html = `
      <div class="theatre-sidebar-header">
        <h3>${theatre.name}</h3>
        <p class="theatre-sidebar-city">${theatre.city}</p>
      </div>
      <div class="theatre-sidebar-details">
        <p class="theatre-sidebar-address">${theatre.address}</p>
        <a href="${theatre.website}" target="_blank" rel="noopener noreferrer" class="theatre-sidebar-link">
          Visit Website
        </a>
      </div>
    `;
    mapElements.sidebarContent.innerHTML = html;
    return;
  }

  // Clone the entire theatre card as-is
  const clonedCard = originalCard.cloneNode(true);

  // Show all hidden show-items (remove the hidden class from those that were cut off for scrolling)
  const hiddenShowItems = clonedCard.querySelectorAll('.show-item.hidden');
  hiddenShowItems.forEach(item => item.classList.remove('hidden'));

  // Remove the "Show all" toggle button since we're showing all films
  const showAllToggle = clonedCard.querySelector('.film-expand-toggle.theatre-card-toggle');
  if (showAllToggle) {
    showAllToggle.remove();
  }

  // Replace the sidebar content with the cloned card
  mapElements.sidebarContent.innerHTML = '';
  mapElements.sidebarContent.appendChild(clonedCard);

  // Find the theatre data from cachedTheatres to get film ticket links
  let theatreData = null;
  if (cachedTheatres) {
    theatreData = cachedTheatres.find(t => t.id === theatre.id);
  }

  // Attach event listeners so expand/collapse buttons work
  attachCardEventListeners(clonedCard, theatreData);
}

// Attach event listeners to card elements
function attachCardEventListeners(card, theatreData) {
  // Find all expand buttons (which expand/collapse individual show schedules)
  const expandButtons = card.querySelectorAll('.film-expand-toggle.theatre-row-toggle');

  expandButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Find the parent show-item
      const showItem = button.closest('.show-item');
      if (!showItem) return;

      // Toggle the show-schedule visibility
      const schedule = showItem.querySelector('.show-schedule');
      if (!schedule) return;

      const isExpanded = !schedule.classList.contains('hidden');

      if (isExpanded) {
        // COLLAPSING
        schedule.classList.add('hidden');
        button.textContent = 'Expand';

        // Hide the tickets link
        const ticketLink = showItem.querySelector('.show-link');
        if (ticketLink) {
          ticketLink.classList.add('hidden');
        }

        // Remove row actions (or just hide them)
        const rowActions = showItem.querySelector('.theatre-row-actions');
        if (rowActions) {
          rowActions.remove();
        }

        // Move the button back to show-meta
        const showMeta = showItem.querySelector('.show-meta');
        if (showMeta) {
          showMeta.appendChild(button);
        }
      } else {
        // EXPANDING
        schedule.classList.remove('hidden');
        button.textContent = 'Collapse';

        // Extract film title from show-main (strip any ribbons/pills)
        const showMain = showItem.querySelector('.show-main');
        let filmTitle = '';
        if (showMain) {
          // Get text content and trim, but skip any span elements (ribbons, pills)
          filmTitle = Array.from(showMain.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .join('')
            .trim();
          // If no text nodes found, try getting all text
          if (!filmTitle) {
            filmTitle = showMain.textContent.trim();
          }
        }

        console.log('DEBUG: Expanding show', { filmTitle, theatreData, theatreDataFilms: theatreData?.films });

        // Find the matching film in theatre data to get ticketLink
        let ticketUrl = '';
        if (theatreData && theatreData.films && filmTitle) {
          console.log('DEBUG: Looking for film in theatre.films array');
          const matchingFilm = theatreData.films.find(f => f.title === filmTitle);
          console.log('DEBUG: Matching film found?', { matchingFilm, filmTitle });
          if (matchingFilm && matchingFilm.ticketLink) {
            ticketUrl = matchingFilm.ticketLink;
            console.log('DEBUG: Got ticket URL:', ticketUrl);
          }
        } else {
          console.log('DEBUG: Missing data', { hasTheatreData: !!theatreData, hasFilmsArray: !!theatreData?.films, filmTitle });
        }

        // Show the tickets link if we have a ticket URL
        const ticketLink = showItem.querySelector('.show-link');
        console.log('DEBUG: Ticket link element?', { ticketLink, ticketUrl });
        if (ticketLink) {
          if (ticketUrl) {
            ticketLink.href = ticketUrl;
            ticketLink.classList.remove('hidden');
            console.log('DEBUG: Set ticket link href and showed it');
          } else {
            ticketLink.classList.add('hidden');
            console.log('DEBUG: No ticket URL, hiding link');
          }
        }

        // Show or create row actions with collapse button and film page link
        let rowActions = showItem.querySelector('.theatre-row-actions');
        if (!rowActions) {
          rowActions = document.createElement('div');
          rowActions.className = 'theatre-row-actions';

          // Move the expand button to row actions (or use the same button)
          // Remove the button from show-meta if it's there
          const showMeta = showItem.querySelector('.show-meta');
          if (showMeta && showMeta.contains(button)) {
            showMeta.removeChild(button);
          }
          // Update button text and add to row actions
          button.textContent = 'Collapse';
          rowActions.appendChild(button);

          // Add ticket link to row actions if it has a URL
          if (ticketLink && ticketUrl) {
            rowActions.appendChild(ticketLink);
          }

          // Create film page link if we have the film title
          if (filmTitle) {
            const filmPageLink = document.createElement('a');
            filmPageLink.className = 'theatre-row-film-link';
            // Build the slug the same way app.js does: lowercase, replace non-alphanumeric with dash, trim dashes
            const slug = filmTitle
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
        } else {
          rowActions.classList.remove('hidden');
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