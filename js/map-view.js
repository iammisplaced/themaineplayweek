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

// Populate sidebar with theatre shows from cached data
function populateSidebar(theatre) {
  // Find the group data for this theatre from cachedGroups
  let theatreGroup = null;
  if (cachedGroups) {
    theatreGroup = Object.values(cachedGroups).find(
      group => group.theatreInfo &&
                group.theatreInfo.id === theatre.id
    );
  }

  if (!theatreGroup || !theatreGroup.shows || theatreGroup.shows.length === 0) {
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

  // Clone the original card from the DOM
  const originalCard = document.querySelector(`[data-theatre-id="${theatre.id}"]`);
  if (originalCard) {
    const clonedCard = originalCard.cloneNode(true);

    // Show all hidden show-items (remove the hidden class from those that were cut off for scrolling)
    const hiddenShowItems = clonedCard.querySelectorAll('.show-item.hidden');
    hiddenShowItems.forEach(item => item.classList.remove('hidden'));

    // Remove the "Show all" toggle button since we're showing all films
    const showAllToggle = clonedCard.querySelector('.film-expand-toggle.theatre-card-toggle');
    if (showAllToggle) {
      showAllToggle.remove();
    }

    mapElements.sidebarContent.innerHTML = '';
    mapElements.sidebarContent.appendChild(clonedCard);
    attachCardEventListeners(clonedCard, theatreGroup);
  }
}

// Attach event listeners to card elements
function attachCardEventListeners(card, theatreGroup) {
  // Find all expand buttons (which expand/collapse individual show schedules)
  const expandButtons = card.querySelectorAll('.film-expand-toggle.theatre-row-toggle');

  expandButtons.forEach((button, idx) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Get the film key from the button's dataset
      const filmKey = button.dataset.filmKey;
      if (!filmKey || !window.state) return;

      // Toggle the expand state in app.js's global state
      if (window.state.expandedFilmGroups.has(filmKey)) {
        window.state.expandedFilmGroups.delete(filmKey);
      } else {
        window.state.expandedFilmGroups.add(filmKey);
      }

      // Re-render the entire app
      if (window.render) {
        window.render();

        // After render, re-clone the updated card into the sidebar
        setTimeout(() => {
          const originalCard = document.querySelector(`[data-theatre-id="${card.getAttribute('data-theatre-id')}"]`);
          if (originalCard) {
            const clonedCard = originalCard.cloneNode(true);

            // Show all hidden show-items
            const hiddenShowItems = clonedCard.querySelectorAll('.show-item.hidden');
            hiddenShowItems.forEach(item => item.classList.remove('hidden'));

            // Remove the "Show all" toggle button
            const showAllToggle = clonedCard.querySelector('.film-expand-toggle.theatre-card-toggle');
            if (showAllToggle) {
              showAllToggle.remove();
            }

            mapElements.sidebarContent.innerHTML = '';
            mapElements.sidebarContent.appendChild(clonedCard);

            // Re-attach listeners to the new cloned card
            attachCardEventListeners(clonedCard, theatreGroup);
          }
        }, 0);
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