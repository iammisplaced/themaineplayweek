/**
 * Theatre Map View
 * Manages the interactive map for displaying nearby theatres
 */

let mapInstance = null;
let markers = [];
let currentTheatreId = null;

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

  // Refresh map size when shown
  if (!isMapActive && mapInstance) {
    // Use requestAnimationFrame to wait for layout to be calculated
    requestAnimationFrame(() => {
      mapInstance.invalidateSize();
      // Also call it again after a short delay to catch any timing issues
      setTimeout(() => mapInstance.invalidateSize(), 200);
    });

    // Listen for window resize to keep map sized correctly
    window.addEventListener('resize', () => {
      if (!mapElements.mapContainer.classList.contains('hidden')) {
        mapInstance.invalidateSize();
      }
    });
  }
}

// Initialize Leaflet map
function initializeMap() {
  // Default center (will be updated with user location)
  const center = [40.0, -95.0];

  mapInstance = L.map(mapElements.mapEl).setView(center, 4);

  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(mapInstance);
}

// Clear existing markers
function clearMarkers() {
  markers.forEach(marker => mapInstance.removeLayer(marker));
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
export function renderMapMarkers(theatres, userLocation) {
  if (!mapInstance) return;

  clearMarkers();
  currentTheatreId = null;

  // Debug logging
  console.log('renderMapMarkers called with:', { theatresCount: theatres.length, userLocation });
  console.log('Sample theatres:', theatres.slice(0, 3));

  // Update map center to user location if available
  // 15 miles ≈ 24 km, zoom level 11 roughly shows this radius
  const zoomLevel = 11;

  if (userLocation && userLocation.lat && userLocation.lng) {
    mapInstance.setView([userLocation.lat, userLocation.lng], zoomLevel);

    // Add user location marker
    L.circleMarker([userLocation.lat, userLocation.lng], {
      radius: 8,
      fillColor: '#c54828',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(mapInstance);

    // Add 15 mile radius circle around user
    const radiusMiles = 15;
    const radiusMeters = radiusMiles * 1609.34;
    L.circle([userLocation.lat, userLocation.lng], {
      radius: radiusMeters,
      color: '#c54828',
      fillColor: '#c54828',
      fillOpacity: 0.05,
      weight: 2,
      dashArray: '5, 5',
    }).addTo(mapInstance);
  } else {
    // Fallback center if no user location
    mapInstance.setView([40.0, -95.0], 4);
  }

  // Add theatre markers
  let addedMarkers = 0;
  let missingCoords = 0;

  theatres.forEach(theatre => {
    if (!theatre.latitude || !theatre.longitude) {
      console.warn('Theatre missing lat/lng:', theatre.name, theatre);
      missingCoords++;
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
    addedMarkers++;
  });

  console.log(`Added ${addedMarkers} markers to map. ${missingCoords} theatres missing coordinates.`);

  // Show message if no markers could be added
  if (addedMarkers === 0 && theatres.length > 0) {
    console.warn('No theatres with coordinates found!');
    mapElements.sidebarContent.innerHTML = `
      <div style="padding: 1rem; text-align: center; color: var(--muted);">
        <p>No theatres with location data available.</p>
        <p style="font-size: 0.85rem; margin-top: 0.5rem;">Coordinates may need to be added in the admin panel.</p>
      </div>
    `;
    mapElements.sidebar.classList.remove('hidden');
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

// Populate sidebar with theatre information
function populateSidebar(theatre) {
  const html = `
    <div class="theatre-sidebar-header">
      <h3>${theatre.name}</h3>
      <p class="theatre-sidebar-city">${theatre.city}</p>
    </div>
    <div class="theatre-sidebar-details">
      <p class="theatre-sidebar-address">${theatre.address}</p>
      ${theatre.phone ? `<p class="theatre-sidebar-phone">${theatre.phone}</p>` : ''}
      <a href="${theatre.website}" target="_blank" rel="noopener noreferrer" class="theatre-sidebar-link">
        Visit Website
      </a>
    </div>
  `;

  mapElements.sidebarContent.innerHTML = html;
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