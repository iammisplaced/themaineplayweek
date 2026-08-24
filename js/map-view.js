/**
 * Theatre Map View
 * Manages the interactive map for displaying nearby theatres
 */

let mapInstance = null;
let markers = [];
let currentTheatreId = null;
let cachedTheatres = [];
let cachedUserLocation = null;

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
  console.log('toggleMapView called');
  const isMapActive = mapElements.mapContainer.classList.toggle('hidden');
  console.log('Map container hidden?', isMapActive);
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
    console.log('Rendering cached theatres after map initialization');
    renderCachedMarkers();
  }
}

// Render the cached theatre data
function renderCachedMarkers() {
  if (!mapInstance || cachedTheatres.length === 0) return;

  clearMarkers();
  currentTheatreId = null;

  console.log('renderCachedMarkers - cachedUserLocation:', cachedUserLocation);

  let userLat = null;
  let userLng = null;

  // Use user location if available
  if (cachedUserLocation && cachedUserLocation.lat && cachedUserLocation.lng) {
    userLat = cachedUserLocation.lat;
    userLng = cachedUserLocation.lng;
    console.log('Using user location:', userLat, userLng);
  } else if (cachedTheatres.length > 0) {
    // Fallback: calculate center of all theatres
    let totalLat = 0;
    let totalLng = 0;
    let validTheatres = 0;

    cachedTheatres.forEach(theatre => {
      if (theatre.latitude && theatre.longitude) {
        totalLat += theatre.latitude;
        totalLng += theatre.longitude;
        validTheatres++;
      }
    });

    if (validTheatres > 0) {
      userLat = totalLat / validTheatres;
      userLng = totalLng / validTheatres;
      console.log('Using theatre center fallback:', userLat, userLng);
    }
  }

  // Set map view if we have a location
  if (userLat && userLng) {
    console.log('Centering on location:', userLat, userLng);
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

    // Add 15 mile radius circle around user
    const radiusMiles = 15;
    const radiusMeters = radiusMiles * 1609.34;
    L.circle([userLat, userLng], {
      radius: radiusMeters,
      color: '#c54828',
      fillColor: '#c54828',
      fillOpacity: 0.05,
      weight: 2,
      dashArray: '5, 5',
    }).addTo(mapInstance);
  } else {
    console.log('No user location, showing entire state');
    // Show entire Maine/state if no user location
    mapInstance.setView([45.2538, -69.4455], 7); // Maine center
  }

  // Add theatre markers
  let addedMarkers = 0;
  let missingCoords = 0;

  cachedTheatres.forEach(theatre => {
    if (!theatre.latitude || !theatre.longitude) {
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
  if (addedMarkers === 0 && cachedTheatres.length > 0) {
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
  console.log('renderMapMarkers called');

  // Cache the data for when map is initialized
  cachedTheatres = theatres;
  cachedUserLocation = userLocation;

  console.log('Caching user location:', userLocation);
  console.log('Map instance exists?', !!mapInstance);

  if (!mapInstance) {
    console.log('No map instance yet, data cached for when map is shown');
    return;
  }

  // If map exists, render immediately
  console.log('Map exists, rendering cached markers now');
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