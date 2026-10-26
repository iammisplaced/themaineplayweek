/**
 * Theatre Map View
 * Manages the interactive map for displaying nearby theatres
 */

let mapInstance = null;
let markers = [];
let currentTheatreId = null;
let cachedTheatres = [];
let cachedUserLocation = null;
// Builds the side panel card for a theatre id; supplied by app.js so the panel shows the
// same film rows as the Theatres list.
let buildTheatreCard = null;
let panelTheatreId = null;
// Row keys (data-film-key) the visitor has expanded in the side panel. Kept apart from
// the list's so expanding a row in one doesn't change the other.
const expandedPanelRows = new Set();

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
  if (mapElements.sidebarContent) {
    mapElements.sidebarContent.addEventListener('click', (e) => {
      const toggle = e.target.closest('.film-expand-toggle[data-film-key]');
      if (!toggle) return;
      // The card is rebuilt below, which detaches the button; stop here so the
      // "click outside the panel" handler doesn't mistake it for an outside click.
      e.stopPropagation();
      const key = toggle.dataset.filmKey;
      if (expandedPanelRows.has(key)) {
        expandedPanelRows.delete(key);
      } else {
        expandedPanelRows.add(key);
      }
      renderPanel();
    });
  }

  // Keep the map sized correctly while it's showing
  window.addEventListener('resize', () => {
    if (mapInstance && !mapElements.mapContainer.classList.contains('hidden')) {
      mapInstance.invalidateSize();
    }
  });

  // Close sidebar when clicking outside of it
  if (mapElements.mapContainer) {
    mapElements.mapContainer.addEventListener('click', (e) => {
      // Only close if sidebar is visible and click is not on the sidebar or its contents
      if (mapElements.sidebar && !mapElements.sidebar.classList.contains('hidden')) {
        if (!mapElements.sidebar.contains(e.target)) {
          closeSidebar();
        }
      }
    });
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

  if (!isMapActive) {
    renderCachedMarkers();
  }

  // Refresh map size when shown
  if (!isMapActive && mapInstance) {
    // Force multiple size recalculations
    setTimeout(() => mapInstance.invalidateSize(), 50);
    setTimeout(() => mapInstance.invalidateSize(), 150);
    setTimeout(() => mapInstance.invalidateSize(), 300);
    setTimeout(() => mapInstance.invalidateSize(), 500);
  }
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

    marker.on('click', (e) => {
      e.originalEvent.stopPropagation();
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

// Add theatre markers to map. `theatreCardBuilder(theatreId, isRowExpanded)` returns the
// side panel card for a theatre, or null.
export function renderMapMarkers(theatres, userLocation, theatreCardBuilder) {
  // Cache the data for when map is initialized
  cachedTheatres = theatres;
  cachedUserLocation = userLocation;
  buildTheatreCard = theatreCardBuilder;

  if (!mapInstance) {
    return;
  }

  // If map exists, render immediately
  renderCachedMarkers();
  if (mapElements.sidebar && !mapElements.sidebar.classList.contains('hidden')) {
    renderPanel();
  }
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

// Show a theatre's card in the side panel
function populateSidebar(theatre) {
  if (panelTheatreId !== theatre.id) expandedPanelRows.clear();
  panelTheatreId = theatre.id;
  renderPanel();
}

function renderPanel() {
  const card = buildTheatreCard?.(panelTheatreId, (key) => expandedPanelRows.has(key));
  mapElements.sidebarContent.replaceChildren(...(card ? [card] : []));
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', initMapElements);