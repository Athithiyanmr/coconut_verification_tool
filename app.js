/* ==========================================================
   Coconut Polygon Verifier — Tamil Nadu 2020
   Shared backend with Express API
   ========================================================== */

// ---- Cloud Config ----
// __PORT_5000__ is replaced by deploy_website with the actual proxy URL
const API_BASE = (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1')
  ? '' : '/__PORT_5000__';
const API_URL = `${API_BASE}/api/data`;

// ---- State ----
let districtIndex = {};
let currentDistrict = null;
let geojsonData = null;
let polygonLayer = null;
let labelMarkers = [];
let selectedPolygonId = null;
let highlightLayer = null;
let verificationResults = {}; // { "District:id": { status, user, timestamp } }
let currentFilter = 'all';
let currentUser = '';
let isSaving = false;

// Drawn polygons state
let drawnPolygons = []; // [{ district, id, geometry, area_ha, user, timestamp, note }]
let drawnLayer = null;    // L.FeatureGroup for draw plugin
let drawControl = null;   // L.Control.Draw instance
let drawnLabelMarkers = []; // map labels for drawn polygons

// ---- Map Setup ----
const map = L.map('map', {
  center: [10.8, 78.7],
  zoom: 7,
  zoomControl: true,
});

const satelliteTile = L.tileLayer(
  'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    attribution: 'Imagery &copy; Google',
  }
).addTo(map);

const hybridTile = L.tileLayer(
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    attribution: 'Imagery &copy; Google',
  }
);

const sentinel2Tile = L.tileLayer(
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', {
    maxZoom: 14,
    attribution: 'Sentinel-2 cloudless 2020 by EOX',
  }
);

const esriTile = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Esri World Imagery',
  }
);

L.control.layers({
  'Google Satellite': satelliteTile,
  'Google Satellite + Labels': hybridTile,
  'Sentinel-2 2020': sentinel2Tile,
  'Esri Latest Imagery': esriTile,
}, null, { position: 'topright' }).addTo(map);

// ---- DOM Refs ----
const $ = (s) => document.querySelector(s);
const districtSelect = $('#districtSelect');
const districtInfo = $('#districtInfo');
const progressSection = $('#progressSection');
const polygonListSection = $('#polygonListSection');
const sidebarFooter = $('#sidebarFooter');
const polygonList = $('#polygonList');
const verifyPanel = $('#verifyPanel');
const loadingOverlay = $('#loadingOverlay');

// ---- Cloud Sync ----
async function loadFromCloud() {
  try {
    setSyncStatus('loading');
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    if (data.verifications) {
      // Convert old format (string) to new format (object) if needed
      Object.entries(data.verifications).forEach(([key, val]) => {
        if (typeof val === 'string') {
          verificationResults[key] = { status: val, user: 'unknown', timestamp: '' };
        } else {
          verificationResults[key] = val;
        }
      });
    }
    // Load drawn polygons from cloud
    if (Array.isArray(data.drawnPolygons)) {
      drawnPolygons = data.drawnPolygons;
    }
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.warn('Cloud load failed:', e);
    setSyncStatus('error');
    return false;
  }
}

async function saveToCloud() {
  if (isSaving) return;
  isSaving = true;
  setSyncStatus('saving');

  try {
    // Read current state first to merge (in case others saved while we worked)
    let cloudData = { verifications: {} };
    try {
      const readRes = await fetch(API_URL, { cache: 'no-store' });
      if (readRes.ok) cloudData = await readRes.json();
    } catch (e) { /* use empty if read fails */ }

    // Merge: our local results take priority for keys we changed
    const merged = { ...cloudData.verifications, ...verificationResults };

    // Merge drawn polygons (by district+id key, ours win)
    const cloudDrawn = Array.isArray(cloudData.drawnPolygons) ? cloudData.drawnPolygons : [];
    const drawnMap = {};
    cloudDrawn.forEach(p => { drawnMap[`${p.district}:${p.id}`] = p; });
    drawnPolygons.forEach(p => { drawnMap[`${p.district}:${p.id}`] = p; });
    const mergedDrawn = Object.values(drawnMap);

    const payload = {
      _meta: {
        created: '2026-04-07',
        description: 'Coconut verification results - Tamil Nadu 2020',
        lastUpdated: new Date().toISOString(),
        lastUpdatedBy: currentUser,
      },
      verifications: merged,
      drawnPolygons: mergedDrawn,
    };

    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error('Save failed');

    // Update local with merged data
    Object.entries(merged).forEach(([key, val]) => {
      if (typeof val === 'string') {
        verificationResults[key] = { status: val, user: 'unknown', timestamp: '' };
      } else {
        verificationResults[key] = val;
      }
    });
    drawnPolygons = mergedDrawn;

    setSyncStatus('synced');
  } catch (e) {
    console.warn('Cloud save failed:', e);
    setSyncStatus('error');
  }
  isSaving = false;
}

function setSyncStatus(status) {
  const indicator = $('#syncIndicator');
  if (!indicator) return;
  const dot = indicator.querySelector('.sync-dot');
  const text = indicator.querySelector('.sync-text');
  dot.className = 'sync-dot';

  switch (status) {
    case 'loading': dot.classList.add('sync-loading'); text.textContent = 'Loading...'; break;
    case 'saving':  dot.classList.add('sync-saving');  text.textContent = 'Saving...'; break;
    case 'synced':  dot.classList.add('sync-ok');      text.textContent = 'Synced'; break;
    case 'error':   dot.classList.add('sync-error');   text.textContent = 'Offline'; break;
  }
}

function getStatus(key) {
  const entry = verificationResults[key];
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.status;
}

function getVerifier(key) {
  const entry = verificationResults[key];
  if (!entry) return '';
  return typeof entry === 'object' ? (entry.user || '') : '';
}

// ---- Leaflet.draw setup ----
function setupDrawLayer() {
  drawnLayer = new L.FeatureGroup();
  map.addLayer(drawnLayer);
}

function enableDrawControl() {
  // Remove existing draw control if present
  if (drawControl) { map.removeControl(drawControl); drawControl = null; }

  drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: '#2980b9',
          weight: 2,
          dashArray: '6 4',
          fillColor: '#2980b9',
          fillOpacity: 0.2,
        },
      },
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false,
    },
    edit: { featureGroup: drawnLayer },
  });
  map.addControl(drawControl);
}

map.on(L.Draw.Event.CREATED, (e) => {
  if (!currentDistrict || !currentUser) {
    alert('Please select a district and enter your name before drawing.');
    return;
  }

  const layer = e.layer;
  const geojson = layer.toGeoJSON();

  // Calculate area in hectares
  const area_ha = calculateAreaHa(geojson.geometry);

  // Prompt for note
  const note = prompt('Add a note for this polygon (e.g. "New coconut area spotted"):') || 'User drawn';

  // Unique ID within district
  const districtDrawn = drawnPolygons.filter(p => p.district === currentDistrict);
  const nextNum = districtDrawn.length + 1;
  const polyId = `new_${nextNum}`;

  const entry = {
    district: currentDistrict,
    id: polyId,
    geometry: geojson.geometry,
    area_ha: area_ha,
    user: currentUser,
    timestamp: new Date().toISOString(),
    note: note,
  };

  drawnPolygons.push(entry);
  saveToCloud();

  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
});

function calculateAreaHa(geometry) {
  // Shoelace formula on the outer ring, converted to approximate hectares
  let coords;
  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates[0][0];
  }
  if (!coords || coords.length < 3) return 0;

  // Use L.GeometryUtil if available, else approximate with spherical formula
  const latlngs = coords.map(c => L.latLng(c[1], c[0]));
  if (window.L && L.GeometryUtil && L.GeometryUtil.geodesicArea) {
    const m2 = L.GeometryUtil.geodesicArea(latlngs);
    return parseFloat((m2 / 10000).toFixed(4));
  }

  // Fallback: approximate using a simple planar calculation scaled by cos(lat)
  const R = 6371000; // earth radius in metres
  const toRad = d => d * Math.PI / 180;
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  area = Math.abs(area * R * R / 2);
  return parseFloat((area / 10000).toFixed(4));
}

function renderDrawnPolygonsOnMap() {
  if (!drawnLayer) return;
  drawnLayer.clearLayers();
  clearDrawnLabels();

  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);
  districtPolys.forEach(entry => {
    const layer = L.geoJSON(entry.geometry, {
      style: {
        color: '#2980b9',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#2980b9',
        fillOpacity: 0.2,
      },
    });
    layer.on('click', () => zoomToDrawnPolygon(entry));
    drawnLayer.addLayer(layer);

    // Add label
    const centroid = getCentroid(entry.geometry);
    if (centroid) {
      const latlng = L.latLng(centroid[1], centroid[0]);
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: 'drawn-label',
          html: `N${entry.id.replace('new_', '')}`,
          iconSize: [26, 18],
          iconAnchor: [13, 9],
        }),
        interactive: true,
      }).addTo(map);
      marker.on('click', () => zoomToDrawnPolygon(entry));
      drawnLabelMarkers.push(marker);
    }
  });
}

function clearDrawnLabels() {
  drawnLabelMarkers.forEach(m => map.removeLayer(m));
  drawnLabelMarkers = [];
}

function addDrawnLabels() {
  // Re-render labels on map move (they're managed by renderDrawnPolygonsOnMap)
  // No-op here since renderDrawnPolygonsOnMap handles it; added for completeness
}

function zoomToDrawnPolygon(entry) {
  const layer = L.geoJSON(entry.geometry);
  map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 18 });
}

function renderDrawnPolygonList() {
  const list = $('#drawnPolygonList');
  const empty = $('#drawnEmpty');
  if (!list) return;

  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);

  if (districtPolys.length === 0) {
    if (empty) empty.style.display = '';
    // Remove any items
    list.querySelectorAll('.drawn-polygon-item').forEach(el => el.remove());
    return;
  }
  if (empty) empty.style.display = 'none';

  // Rebuild list
  list.querySelectorAll('.drawn-polygon-item').forEach(el => el.remove());

  districtPolys.forEach((entry, idx) => {
    const num = idx + 1;
    const displayId = `N${entry.id.replace('new_', '')}`;
    const isOwner = entry.user === currentUser;
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '';

    const div = document.createElement('div');
    div.className = 'drawn-polygon-item';
    div.innerHTML = `
      <div class="dp-id">${displayId}</div>
      <div class="dp-info">
        <div class="dp-note" title="${entry.note}">${entry.note}</div>
        <div class="dp-meta">${entry.area_ha} ha &middot; ${entry.user} &middot; ${ts}</div>
      </div>
      ${isOwner ? `<button class="btn-delete-drawn" data-id="${entry.id}">Delete</button>` : ''}
    `;

    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-drawn')) return;
      zoomToDrawnPolygon(entry);
    });

    const delBtn = div.querySelector('.btn-delete-drawn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteDrawnPolygon(entry.id);
      });
    }

    list.appendChild(div);
  });
}

function deleteDrawnPolygon(polyId) {
  if (!confirm('Delete this drawn polygon?')) return;
  drawnPolygons = drawnPolygons.filter(p => !(p.district === currentDistrict && p.id === polyId));
  saveToCloud();
  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
}

// ---- Init ----
async function init() {
  const res = await fetch('data/districts.json');
  districtIndex = await res.json();

  const names = Object.keys(districtIndex).sort();
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${districtIndex[name].count} polygons)`;
    districtSelect.appendChild(opt);
  });

  // Set up draw layer (before cloud load so it's ready)
  setupDrawLayer();

  // Load cloud data
  await loadFromCloud();

  // Ask for user name
  promptUserName();
}

function promptUserName() {
  const modal = $('#userModal');
  if (modal) modal.classList.remove('hidden');
  const input = $('#userName');
  const btn = $('#userNameSubmit');
  if (input && btn) {
    const submit = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      currentUser = name;
      modal.classList.add('hidden');
      if ($('#currentUserDisplay')) {
        $('#currentUserDisplay').textContent = name;
      }
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }
}

// ---- District Selection ----
districtSelect.addEventListener('change', async () => {
  const name = districtSelect.value;
  if (!name) return;
  // Refresh from cloud before loading district
  await loadFromCloud();
  await loadDistrict(name);
});

async function loadDistrict(name) {
  const info = districtIndex[name];
  if (!info) return;

  currentDistrict = name;
  selectedPolygonId = null;
  verifyPanel.classList.add('hidden');
  loadingOverlay.classList.remove('hidden');

  districtInfo.classList.remove('hidden');
  districtInfo.innerHTML = `<b>${name}</b> — ${info.count.toLocaleString()} polygons`;

  const res = await fetch(info.file);
  geojsonData = await res.json();
  clearMap();

  polygonLayer = L.geoJSON(geojsonData, {
    style: (feature) => getPolygonStyle(feature),
    onEachFeature: (feature, layer) => {
      layer.on('click', () => selectPolygon(feature.properties.id));
    }
  }).addTo(map);

  addLabels();
  map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40] });

  progressSection.style.display = '';
  polygonListSection.style.display = '';
  sidebarFooter.style.display = '';
  $('#drawnPolygonsSection').style.display = '';

  renderPolygonList();
  updateProgress();
  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
  loadingOverlay.classList.add('hidden');

  // Enable the draw control now a district is selected
  enableDrawControl();

  map.off('moveend', onMapMove);
  map.on('moveend', onMapMove);
}

function getPolygonStyle(feature) {
  const key = `${currentDistrict}:${feature.properties.id}`;
  const status = getStatus(key);

  if (status === 'yes') {
    return { color: '#27ae60', weight: 2, fillColor: '#27ae60', fillOpacity: 0.35, dashArray: null };
  }
  if (status === 'no') {
    return { color: '#e74c3c', weight: 2, fillColor: '#e74c3c', fillOpacity: 0.35, dashArray: null };
  }
  return { color: '#f1c40f', weight: 2, fillColor: '#f1c40f', fillOpacity: 0.3, dashArray: '5 5' };
}

function clearMap() {
  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  clearLabels();
  clearDrawnLabels();
  // Clear drawn layers from the featureGroup (don't remove the group itself)
  if (drawnLayer) drawnLayer.clearLayers();
}

function clearLabels() {
  labelMarkers.forEach(m => map.removeLayer(m));
  labelMarkers = [];
}

function addLabels() {
  clearLabels();
  if (!geojsonData) return;

  const zoom = map.getZoom();
  const bounds = map.getBounds();

  geojsonData.features.forEach(feat => {
    const id = feat.properties.id;
    const coords = getCentroid(feat.geometry);
    if (!coords) return;
    const latlng = L.latLng(coords[1], coords[0]);

    if (!bounds.contains(latlng)) return;
    if (zoom < 10 && geojsonData.features.length > 50) return;
    if (zoom < 12 && geojsonData.features.length > 200) return;

    const key = `${currentDistrict}:${id}`;
    const status = getStatus(key);
    let className = 'polygon-label';
    if (status === 'yes') className += ' polygon-label-yes';
    if (status === 'no') className += ' polygon-label-no';

    const marker = L.marker(latlng, {
      icon: L.divIcon({
        className: className,
        html: `${id}`,
        iconSize: [24, 18],
        iconAnchor: [12, 9],
      }),
      interactive: true,
    }).addTo(map);

    marker.on('click', () => selectPolygon(id));
    labelMarkers.push(marker);
  });
}

function onMapMove() { addLabels(); addDrawnLabels(); }

function getCentroid(geometry) {
  let coords;
  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    let maxLen = 0;
    geometry.coordinates.forEach(poly => {
      if (poly[0].length > maxLen) { maxLen = poly[0].length; coords = poly[0]; }
    });
  }
  if (!coords || coords.length === 0) return null;
  let sx = 0, sy = 0;
  coords.forEach(c => { sx += c[0]; sy += c[1]; });
  return [sx / coords.length, sy / coords.length];
}

// ---- Polygon Selection ----
function selectPolygon(id) {
  selectedPolygonId = id;
  const feat = geojsonData.features.find(f => f.properties.id === id);
  if (!feat) return;

  if (highlightLayer) map.removeLayer(highlightLayer);
  highlightLayer = L.geoJSON(feat, {
    style: { color: '#fff', weight: 4, fillColor: '#3498db', fillOpacity: 0.15, dashArray: null },
  }).addTo(map);

  const bounds = L.geoJSON(feat).getBounds();
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });

  verifyPanel.classList.remove('hidden');
  $('#verifyTitle').textContent = `Polygon #${id}`;
  $('#verifyArea').textContent = `${feat.properties.area_ha} ha`;

  // Show who verified this
  const key = `${currentDistrict}:${id}`;
  const verifier = getVerifier(key);
  const status = getStatus(key);
  const verifiedByEl = $('#verifiedBy');
  if (verifiedByEl) {
    if (status && verifier) {
      verifiedByEl.textContent = `Verified by ${verifier}`;
      verifiedByEl.classList.remove('hidden');
    } else {
      verifiedByEl.classList.add('hidden');
    }
  }

  const toggle = $('#overlayToggle');
  toggle.checked = true;
  updateOverlayVisibility(true);

  document.querySelectorAll('.poly-item').forEach(el => el.classList.remove('active'));
  const listItem = document.querySelector(`.poly-item[data-id="${id}"]`);
  if (listItem) {
    listItem.classList.add('active');
    listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  updateVerifyButtonStates(status);
}

function updateVerifyButtonStates(status) {
  $('#btnYes').style.opacity = status === 'yes' ? '1' : '0.7';
  $('#btnNo').style.opacity = status === 'no' ? '1' : '0.7';
  if (status === 'yes') {
    $('#btnYes').style.outline = '3px solid #fff';
    $('#btnNo').style.outline = 'none';
  } else if (status === 'no') {
    $('#btnNo').style.outline = '3px solid #fff';
    $('#btnYes').style.outline = 'none';
  } else {
    $('#btnYes').style.outline = 'none';
    $('#btnNo').style.outline = 'none';
    $('#btnYes').style.opacity = '1';
    $('#btnNo').style.opacity = '1';
  }
}

// ---- Overlay Toggle ----
$('#overlayToggle').addEventListener('change', (e) => {
  updateOverlayVisibility(e.target.checked);
});

function updateOverlayVisibility(show) {
  if (!polygonLayer) return;
  if (show) {
    polygonLayer.setStyle((feat) => getPolygonStyle(feat));
    if (highlightLayer) highlightLayer.setStyle({ fillOpacity: 0.15, opacity: 1 });
    labelMarkers.forEach(m => m.getElement && m.getElement() && (m.getElement().style.display = ''));
  } else {
    polygonLayer.setStyle({ fillOpacity: 0, opacity: 0 });
    if (highlightLayer) highlightLayer.setStyle({ fillOpacity: 0, opacity: 0.6, color: '#fff', weight: 2, dashArray: '4 4' });
    labelMarkers.forEach(m => m.getElement && m.getElement() && (m.getElement().style.display = 'none'));
  }
}

// ---- Verification Actions ----
$('#btnYes').addEventListener('click', () => verifyPolygon('yes'));
$('#btnNo').addEventListener('click', () => verifyPolygon('no'));
$('#btnSkip').addEventListener('click', () => navigatePolygon(1));
$('#closeVerify').addEventListener('click', () => {
  verifyPanel.classList.add('hidden');
  selectedPolygonId = null;
  if (highlightLayer) map.removeLayer(highlightLayer);
});

$('#btnPrev').addEventListener('click', () => navigatePolygon(-1));
$('#btnNext').addEventListener('click', () => navigatePolygon(1));

function verifyPolygon(status) {
  if (!selectedPolygonId || !currentDistrict) return;
  if (!currentUser) { promptUserName(); return; }

  const key = `${currentDistrict}:${selectedPolygonId}`;
  verificationResults[key] = {
    status: status,
    user: currentUser,
    timestamp: new Date().toISOString(),
  };

  // Save to cloud (non-blocking)
  saveToCloud();

  // Update UI
  polygonLayer.setStyle((feat) => getPolygonStyle(feat));
  updateProgress();
  renderPolygonList();
  addLabels();
  updateVerifyButtonStates(status);

  // Show verified-by
  const verifiedByEl = $('#verifiedBy');
  if (verifiedByEl) {
    verifiedByEl.textContent = `Verified by ${currentUser}`;
    verifiedByEl.classList.remove('hidden');
  }

  setTimeout(() => navigatePolygon(1), 300);
}

function navigatePolygon(direction) {
  if (!geojsonData) return;
  const features = getFilteredFeatures();
  if (features.length === 0) return;

  let currentIdx = features.findIndex(f => f.properties.id === selectedPolygonId);
  let nextIdx;
  if (currentIdx === -1) {
    nextIdx = 0;
  } else {
    nextIdx = currentIdx + direction;
    if (nextIdx >= features.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = features.length - 1;
  }
  selectPolygon(features[nextIdx].properties.id);
}

function getFilteredFeatures() {
  if (!geojsonData) return [];
  return geojsonData.features.filter(f => {
    if (currentFilter === 'all') return true;
    const key = `${currentDistrict}:${f.properties.id}`;
    const status = getStatus(key) || 'pending';
    return status === currentFilter || (currentFilter === 'pending' && !getStatus(key));
  });
}

// ---- Polygon List ----
function renderPolygonList() {
  if (!geojsonData) return;
  const features = getFilteredFeatures();

  polygonList.innerHTML = features.map(f => {
    const id = f.properties.id;
    const key = `${currentDistrict}:${id}`;
    const status = getStatus(key);
    const verifier = getVerifier(key);
    const isActive = id === selectedPolygonId;

    let statusClass = 's-pending', statusText = 'Pending', itemClass = '';
    if (status === 'yes') { statusClass = 's-yes'; statusText = 'Coconut'; itemClass = 'verified-yes'; }
    if (status === 'no') { statusClass = 's-no'; statusText = 'Not Coconut'; itemClass = 'verified-no'; }

    const verifierHtml = verifier ? `<div class="poly-verifier">by ${verifier}</div>` : '';

    return `<div class="poly-item ${itemClass} ${isActive ? 'active' : ''}" data-id="${id}">
      <div class="poly-num">${id}</div>
      <div>
        <div style="font-weight:500">#${id}</div>
        <div class="poly-meta">${f.properties.area_ha} ha</div>
      </div>
      <div style="text-align:right;margin-left:auto">
        <span class="poly-status ${statusClass}">${statusText}</span>
        ${verifierHtml}
      </div>
    </div>`;
  }).join('');

  polygonList.querySelectorAll('.poly-item').forEach(el => {
    el.addEventListener('click', () => {
      selectPolygon(parseInt(el.dataset.id));
    });
  });
}

// ---- Filter Buttons ----
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderPolygonList();
  });
});

// ---- Refresh Button ----
const refreshBtn = $('#refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
    await loadFromCloud();
    if (currentDistrict && geojsonData) {
      polygonLayer.setStyle((feat) => getPolygonStyle(feat));
      renderPolygonList();
      updateProgress();
      addLabels();
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  });
}

// ---- Progress ----
function updateProgress() {
  if (!geojsonData || !currentDistrict) return;
  const total = geojsonData.features.length;
  let yes = 0, no = 0;
  geojsonData.features.forEach(f => {
    const key = `${currentDistrict}:${f.properties.id}`;
    const st = getStatus(key);
    if (st === 'yes') yes++;
    if (st === 'no') no++;
  });
  const done = yes + no;
  const pending = total - done;
  const pct = total > 0 ? (done / total * 100).toFixed(1) : 0;

  $('#progressCount').textContent = `${done} / ${total}`;
  $('#progressFill').style.width = `${pct}%`;
  $('#statYes').textContent = yes;
  $('#statNo').textContent = no;
  $('#statPending').textContent = pending;
}

// ---- Export CSV ----
$('#exportBtn').addEventListener('click', () => {
  if (!geojsonData || !currentDistrict) return;
  let csv = 'District,Polygon_ID,Area_ha,Latitude,Longitude,Verification,Verified_By,Timestamp,Source\n';
  geojsonData.features.forEach(f => {
    const id = f.properties.id;
    const key = `${currentDistrict}:${id}`;
    const status = getStatus(key) || 'pending';
    const verifier = getVerifier(key);
    const entry = verificationResults[key];
    const ts = entry && typeof entry === 'object' ? (entry.timestamp || '') : '';
    const centroid = getCentroid(f.geometry);
    csv += `"${currentDistrict}",${id},${f.properties.area_ha},${centroid ? centroid[1].toFixed(5) : ''},${centroid ? centroid[0].toFixed(5) : ''},${status},"${verifier}","${ts}",training_label\n`;
  });
  // Append drawn polygons
  drawnPolygons.filter(p => p.district === currentDistrict).forEach(p => {
    const centroid = getCentroid(p.geometry);
    csv += `"${currentDistrict}",${p.id},${p.area_ha},${centroid ? centroid[1].toFixed(5) : ''},${centroid ? centroid[0].toFixed(5) : ''},user_drawn,"${p.user}","${p.timestamp}",user_drawn\n`;
  });
  downloadFile(csv, `coconut_verification_${currentDistrict.toLowerCase().replace(/\s/g,'_')}.csv`, 'text/csv');
});

// ---- Export GeoJSON ----
$('#exportJsonBtn').addEventListener('click', () => {
  if (!geojsonData || !currentDistrict) return;
  const output = JSON.parse(JSON.stringify(geojsonData));
  output.features.forEach(f => {
    const key = `${currentDistrict}:${f.properties.id}`;
    f.properties.verification = getStatus(key) || 'pending';
    f.properties.verified_by = getVerifier(key);
    f.properties.source = 'training_label';
  });
  // Add drawn polygons as features
  drawnPolygons.filter(p => p.district === currentDistrict).forEach(p => {
    output.features.push({
      type: 'Feature',
      geometry: p.geometry,
      properties: {
        id: p.id,
        area_ha: p.area_ha,
        note: p.note,
        user: p.user,
        timestamp: p.timestamp,
        source: 'user_drawn',
      },
    });
  });
  const json = JSON.stringify(output, null, 2);
  downloadFile(json, `coconut_verified_${currentDistrict.toLowerCase().replace(/\s/g,'_')}.geojson`, 'application/json');
});

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  // Don't capture when user name modal is open
  if ($('#userModal') && !$('#userModal').classList.contains('hidden')) return;

  if (!verifyPanel.classList.contains('hidden')) {
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); verifyPolygon('yes'); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); verifyPolygon('no'); }
    if (e.key === 's' || e.key === 'S' || e.key === ' ') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePolygon(-1); }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      const toggle = $('#overlayToggle');
      toggle.checked = !toggle.checked;
      updateOverlayVisibility(toggle.checked);
    }
    if (e.key === 'Escape') {
      verifyPanel.classList.add('hidden');
      selectedPolygonId = null;
      if (highlightLayer) map.removeLayer(highlightLayer);
    }
  }
});

// ---- Auto-refresh every 60 seconds ----
setInterval(async () => {
  if (!isSaving) {
    await loadFromCloud();
    if (currentDistrict && geojsonData) {
      polygonLayer.setStyle((feat) => getPolygonStyle(feat));
      updateProgress();
      renderDrawnPolygonsOnMap();
      renderDrawnPolygonList();
      // Don't re-render training polygon list to avoid disrupting scroll position
    }
  }
}, 60000);

// ---- Init ----
init();
