/* ==========================================================
   Coconut Polygon Verifier — Tamil Nadu 2020
   Worker Assignment System — Google Sheets / Apps Script
   ========================================================== */

// ---- Cloud Config ----
const GSHEET_API = 'https://script.google.com/macros/s/AKfycbw2Qgfv7U-gG39a4Z1uvrf_5ZFQnZnj6QMmgj4zmSNTsXobCHKpzRi_ClQBl_vJ0ZZV/exec';

// ---- Google Form for worker registration ----
const WORKER_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScj_Bj2yGwSUZpbIPWALjPMfpzYCM2-zvK0rwDvvpLlfeSu7A/viewform';

// ---- ADMIN CONFIG ----
const ADMIN_NAMES = ['athithiyan'];

function isAdmin(name) {
  return ADMIN_NAMES.includes((name || '').trim().toLowerCase());
}

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

// Worker assignment
let workerAssignment = null;

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
map.createPane('drawnLabelPane').style.pointerEvents = 'none';

// ---- DOM Refs ----
const $ = (s) => document.querySelector(s);
const districtSelect = $('#districtSelect');
const districtInfo = $('#districtInfo');
const progressSection = $('#progressSection');
const polygonListSection = $('#polygonListSection');
const polygonList = $('#polygonList');
const verifyPanel = $('#verifyPanel');
const loadingOverlay = $('#loadingOverlay');

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

async function fetchWorkerAssignment(name) {
  try {
    const res = await fetch(`${GSHEET_API}?action=getWorker&name=${encodeURIComponent(name)}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('Worker lookup failed:', e);
    return { found: false, message: 'Could not reach server.' };
  }
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
      style: { color, weight: isEditing ? 3 : 2, dashArray: isEditing ? null : '6 4', fillColor: color, fillOpacity: isEditing ? 0.25 : 0.10, opacity: 0.9 },
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
        icon: L.divIcon({ className: labelClass, html: `<span style="border-color:${color};background:${color}cc">N${entry.id.replace('new_', '')}</span>`, iconSize: [28, 18], iconAnchor: [14, 9] }),
        interactive: true, zIndexOffset: 1000 + index,
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

function addDrawnLabels() {}

function zoomToDrawnPolygon(entry) {
  const layer = L.geoJSON(entry.geometry);
  map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 18 });
}

function renderDrawnPolygonList() {
  const list = $('#drawnPolygonList');
  const empty = $('#drawnEmpty');
  if (!list) return;
  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);
  list.querySelectorAll('.drawn-polygon-item').forEach(el => el.remove());
  if (districtPolys.length === 0) { if (empty) empty.style.display = ''; return; }
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
          <button class="dp-btn dp-btn-edit ${isEditing ? 'dp-btn-active' : ''}" title="Edit shape">
            ✏️ ${isEditing ? 'Editing…' : 'Edit Shape'}
          </button>
          <button class="dp-btn dp-btn-note" title="Edit note">📝 Note</button>
          <button class="dp-btn dp-btn-delete" title="Delete polygon">🗑 Delete</button>
        ` : ''}
      </div>`;
    div.querySelector('.dp-btn-zoom').addEventListener('click', () => zoomToDrawnPolygon(entry));
    if (isOwner) {
      div.querySelector('.dp-btn-edit').addEventListener('click', () => { isEditing ? stopEditingDrawnPolygon(false) : startEditingDrawnPolygon(entry.id); });
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

// ================================================================
//  WORKER HELPERS — multi-district support
// ================================================================

function getWorkerRangesForDistrict(districtName) {
  if (!workerAssignment || isAdmin(currentUser)) return null;
  const distLower = districtName.toLowerCase();

  if (Array.isArray(workerAssignment.districts) && workerAssignment.districts.length > 0) {
    const match = workerAssignment.districts.find(d => d.district.toLowerCase() === distLower);
    return match ? match.ranges : null;
  }

  if (workerAssignment.district && workerAssignment.district.toLowerCase() === distLower) {
    return workerAssignment.ranges || [{ start: workerAssignment.assignedStart, end: workerAssignment.assignedEnd }];
  }

  return null;
}

function isWorkerAssignedToDistrict(districtName) {
  if (isAdmin(currentUser)) return true;
  return getWorkerRangesForDistrict(districtName) !== null;
}

function getWorkerDistricts() {
  if (!workerAssignment || isAdmin(currentUser)) return [];
  if (Array.isArray(workerAssignment.districts) && workerAssignment.districts.length > 0) {
    return workerAssignment.districts.map(d => d.district);
  }
  if (workerAssignment.district) return [workerAssignment.district];
  return [];
}

// ================================================================
//  ADMIN-ONLY: EXPORT DISTRICT GEOJSON
// ================================================================

function showAdminExportSection() {
  const section = document.getElementById('adminExportSection');
  if (section) section.classList.remove('hidden');
  const btn = document.getElementById('btnExportDistGeo');
  if (btn) {
    btn.disabled = !currentDistrict;
    btn.addEventListener('click', exportCurrentDistrictGeoJSON);
  }
}

function updateAdminExportButton() {
  if (!isAdmin(currentUser)) return;
  const btn = document.getElementById('btnExportDistGeo');
  if (btn) {
    btn.disabled = !currentDistrict;
    btn.textContent = currentDistrict
      ? `Export ${currentDistrict} GeoJSON`
      : 'Export District GeoJSON';
  }
}

function exportCurrentDistrictGeoJSON() {
  if (!geojsonData || !currentDistrict) { alert('Please select a district first.'); return; }

  // Original polygons with verification status attached
  const originalFeatures = geojsonData.features.map(f => {
    const key = `${currentDistrict}:${f.properties.id}`;
    return {
      ...f,
      properties: {
        ...f.properties,
        source: 'original',
        verification_status: getStatus(key) || 'pending',
        verified_by: getVerifier(key) || '',
      }
    };
  });

  // Drawn (new) polygons by all workers for this district
  const drawnFeatures = drawnPolygons
    .filter(p => p.district === currentDistrict)
    .map(p => ({
      type: 'Feature',
      geometry: p.geometry,
      properties: {
        id: p.id,
        area_ha: p.area_ha,
        note: p.note || '',
        drawn_by: p.user || '',
        drawn_at: p.timestamp || '',
        overlaps_existing: (p.overlaps_existing || []).join(', '),
        source: 'drawn',
        verification_status: 'pending',
        verified_by: '',
      }
    }));

  const enriched = {
    type: 'FeatureCollection',
    name: currentDistrict,
    exported_at: new Date().toISOString(),
    original_count: originalFeatures.length,
    drawn_count: drawnFeatures.length,
    features: [...originalFeatures, ...drawnFeatures],
  };

  const filename = `${currentDistrict.toLowerCase().replace(/\s+/g, '_')}_verified.geojson`;
  downloadFile(JSON.stringify(enriched, null, 2), filename, 'application/geo+json');
}

// ================================================================
//  INIT & USER LOGIN
// ================================================================

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
  const statusEl = $('#userLoginStatus');

  const formLinkEl = document.getElementById('workerFormLink');
  const formAnchor = document.getElementById('workerFormAnchor');
  if (formLinkEl && formAnchor) {
    formAnchor.href = WORKER_FORM_URL;
    formLinkEl.style.display = '';
  }

  if (input && btn) {
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }

      if (isAdmin(name)) {
        currentUser = name;
        workerAssignment = null;
        modal.classList.add('hidden');
        if ($('#currentUserDisplay')) $('#currentUserDisplay').textContent = currentUser;
        showAdminBadge();
        showAdminExportSection();
        if (districtSelect) districtSelect.disabled = false;
        if (statusEl) statusEl.classList.add('hidden');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Looking up assignment…';
      if (statusEl) { statusEl.className = 'login-status login-status-loading'; statusEl.textContent = 'Checking worker registration…'; statusEl.classList.remove('hidden'); }

      const assignment = await fetchWorkerAssignment(name);

      if (assignment.found) {
        workerAssignment = assignment;
        currentUser = assignment.name;
        modal.classList.add('hidden');
        if ($('#currentUserDisplay')) $('#currentUserDisplay').textContent = currentUser;
        showAssignmentBadge(assignment);
        applyWorkerAssignment(assignment);
      } else {
        btn.disabled = false;
        btn.textContent = 'Start Verifying';
        if (statusEl) {
          statusEl.className = 'login-status login-status-warn';
          statusEl.textContent = `⚠️ Not registered yet. Please fill the Google Form first, then try again.`;
          statusEl.classList.remove('hidden');
        }
      }
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }
}

function showAdminBadge() {
  const badge = $('#assignmentBadge');
  const text = $('#assignmentText');
  if (!badge || !text) return;
  text.innerHTML = `👑 <b>Admin</b> &nbsp;·&nbsp; Full access — all districts &amp; all polygons`;
  badge.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
  badge.style.borderColor = '#f1c40f';
  badge.style.color = '#f1c40f';
  badge.classList.remove('hidden');
}

function showAssignmentBadge(assignment) {
  const badge = $('#assignmentBadge');
  const text = $('#assignmentText');
  if (!badge || !text) return;

  const districts = getWorkerDistricts();

  if (districts.length === 0) {
    text.innerHTML = `⚠️ No districts assigned yet`;
  } else if (districts.length === 1) {
    const d = Array.isArray(assignment.districts) ? assignment.districts[0] : null;
    const rangeStr = d
      ? d.ranges.map(r => `${r.start}–${r.end}`).join(', ')
      : `${assignment.assignedStart}–${assignment.assignedEnd}`;
    const capacity = assignment.capacity || '';
    text.innerHTML = `📍 <b>${districts[0]}</b> &nbsp;·&nbsp; Polygons <b>${rangeStr}</b>${capacity ? ` &nbsp;·&nbsp; ${capacity}` : ''}`;
  } else {
    const districtDetails = assignment.districts.map(d => {
      const rangeStr = d.ranges.map(r => `${r.start}–${r.end}`).join(', ');
      return `<b>${d.district}</b> (${rangeStr})`;
    }).join(' &nbsp;|&nbsp; ');
    text.innerHTML = `📍 ${districtDetails}`;
  }

  badge.classList.remove('hidden');
}

async function applyWorkerAssignment(assignment) {
  const assignedDistricts = getWorkerDistricts();

  if (assignedDistricts.length === 0) return;

  if (districtSelect) {
    const assignedSet = new Set(assignedDistricts.map(d => d.toLowerCase()));
    const toRemove = [];
    Array.from(districtSelect.options).forEach(opt => {
      if (!opt.value) return;
      if (!assignedSet.has(opt.value.toLowerCase())) {
        toRemove.push(opt);
      }
    });
    toRemove.forEach(opt => opt.remove());
    districtSelect.disabled = false;
  }

  await loadFromCloud();

  const firstDistrict = assignedDistricts[0];
  if (districtSelect) districtSelect.value = firstDistrict;
  await loadDistrict(firstDistrict);
}

function getAssignedFeatures(allFeatures) {
  if (!workerAssignment || isAdmin(currentUser)) return allFeatures;
  const ranges = getWorkerRangesForDistrict(currentDistrict);
  if (!ranges) return allFeatures;
  return allFeatures.filter(f => {
    const id = parseInt(f.properties.id);
    return ranges.some(r => id >= r.start && id <= r.end);
  });
}

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

  const res = await fetch(info.file);
  const rawData = await res.json();

  const ranges = getWorkerRangesForDistrict(name);

  if (!isAdmin(currentUser) && ranges) {
    const filtered = getAssignedFeatures(rawData.features);
    geojsonData = { ...rawData, features: filtered };
    const rangeStr = ranges.map(r => `${r.start}–${r.end}`).join(', ');
    districtInfo.innerHTML = `<b>${name}</b> — Your range: polygons <b>${rangeStr}</b> (${filtered.length} shown)`;
  } else {
    geojsonData = rawData;
    if (isAdmin(currentUser)) {
      districtInfo.innerHTML = `<b>${name}</b> — ${info.count.toLocaleString()} polygons &nbsp;<span style="color:#f1c40f;font-size:0.75rem">👑 Admin view</span>`;
    } else {
      districtInfo.innerHTML = `<b>${name}</b> — ${info.count.toLocaleString()} polygons`;
    }
  }

  clearMap();
  showDistrictBoundary(name);
  polygonLayer = L.geoJSON(geojsonData, {
    style: (feature) => getPolygonStyle(feature),
    onEachFeature: (feature, layer) => { layer.on('click', () => selectPolygon(feature.properties.id)); }
  }).addTo(map);
  addLabels();
  map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40] });

  progressSection.style.display = 'block';
  polygonListSection.style.display = 'flex';
  const drawnSection = $('#drawnPolygonsSection');
  if (drawnSection) drawnSection.style.display = 'flex';

  renderPolygonList();
  updateProgress();
  renderDrawnPolygonsOnMap();
  renderDrawnPolygonList();
  loadingOverlay.classList.add('hidden');
  enableDrawControl();
  map.off('moveend', onMapMove);
  map.on('moveend', onMapMove);

  // Update admin export button label when district changes
  updateAdminExportButton();
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

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderPolygonList();
  });
});

const refreshBtn = $('#refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing...';
    await loadFromCloud();
    if (currentDistrict && geojsonData) {
      polygonLayer.setStyle((feat) => getPolygonStyle(feat));
      renderPolygonList(); updateProgress(); addLabels();
    }
    refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh';
  });
}

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

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.addEventListener('keydown', (e) => {
  if ($('#userModal') && !$('#userModal').classList.contains('hidden')) return;
  if (!verifyPanel.classList.contains('hidden')) {
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); verifyPolygon('yes'); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); verifyPolygon('no'); }
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); modifyVerification(); }
    if (e.key === 's' || e.key === 'S' || e.key === ' ') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigatePolygon(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePolygon(-1); }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); const toggle = $('#overlayToggle'); toggle.checked = !toggle.checked; updateOverlayVisibility(toggle.checked); }
    if (e.key === 'Escape') { verifyPanel.classList.add('hidden'); selectedPolygonId = null; if (highlightLayer) map.removeLayer(highlightLayer); }
  }
});

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

init();
