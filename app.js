/* ==========================================================
   Coconut Polygon Verifier — Tamil Nadu 2020
   Shared backend via Google Sheets (Apps Script Web App)
   ========================================================== */

// ---- Cloud Config ----
const GSHEET_API = 'https://script.google.com/macros/s/AKfycbw2Qgfv7U-gG39a4Z1uvrf_5ZFQnZnj6QMmgj4zmSNTsXobCHKpzRi_ClQBl_vJ0ZZV/exec';

// ---- State ----
let districtIndex = {};
let currentDistrict = null;
let geojsonData = null;
let polygonLayer = null;
let labelMarkers = [];
let selectedPolygonId = null;
let highlightLayer = null;
let verificationResults = {};
let currentFilter = 'all';
let currentUser = '';
let isSaving = false;
let districtBoundaries = null;
let boundaryLayer = null;

// Drawn polygons state
let drawnPolygons = [];
let drawnLayer = null;
let drawControl = null;
let drawnLabelMarkers = [];
let drawnLayerMap = {};
let editingDrawnId = null;
let editingLeafletLayer = null;

// ---- Map Setup ----
const map = L.map('map', { center: [10.8, 78.7], zoom: 7, zoomControl: true });

L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
  maxZoom: 21,
  attribution: 'Imagery &copy; Google',
}).addTo(map);

map.createPane('drawnPane');
map.getPane('drawnPane').style.zIndex = 420;
map.createPane('drawnLabelPane');
map.getPane('drawnLabelPane').style.zIndex = 450;
map.getPane('drawnLabelPane').style.pointerEvents = 'none';

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

// ---- Badge + Panel helpers ----
function updateDrawnBadge() {
  const badge = $('#drawnCountBadge');
  if (!badge) return;
  const count = drawnPolygons.filter(p => p.district === currentDistrict).length;
  badge.textContent = count;
  // highlight badge if any polygons exist
  badge.style.background = count > 0 ? 'var(--blue)' : 'var(--text-faint)';
}

function expandDrawnPanel() {
  const btn = $('#drawnToggleBtn');
  const body = $('#drawnBody');
  const chevron = $('#drawnChevron');
  if (!btn || !body) return;
  btn.setAttribute('aria-expanded', 'true');
  body.classList.add('drawn-body-open');
  if (chevron) chevron.style.transform = 'rotate(180deg)';
}

// ---- Cloud Sync ----
async function loadFromCloud() {
  if (GSHEET_API === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') { setSyncStatus('error'); return false; }
  try {
    setSyncStatus('loading');
    const res = await fetch(`${GSHEET_API}?action=getAll`);
    const data = await res.json();
    if (data.verifications) {
      verificationResults = {};
      Object.entries(data.verifications).forEach(([key, val]) => {
        const status = typeof val === 'string' ? val : val.status;
        if (status === 'pending' || !status) return;
        verificationResults[key] = typeof val === 'string' ? { status: val, user: 'unknown', timestamp: '' } : val;
      });
    }
    if (Array.isArray(data.drawnPolygons)) drawnPolygons = data.drawnPolygons;
    setSyncStatus('synced');
    return true;
  } catch (e) { console.warn('Cloud load failed:', e); setSyncStatus('error'); return false; }
}

async function saveOneVerification(key, status, user, timestamp) {
  if (GSHEET_API === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') return;
  try {
    await fetch(GSHEET_API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'saveVerification', key, status, user, timestamp }) });
  } catch (e) { console.warn('Save verification failed:', e); }
}

async function saveOneDrawnPolygon(polygon) {
  if (GSHEET_API === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') return;
  try {
    await fetch(GSHEET_API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'saveDrawnPolygon', ...polygon }) });
  } catch (e) { console.warn('Save drawn polygon failed:', e); }
}

async function deleteOneDrawnPolygon(id, district) {
  if (GSHEET_API === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') return;
  try {
    await fetch(GSHEET_API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'deleteDrawnPolygon', id, district }) });
  } catch (e) { console.warn('Delete drawn polygon failed:', e); }
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
  if (drawControl) { map.removeControl(drawControl); drawControl = null; }
  drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: {
        allowIntersection: false, showArea: true,
        shapeOptions: { color: '#2980b9', weight: 2, dashArray: '6 4', fillColor: '#2980b9', fillOpacity: 0.15 },
      },
      polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false,
    },
    edit: { featureGroup: drawnLayer },
  });
  map.addControl(drawControl);
}

map.on(L.Draw.Event.CREATED, (e) => {
  if (!currentDistrict || !currentUser) { alert('Please select a district and enter your name before drawing.'); return; }
  const layer = e.layer;
  const geojson = layer.toGeoJSON();
  const overlaps = detectOverlaps(geojson);
  if (overlaps.length > 0) {
    const ids = overlaps.slice(0, 5).map(o => `#${o.id} (${o.overlap_pct}% overlap)`).join(', ');
    const extra = overlaps.length > 5 ? ` and ${overlaps.length - 5} more` : '';
    if (!confirm(`⚠️ Overlaps ${overlaps.length} existing polygon(s):\n\n${ids}${extra}\n\nSave anyway?`)) {
      if (drawnLayer) drawnLayer.removeLayer(layer); return;
    }
  }
  const area_ha = calculateAreaHa(geojson.geometry);
  const note = prompt('Add a note for this polygon:') || 'User drawn';
  const districtDrawn = drawnPolygons.filter(p => p.district === currentDistrict);
  const polyId = `new_${districtDrawn.length + 1}`;
  const entry = { district: currentDistrict, id: polyId, geometry: geojson.geometry, area_ha, user: currentUser, timestamp: new Date().toISOString(), note, overlaps_existing: overlaps.map(o => o.id) };
  drawnPolygons.push(entry);
  saveOneDrawnPolygon(entry);
  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
  // Auto-expand the panel so user immediately sees the new polygon
  expandDrawnPanel();
});

function detectOverlaps(newFeature) {
  if (!geojsonData || !window.turf) return [];
  const newPoly = newFeature.type === 'Feature' ? newFeature : turf.feature(newFeature.geometry || newFeature);
  const newBbox = turf.bbox(newPoly);
  const overlaps = [];
  for (const feat of geojsonData.features) {
    try {
      const featBbox = turf.bbox(feat);
      if (newBbox[2] < featBbox[0] || newBbox[0] > featBbox[2] || newBbox[3] < featBbox[1] || newBbox[1] > featBbox[3]) continue;
      const intersection = turf.intersect(newPoly, feat);
      if (intersection) {
        const interArea = turf.area(intersection);
        if (interArea > 1) overlaps.push({ id: feat.properties.id, overlap_pct: (interArea / turf.area(newPoly) * 100).toFixed(1) });
      }
    } catch (err) { /* skip */ }
  }
  return overlaps;
}

function calculateAreaHa(geometry) {
  let coords;
  if (geometry.type === 'Polygon') coords = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates[0][0];
  if (!coords || coords.length < 3) return 0;
  const latlngs = coords.map(c => L.latLng(c[1], c[0]));
  if (window.L && L.GeometryUtil && L.GeometryUtil.geodesicArea) return parseFloat((L.GeometryUtil.geodesicArea(latlngs) / 10000).toFixed(4));
  const R = 6371000, toRad = d => d * Math.PI / 180;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    area += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  return parseFloat((Math.abs(area * R * R / 2) / 10000).toFixed(4));
}

// ---- Drawn Polygon Shape Editing ----
function startEditingDrawnPolygon(polyId) {
  if (editingDrawnId) stopEditingDrawnPolygon(false);
  const entry = drawnPolygons.find(p => p.district === currentDistrict && p.id === polyId);
  if (!entry) return;
  editingDrawnId = polyId;
  renderDrawnPolygonsOnMap();
  const layerGroup = drawnLayerMap[polyId];
  if (layerGroup) {
    map.fitBounds(layerGroup.getBounds(), { padding: [60, 60], maxZoom: 18 });
    layerGroup.eachLayer(l => {
      if (l.editing) { l.editing.enable(); editingLeafletLayer = l; }
    });
  }
  renderDrawnPolygonList();
  showEditBar();
}

function stopEditingDrawnPolygon(save = true) {
  if (!editingDrawnId) return;
  if (save && editingLeafletLayer) {
    const updatedGeoJSON = editingLeafletLayer.toGeoJSON();
    const entry = drawnPolygons.find(p => p.district === currentDistrict && p.id === editingDrawnId);
    if (entry) {
      entry.geometry = updatedGeoJSON.geometry;
      entry.area_ha = calculateAreaHa(updatedGeoJSON.geometry);
      saveOneDrawnPolygon(entry);
    }
  }
  if (editingLeafletLayer && editingLeafletLayer.editing) editingLeafletLayer.editing.disable();
  editingLeafletLayer = null;
  editingDrawnId = null;
  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
  hideEditBar();
}

function showEditBar() {
  let bar = document.getElementById('editModeBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'editModeBar';
    bar.className = 'edit-mode-bar';
    bar.innerHTML = `
      <span class="edit-mode-label">✏️ Drag vertices on map to reshape</span>
      <div class="edit-mode-btns">
        <button class="btn btn-edit-save" id="btnSaveEdit">Save Shape</button>
        <button class="btn btn-edit-cancel" id="btnCancelEdit">Cancel</button>
      </div>`;
    const section = document.getElementById('drawnPolygonsSection');
    if (section) section.appendChild(bar);
  }
  document.getElementById('btnSaveEdit').onclick = () => stopEditingDrawnPolygon(true);
  document.getElementById('btnCancelEdit').onclick = () => stopEditingDrawnPolygon(false);
}

function hideEditBar() {
  const bar = document.getElementById('editModeBar');
  if (bar) bar.remove();
}

function editNoteDrawnPolygon(polyId) {
  const entry = drawnPolygons.find(p => p.district === currentDistrict && p.id === polyId);
  if (!entry) return;
  const newNote = prompt('Edit note:', entry.note || '');
  if (newNote === null) return;
  entry.note = newNote;
  saveOneDrawnPolygon(entry);
  renderDrawnPolygonList();
}

// ---- Render Drawn Polygons on Map ----
const DRAWN_COLORS = ['#2980b9','#8e44ad','#16a085','#d35400','#c0392b','#27ae60','#2c3e50','#f39c12'];

function getDrawnColor(index) {
  return DRAWN_COLORS[index % DRAWN_COLORS.length];
}

function renderDrawnPolygonsOnMap() {
  if (!drawnLayer) return;
  drawnLayer.clearLayers();
  clearDrawnLabels();
  drawnLayerMap = {};

  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);
  districtPolys.forEach((entry, index) => {
    const isEditing = editingDrawnId === entry.id;
    const color = isEditing ? '#e67e22' : getDrawnColor(index);

    const layer = L.geoJSON(entry.geometry, {
      pane: 'drawnPane',
      style: {
        color: color,
        weight: isEditing ? 3 : 2,
        dashArray: isEditing ? null : '6 4',
        fillColor: color,
        fillOpacity: isEditing ? 0.25 : 0.10,
        opacity: 0.9,
      },
    });
    layer.on('click', () => zoomToDrawnPolygon(entry));
    drawnLayer.addLayer(layer);
    drawnLayerMap[entry.id] = layer;

    const centroid = getCentroid(entry.geometry);
    if (centroid) {
      const latlng = L.latLng(centroid[1], centroid[0]);
      const labelClass = isEditing ? 'drawn-label drawn-label-editing' : 'drawn-label';
      const marker = L.marker(latlng, {
        pane: 'drawnLabelPane',
        icon: L.divIcon({
          className: labelClass,
          html: `<span style="border-color:${color};background:${color}cc">N${entry.id.replace('new_', '')}</span>`,
          iconSize: [28, 18], iconAnchor: [14, 9],
        }),
        interactive: true,
        zIndexOffset: 1000 + index,
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

// Re-render drawn labels on map move (mirrors addLabels behaviour)
function addDrawnLabels() {
  clearDrawnLabels();
  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);
  districtPolys.forEach((entry, index) => {
    const isEditing = editingDrawnId === entry.id;
    const color = isEditing ? '#e67e22' : getDrawnColor(index);
    const centroid = getCentroid(entry.geometry);
    if (!centroid) return;
    const latlng = L.latLng(centroid[1], centroid[0]);
    if (!map.getBounds().contains(latlng)) return;
    const labelClass = isEditing ? 'drawn-label drawn-label-editing' : 'drawn-label';
    const marker = L.marker(latlng, {
      pane: 'drawnLabelPane',
      icon: L.divIcon({
        className: labelClass,
        html: `<span style="border-color:${color};background:${color}cc">N${entry.id.replace('new_', '')}</span>`,
        iconSize: [28, 18], iconAnchor: [14, 9],
      }),
      interactive: true,
      zIndexOffset: 1000 + index,
    }).addTo(map);
    marker.on('click', () => zoomToDrawnPolygon(entry));
    drawnLabelMarkers.push(marker);
  });
}

function zoomToDrawnPolygon(entry) {
  const layer = L.geoJSON(entry.geometry);
  map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 18 });
}

// ---- Drawn Polygon Sidebar List ----
function renderDrawnPolygonList() {
  const list = $('#drawnPolygonList');
  const empty = $('#drawnEmpty');
  if (!list) return;

  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);

  // Always update the badge
  updateDrawnBadge();

  list.querySelectorAll('.drawn-polygon-item').forEach(el => el.remove());

  if (districtPolys.length === 0) {
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  districtPolys.forEach((entry, index) => {
    const displayId = `N${entry.id.replace('new_', '')}`;
    const isOwner = entry.user === currentUser;
    const isEditing = editingDrawnId === entry.id;
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '';
    const color = getDrawnColor(index);

    const div = document.createElement('div');
    div.className = `drawn-polygon-item${isEditing ? ' dp-editing' : ''}`;
    div.style.borderLeftColor = color;
    div.style.background = isEditing ? 'var(--edit-orange-light)' : `${color}14`;
    div.innerHTML = `
      <div class="dp-header">
        <span class="dp-id-badge" style="background:${color}">${displayId}</span>
        <span class="dp-area">${entry.area_ha} ha</span>
      </div>
      <div class="dp-note-text">${entry.note || 'No note'}</div>
      <div class="dp-meta-row">${entry.user} · ${ts}</div>
      <div class="dp-actions">
        <button class="dp-btn dp-btn-zoom" title="Zoom to polygon">🔍 Zoom</button>
        ${isOwner ? `
          <button class="dp-btn dp-btn-edit ${isEditing ? 'dp-btn-active' : ''}" title="Edit shape by dragging vertices">
            ✏️ ${isEditing ? 'Editing…' : 'Edit Shape'}
          </button>
          <button class="dp-btn dp-btn-note" title="Edit note">📝 Note</button>
          <button class="dp-btn dp-btn-delete" title="Delete polygon">🗑 Delete</button>
        ` : ''}
      </div>`;

    div.querySelector('.dp-btn-zoom').addEventListener('click', () => zoomToDrawnPolygon(entry));
    if (isOwner) {
      div.querySelector('.dp-btn-edit').addEventListener('click', () => {
        isEditing ? stopEditingDrawnPolygon(false) : startEditingDrawnPolygon(entry.id);
      });
      div.querySelector('.dp-btn-note').addEventListener('click', () => editNoteDrawnPolygon(entry.id));
      div.querySelector('.dp-btn-delete').addEventListener('click', () => deleteDrawnPolygon(entry.id));
    }

    list.appendChild(div);
  });
}

function deleteDrawnPolygon(polyId) {
  if (!confirm('Delete this drawn polygon?')) return;
  if (editingDrawnId === polyId) stopEditingDrawnPolygon(false);
  drawnPolygons = drawnPolygons.filter(p => !(p.district === currentDistrict && p.id === polyId));
  deleteOneDrawnPolygon(polyId, currentDistrict);
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
  try {
    const bRes = await fetch('data/district_boundaries.geojson');
    districtBoundaries = await bRes.json();
  } catch (e) { console.warn('Could not load district boundaries'); }
  setupDrawLayer();
  await loadFromCloud();
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
      if ($('#currentUserDisplay')) $('#currentUserDisplay').textContent = name;
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
  showDistrictBoundary(name);
  polygonLayer = L.geoJSON(geojsonData, {
    style: (feature) => getPolygonStyle(feature),
    onEachFeature: (feature, layer) => { layer.on('click', () => selectPolygon(feature.properties.id)); }
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
  enableDrawControl();
  map.off('moveend', onMapMove);
  map.on('moveend', onMapMove);
}

function getPolygonStyle(feature) {
  const key = `${currentDistrict}:${feature.properties.id}`;
  const status = getStatus(key);
  if (status === 'yes') return { color: '#27ae60', weight: 2, fillColor: '#27ae60', fillOpacity: 0.35, dashArray: null };
  if (status === 'no') return { color: '#e74c3c', weight: 2, fillColor: '#e74c3c', fillOpacity: 0.35, dashArray: null };
  return { color: '#f1c40f', weight: 2, fillColor: '#f1c40f', fillOpacity: 0.3, dashArray: '5 5' };
}

function clearMap() {
  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
  clearLabels();
  clearDrawnLabels();
  if (drawnLayer) drawnLayer.clearLayers();
}

function showDistrictBoundary(districtName) {
  if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
  if (!districtBoundaries) return;
  const feature = districtBoundaries.features.find(f => f.properties.name === districtName);
  if (!feature) return;
  boundaryLayer = L.geoJSON(feature, {
    style: { color: '#ffffff', weight: 2.5, fillOpacity: 0, dashArray: '8 4', opacity: 0.8 },
    interactive: false,
  }).addTo(map);
  boundaryLayer.bringToBack();
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
      icon: L.divIcon({ className, html: `${id}`, iconSize: [24, 18], iconAnchor: [12, 9] }),
      interactive: true,
    }).addTo(map);
    marker.on('click', () => selectPolygon(id));
    labelMarkers.push(marker);
  });
}

function onMapMove() { addLabels(); addDrawnLabels(); }

function getCentroid(geometry) {
  let coords;
  if (geometry.type === 'Polygon') coords = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') {
    let maxLen = 0;
    geometry.coordinates.forEach(poly => { if (poly[0].length > maxLen) { maxLen = poly[0].length; coords = poly[0]; } });
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
  map.fitBounds(L.geoJSON(feat).getBounds(), { padding: [60, 60], maxZoom: 18 });
  verifyPanel.classList.remove('hidden');
  $('#verifyTitle').textContent = `Polygon #${id}`;
  $('#verifyArea').textContent = `${feat.properties.area_ha} ha`;
  const key = `${currentDistrict}:${id}`;
  const verifier = getVerifier(key);
  const status = getStatus(key);
  const verifiedByEl = $('#verifiedBy');
  if (verifiedByEl) {
    if (status && verifier) { verifiedByEl.textContent = `Verified by ${verifier}`; verifiedByEl.classList.remove('hidden'); }
    else verifiedByEl.classList.add('hidden');
  }
  const toggle = $('#overlayToggle');
  toggle.checked = true;
  updateOverlayVisibility(true);
  document.querySelectorAll('.poly-item').forEach(el => el.classList.remove('active'));
  const listItem = document.querySelector(`.poly-item[data-id="${id}"]`);
  if (listItem) { listItem.classList.add('active'); listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  updateVerifyButtonStates(status);
}

function updateVerifyButtonStates(status) {
  $('#btnYes').style.opacity = status === 'yes' ? '1' : '0.7';
  $('#btnNo').style.opacity = status === 'no' ? '1' : '0.7';
  if (status === 'yes') { $('#btnYes').style.outline = '3px solid #fff'; $('#btnNo').style.outline = 'none'; }
  else if (status === 'no') { $('#btnNo').style.outline = '3px solid #fff'; $('#btnYes').style.outline = 'none'; }
  else { $('#btnYes').style.outline = 'none'; $('#btnNo').style.outline = 'none'; $('#btnYes').style.opacity = '1'; $('#btnNo').style.opacity = '1'; }
}

// ---- Overlay Toggle ----
$('#overlayToggle').addEventListener('change', (e) => { updateOverlayVisibility(e.target.checked); });

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
$('#btnModify').addEventListener('click', () => modifyVerification());

function modifyVerification() {
  if (!selectedPolygonId || !currentDistrict) return;
  const key = `${currentDistrict}:${selectedPolygonId}`;
  const existing = verificationResults[key];
  if (!existing) { alert('This polygon has no verification to modify yet.'); return; }
  const prevUser = typeof existing === 'object' ? existing.user : 'unknown';
  const prevStatus = getStatus(key);
  if (!confirm(`Marked "${prevStatus === 'yes' ? 'Coconut' : 'Not Coconut'}" by ${prevUser}.\n\nClear so you can re-mark it?`)) return;
  delete verificationResults[key];
  saveOneVerification(key, 'pending', currentUser, new Date().toISOString());
  polygonLayer.setStyle((feat) => getPolygonStyle(feat));
  updateProgress();
  renderPolygonList();
  addLabels();
  updateVerifyButtonStates(null);
  const verifiedByEl = $('#verifiedBy');
  if (verifiedByEl) verifiedByEl.classList.add('hidden');
}

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
  verificationResults[key] = { status, user: currentUser, timestamp: new Date().toISOString() };
  saveOneVerification(key, status, currentUser, new Date().toISOString());
  polygonLayer.setStyle((feat) => getPolygonStyle(feat));
  updateProgress();
  renderPolygonList();
  addLabels();
  updateVerifyButtonStates(status);
  const verifiedByEl = $('#verifiedBy');
  if (verifiedByEl) { verifiedByEl.textContent = `Verified by ${currentUser}`; verifiedByEl.classList.remove('hidden'); }
  setTimeout(() => navigatePolygon(1), 300);
}

function navigatePolygon(direction) {
  if (!geojsonData) return;
  const features = getFilteredFeatures();
  if (features.length === 0) return;
  let currentIdx = features.findIndex(f => f.properties.id === selectedPolygonId);
  let nextIdx = currentIdx === -1 ? 0 : currentIdx + direction;
  if (nextIdx >= features.length) nextIdx = 0;
  if (nextIdx < 0) nextIdx = features.length - 1;
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
      <div><div style="font-weight:500">#${id}</div><div class="poly-meta">${f.properties.area_ha} ha</div></div>
      <div style="text-align:right;margin-left:auto"><span class="poly-status ${statusClass}">${statusText}</span>${verifierHtml}</div>
    </div>`;
  }).join('');
  polygonList.querySelectorAll('.poly-item').forEach(el => {
    el.addEventListener('click', () => selectPolygon(parseInt(el.dataset.id)));
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
    refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing...';
    await loadFromCloud();
    if (currentDistrict && geojsonData) {
      polygonLayer.setStyle((feat) => getPolygonStyle(feat));
      renderPolygonList(); updateProgress(); addLabels();
      renderDrawnPolygonsOnMap(); renderDrawnPolygonList();
    }
    refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh';
  });
}

// ---- Progress ----
function updateProgress() {
  if (!geojsonData || !currentDistrict) return;
  const total = geojsonData.features.length;
  let yes = 0, no = 0;
  geojsonData.features.forEach(f => {
    const st = getStatus(`${currentDistrict}:${f.properties.id}`);
    if (st === 'yes') yes++; if (st === 'no') no++;
  });
  const done = yes + no;
  $('#progressCount').textContent = `${done} / ${total}`;
  $('#progressFill').style.width = `${total > 0 ? (done / total * 100).toFixed(1) : 0}%`;
  $('#statYes').textContent = yes;
  $('#statNo').textContent = no;
  $('#statPending').textContent = total - done;
}

// ---- Export CSV ----
$('#exportBtn').addEventListener('click', () => {
  if (!geojsonData || !currentDistrict) return;
  let csv = 'District,Polygon_ID,Area_ha,Latitude,Longitude,Verification,Verified_By,Timestamp,Source\n';
  geojsonData.features.forEach(f => {
    const id = f.properties.id, key = `${currentDistrict}:${id}`;
    const status = getStatus(key) || 'pending', verifier = getVerifier(key);
    const entry = verificationResults[key], ts = entry && typeof entry === 'object' ? (entry.timestamp || '') : '';
    const centroid = getCentroid(f.geometry);
    csv += `"${currentDistrict}",${id},${f.properties.area_ha},${centroid ? centroid[1].toFixed(5) : ''},${centroid ? centroid[0].toFixed(5) : ''},${status},"${verifier}","${ts}",training_label\n`;
  });
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
  drawnPolygons.filter(p => p.district === currentDistrict).forEach(p => {
    output.features.push({ type: 'Feature', geometry: p.geometry, properties: { id: p.id, area_ha: p.area_ha, note: p.note, user: p.user, timestamp: p.timestamp, source: 'user_drawn' } });
  });
  downloadFile(JSON.stringify(output, null, 2), `coconut_verified_${currentDistrict.toLowerCase().replace(/\s/g,'_')}.geojson`, 'application/json');
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

// ---- Export ALL Districts ----
$('#exportAllBtn').addEventListener('click', () => exportAllDistricts('csv'));
$('#exportAllGeoBtn').addEventListener('click', () => exportAllDistricts('geojson'));

async function exportAllDistricts(format) {
  const btn = format === 'csv' ? $('#exportAllBtn') : $('#exportAllGeoBtn');
  const origText = btn.textContent;
  btn.disabled = true; btn.textContent = 'Loading all districts...';
  try {
    await loadFromCloud();
    const districtNames = Object.keys(districtIndex).sort();
    const allFeatures = [], csvRows = [];
    let totalPolygons = 0, verified = 0, yesCount = 0, noCount = 0;
    for (let i = 0; i < districtNames.length; i++) {
      const dName = districtNames[i], info = districtIndex[dName];
      btn.textContent = `Loading ${dName}... (${i + 1}/${districtNames.length})`;
      const gj = await (await fetch(info.file)).json();
      gj.features.forEach(f => {
        const id = f.properties.id, key = `${dName}:${id}`;
        const status = getStatus(key) || 'pending', verifier = getVerifier(key);
        const entry = verificationResults[key], ts = entry && typeof entry === 'object' ? (entry.timestamp || '') : '';
        const centroid = getCentroid(f.geometry);
        totalPolygons++; if (status === 'yes' || status === 'no') verified++;
        if (status === 'yes') yesCount++; if (status === 'no') noCount++;
        if (format === 'csv') {
          csvRows.push(`"${dName}",${id},${f.properties.area_ha},${centroid ? centroid[1].toFixed(5) : ''},${centroid ? centroid[0].toFixed(5) : ''},${status},"${verifier}","${ts}",training_label`);
        } else {
          const feat = JSON.parse(JSON.stringify(f));
          feat.properties = { ...feat.properties, district: dName, verification: status, verified_by: verifier, verification_timestamp: ts, source: 'training_label' };
          allFeatures.push(feat);
        }
      });
    }
    drawnPolygons.forEach(p => {
      const centroid = getCentroid(p.geometry);
      if (format === 'csv') {
        csvRows.push(`"${p.district}",${p.id},${p.area_ha},${centroid ? centroid[1].toFixed(5) : ''},${centroid ? centroid[0].toFixed(5) : ''},user_drawn,"${p.user}","${p.timestamp}",user_drawn`);
      } else {
        allFeatures.push({ type: 'Feature', geometry: p.geometry, properties: { district: p.district, id: p.id, area_ha: p.area_ha, verification: 'user_drawn', verified_by: p.user, verification_timestamp: p.timestamp, note: p.note, source: 'user_drawn' } });
      }
    });
    const timestamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const summary = [`# Coconut Verification Export - Tamil Nadu 2020`,`# Date: ${new Date().toISOString()}`,`# Total Polygons: ${totalPolygons}`,`# Verified: ${verified} (${(verified/totalPolygons*100).toFixed(1)}%)`,`# Coconut (Yes): ${yesCount}`,`# Not Coconut (No): ${noCount}`,`# Pending: ${totalPolygons - verified}`,`# Drawn Polygons: ${drawnPolygons.length}`,`#`].join('\n');
      downloadFile(summary + '\nDistrict,Polygon_ID,Area_ha,Latitude,Longitude,Verification,Verified_By,Timestamp,Source\n' + csvRows.join('\n') + '\n', `coconut_verification_all_districts_${timestamp}.csv`, 'text/csv');
    } else {
      downloadFile(JSON.stringify({ type: 'FeatureCollection', properties: { name: 'Coconut Verification - Tamil Nadu 2020', exportDate: new Date().toISOString(), totalPolygons, verified, coconut: yesCount, notCoconut: noCount, pending: totalPolygons - verified, drawnPolygons: drawnPolygons.length }, features: allFeatures }), `coconut_verification_all_districts_${timestamp}.geojson`, 'application/json');
    }
    btn.textContent = `Done! ${totalPolygons} polygons exported`;
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
  } catch (e) {
    console.error('Export all failed:', e);
    btn.textContent = 'Export failed - try again';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
  }
}

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  if ($('#userModal') && !$('#userModal').classList.contains('hidden')) return;
  if (!verifyPanel.classList.contains('hidden')) {
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); verifyPolygon('yes'); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); verifyPolygon('no'); }
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); modifyVerification(); }
    if (e.key === 's' || e.key === 'S' || e.key === ' ') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePolygon(-1); }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      const toggle = $('#overlayToggle');
      toggle.checked = !toggle.checked;
      updateOverlayVisibility(toggle.checked);
    }
    if (e.key === 'Escape') { verifyPanel.classList.add('hidden'); selectedPolygonId = null; if (highlightLayer) map.removeLayer(highlightLayer); }
  }
});

// ---- Auto-refresh every 60s ----
setInterval(async () => {
  if (!isSaving) {
    await loadFromCloud();
    if (currentDistrict && geojsonData) {
      polygonLayer.setStyle((feat) => getPolygonStyle(feat));
      updateProgress();
      renderDrawnPolygonsOnMap();
      renderDrawnPolygonList();
    }
  }
}, 60000);

// ---- Init ----
init();
