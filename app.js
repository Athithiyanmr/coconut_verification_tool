/* ==========================================================
   Coconut Polygon Verifier — Tamil Nadu 2020
   Shared backend via Google Sheets (Apps Script Web App)
   ========================================================== */

// ---- Cloud Config ----
const GSHEET_API = 'https://script.google.com/macros/s/AKfycbzCaRbeDUUSuepn1_Mfn_pU88VuUEsRv86AT89DlGEgF-rLjCj009FjD_bRJltmTCU_/exec';

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

// Existing polygon editing state
let editingExistingId = null;
let editingExistingLayer = null;
let editingExistingOrigGeom = null;

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

// ---- Badge helpers ----
function updateDrawnBadge() {
  const badge = $('#drawnCountBadge');
  if (!badge) return;
  const count = drawnPolygons.filter(p => p.district === currentDistrict).length;
  badge.textContent = count;
  badge.style.background = count > 0 ? 'var(--blue)' : 'var(--text-faint)';
}

function expandDrawnPanel() {
  const btn = $('#drawnToggleBtn');
  const body = $('#drawnBody');
  const chevron = $('#drawnChevron');
  if (btn && body) {
    body.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }
}

// ---- District Index ----
async function loadDistrictIndex() {
  const res = await fetch('./data/districts.json');
  districtIndex = await res.json();
  const districts = Object.keys(districtIndex).sort();
  districts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d} (${districtIndex[d].count} polygons)`;
    districtSelect.appendChild(opt);
  });
}

// ---- Load GeoJSON for a District ----
async function loadDistrict(districtName) {
  const entry = districtIndex[districtName];
  if (!entry) return;

  currentDistrict = districtName;

  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  labelMarkers.forEach(m => map.removeLayer(m));
  labelMarkers = [];

  // Remove old boundary
  if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }

  const res = await fetch(`./data/${entry.file}`);
  geojsonData = await res.json();

  const allFeatures = geojsonData.features;

  renderPolygons(allFeatures);
  updateProgress();
  renderList();
  updateDrawnBadge();

  // Show UI
  progressSection.style.display = '';
  polygonListSection.style.display = '';
  sidebarFooter.style.display = '';
  $('#drawnPolygonsSection').style.display = '';
  $('#drawBtn').style.display = '';

  districtInfo.textContent = `${allFeatures.length} polygons loaded`;
  districtInfo.classList.remove('hidden');

  // Zoom to district
  const bounds = polygonLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });

  // Load district boundary
  try {
    const bRes = await fetch('./data/districts_boundary.geojson');
    districtBoundaries = await bRes.json();
    const feat = districtBoundaries.features.find(
      f => (f.properties.district || f.properties.DISTRICT || '').toLowerCase() === districtName.toLowerCase()
    );
    if (feat) {
      boundaryLayer = L.geoJSON(feat, {
        style: { color: '#e67e22', weight: 2.5, fill: false, dashArray: '6 4' }
      }).addTo(map);
    }
  } catch(e) {}

  // Restore drawn polygons for this district
  renderDrawnPolygons();
}

// ---- Render Polygons ----
function renderPolygons(features) {
  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  labelMarkers.forEach(m => map.removeLayer(m));
  labelMarkers = [];

  polygonLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: feature => stylePolygon(feature),
    onEachFeature: (feature, layer) => {
      const pid = feature.properties.id;
      layer.on('click', () => openVerifyPanel(pid));
    }
  }).addTo(map);

  addLabels(features);
}

function stylePolygon(feature) {
  const pid = feature.properties.id;
  const result = verificationResults[`${currentDistrict}:${pid}`];
  const status = result ? result.status : null;
  if (status === 'yes')  return { color: '#2d6a4f', weight: 1.5, fillColor: '#52b788', fillOpacity: 0.55 };
  if (status === 'no')   return { color: '#9b2335', weight: 1.5, fillColor: '#e06c75', fillOpacity: 0.55 };
  return { color: '#5a4e3a', weight: 1, fillColor: '#d4a843', fillOpacity: 0.35 };
}

function addLabels(features) {
  const zoom = map.getZoom();
  if (zoom < 13) return;
  features.forEach(f => {
    const pid = f.properties.id;
    const center = L.geoJSON(f).getBounds().getCenter();
    const marker = L.marker(center, {
      icon: L.divIcon({
        html: `<span style="font-size:10px;font-weight:600;color:#fff;background:rgba(0,0,0,0.45);padding:1px 4px;border-radius:3px">${pid}</span>`,
        className: '', iconAnchor: [16, 8]
      })
    }).addTo(map);
    labelMarkers.push(marker);
  });
}

map.on('zoomend', () => {
  if (!geojsonData) return;
  labelMarkers.forEach(m => map.removeLayer(m));
  labelMarkers = [];
  addLabels(geojsonData.features);
});

// ---- Progress ----
function updateProgress() {
  if (!geojsonData) return;
  const total = geojsonData.features.length;
  let yes = 0, no = 0;
  geojsonData.features.forEach(f => {
    const r = verificationResults[`${currentDistrict}:${f.properties.id}`];
    if (r?.status === 'yes') yes++;
    else if (r?.status === 'no') no++;
  });
  const done = yes + no;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#progressCount').textContent = `${done} / ${total}`;
  $('#progressFill').style.width = `${pct}%`;
  $('#statYes').textContent = yes;
  $('#statNo').textContent = no;
  $('#statPending').textContent = total - done;
}

// ---- Polygon List ----
function renderList() {
  if (!geojsonData) return;
  const filter = currentFilter;
  polygonList.innerHTML = '';
  let visible = 0;

  geojsonData.features.forEach(f => {
    const pid = f.properties.id;
    const key = `${currentDistrict}:${pid}`;
    const r = verificationResults[key];
    const status = r ? r.status : 'pending';

    if (filter !== 'all' && status !== filter) return;
    visible++;

    const item = document.createElement('div');
    item.className = `polygon-item status-${status}${pid === selectedPolygonId ? ' selected' : ''}`;
    item.dataset.pid = pid;
    item.innerHTML = `
      <span class="poly-id">#${pid}</span>
      <span class="poly-status poly-status-${status}">${status}</span>
      ${r?.user ? `<span class="poly-user">${r.user}</span>` : ''}
    `;
    item.addEventListener('click', () => openVerifyPanel(pid));
    polygonList.appendChild(item);
  });

  if (visible === 0) {
    polygonList.innerHTML = `<div class="poly-empty">No polygons match the filter.</div>`;
  }
}

// ---- Verify Panel ----
function openVerifyPanel(pid) {
  selectedPolygonId = pid;
  const key = `${currentDistrict}:${pid}`;
  const r = verificationResults[key];
  const feature = geojsonData.features.find(f => f.properties.id === pid);

  verifyPanel.classList.remove('hidden');
  $('#verifyTitle').textContent = `Polygon #${pid}`;

  // Area
  try {
    const areaSqM = turf.area(feature);
    const areaHa = (areaSqM / 10000).toFixed(2);
    $('#verifyArea').textContent = `${areaHa} ha`;
  } catch(e) { $('#verifyArea').textContent = ''; }

  // Verified-by
  const vb = $('#verifiedBy');
  if (r?.user) {
    vb.textContent = `Verified by ${r.user}`;
    vb.classList.remove('hidden');
  } else {
    vb.classList.add('hidden');
  }

  // Highlight on map
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  if (feature) {
    highlightLayer = L.geoJSON(feature, {
      style: { color: '#f59e0b', weight: 3, fillOpacity: 0 }
    }).addTo(map);
    const bounds = highlightLayer.getBounds();
    if (bounds.isValid()) map.panTo(bounds.getCenter());
  }

  // Edit polygon state
  if (editingExistingId) cancelEditExisting();

  updateListSelection();
  renderList();
}

function closeVerifyPanel() {
  verifyPanel.classList.add('hidden');
  selectedPolygonId = null;
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  if (editingExistingId) cancelEditExisting();
  renderList();
}

// ---- Verify Actions ----
async function verify(status) {
  if (!selectedPolygonId || !currentDistrict) return;
  const key = `${currentDistrict}:${selectedPolygonId}`;
  const ts = new Date().toISOString();
  verificationResults[key] = { status, user: currentUser, timestamp: ts };
  saveToCloud(key, status);

  refreshPolygonStyle(selectedPolygonId);
  updateProgress();
  renderList();

  const feature = geojsonData.features.find(f => f.properties.id === selectedPolygonId);
  const idx = geojsonData.features.indexOf(feature);
  const next = geojsonData.features[idx + 1];
  if (next) openVerifyPanel(next.properties.id);
  else closeVerifyPanel();
}

function modifyVerification() {
  if (!selectedPolygonId || !currentDistrict) return;
  const key = `${currentDistrict}:${selectedPolygonId}`;
  const existing = verificationResults[key];
  const who = existing?.user ? ` (by ${existing.user})` : '';
  const msg = existing
    ? `Clear the existing "${existing.status}"${who} verification?`
    : 'Mark this polygon as pending?';
  if (!confirm(msg)) return;

  delete verificationResults[key];
  saveToCloud(key, 'pending');
  refreshPolygonStyle(selectedPolygonId);
  updateProgress();

  const vb = $('#verifiedBy');
  vb.classList.add('hidden');
  renderList();
}

// ---- Edit Existing Polygon Shape ----
function startEditExisting() {
  if (!selectedPolygonId || !geojsonData) return;
  const feature = geojsonData.features.find(f => f.properties.id === selectedPolygonId);
  if (!feature) return;

  editingExistingId = selectedPolygonId;

  // Clone original geometry for cancel
  editingExistingOrigGeom = JSON.parse(JSON.stringify(feature.geometry));

  // Create editable layer
  editingExistingLayer = L.geoJSON(feature, {
    style: { color: '#f59e0b', weight: 2.5, fillColor: '#fbbf24', fillOpacity: 0.25 }
  }).addTo(map);

  // Enable editing on all layers
  editingExistingLayer.eachLayer(l => {
    if (l.editing) l.editing.enable();
  });

  // Update verify panel buttons
  const actionsDiv = $('.verify-actions');
  if (actionsDiv) {
    actionsDiv.innerHTML = `
      <button class="btn btn-primary" id="btnSaveEdit">Save Shape</button>
      <button class="btn btn-outline" id="btnCancelEdit">Cancel</button>
    `;
    $('#btnSaveEdit').addEventListener('click', saveEditExisting);
    $('#btnCancelEdit').addEventListener('click', cancelEditExisting);
  }
}

function saveEditExisting() {
  if (!editingExistingId || !editingExistingLayer) return;
  const feature = geojsonData.features.find(f => f.properties.id === editingExistingId);
  if (!feature) { cancelEditExisting(); return; }

  let newCoords = null;
  editingExistingLayer.eachLayer(l => {
    if (l.editing) l.editing.disable();
    newCoords = l.toGeoJSON().geometry;
  });

  if (newCoords) {
    feature.geometry = newCoords;
  }

  map.removeLayer(editingExistingLayer);
  editingExistingLayer = null;
  editingExistingId = null;
  editingExistingOrigGeom = null;

  renderPolygons(geojsonData.features);
  openVerifyPanel(selectedPolygonId);
}

function cancelEditExisting() {
  if (!editingExistingId || !editingExistingLayer) return;

  editingExistingLayer.eachLayer(l => {
    if (l.editing) l.editing.disable();
  });
  map.removeLayer(editingExistingLayer);
  editingExistingLayer = null;

  const feature = geojsonData.features.find(f => f.properties.id === editingExistingId);
  if (feature && editingExistingOrigGeom) {
    feature.geometry = editingExistingOrigGeom;
  }

  editingExistingId = null;
  editingExistingOrigGeom = null;

  openVerifyPanel(selectedPolygonId);
}

// ---- Drawn Polygons ----
function initDrawControl() {
  if (drawControl) return;
  drawControl = new L.Control.Draw({
    draw: {
      polygon: { shapeOptions: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2 }, showArea: true },
      polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
    },
    edit: false
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    const geojson = layer.toGeoJSON();
    const areaSqM = turf.area(geojson);
    const areaHa = (areaSqM / 10000).toFixed(3);

    // Check for overlaps with existing district polygons
    let overlapsExisting = [];
    if (geojsonData) {
      geojsonData.features.forEach(f => {
        try {
          const inter = turf.intersect(geojson, f);
          if (inter) {
            const interArea = turf.area(inter);
            const pct = Math.round((interArea / areaSqM) * 100);
            if (pct > 1) overlapsExisting.push({ id: f.properties.id, pct });
          }
        } catch(err) {}
      });
    }

    // Check overlaps with other drawn polygons (same district)
    let overlapsDrawn = [];
    drawnPolygons.filter(p => p.district === currentDistrict).forEach(p => {
      try {
        const pGeojson = { type: 'Feature', geometry: p.geometry };
        const inter = turf.intersect(geojson, pGeojson);
        if (inter) {
          const interArea = turf.area(inter);
          const pct = Math.round((interArea / areaSqM) * 100);
          if (pct > 1) overlapsDrawn.push({ id: p.id, pct });
        }
      } catch(err) {}
    });

    const proceed = () => {
      const id = `drawn_${Date.now()}`;
      const note = prompt('Add a note for this polygon (optional):') || '';
      const polygon = {
        id,
        district: currentDistrict,
        geometry: geojson.geometry,
        area_ha: parseFloat(areaHa),
        user: currentUser,
        timestamp: new Date().toISOString(),
        note,
        overlaps_existing: overlapsExisting
      };
      drawnPolygons.push(polygon);
      saveDrawnToCloud(polygon);
      addDrawnToMap(polygon);
      renderDrawnList();
      updateDrawnBadge();
      expandDrawnPanel();
    };

    if (overlapsExisting.length > 0 || overlapsDrawn.length > 0) {
      let msg = 'Warning: This polygon overlaps with:\n';
      if (overlapsExisting.length > 0)
        msg += `Existing polygons: ${overlapsExisting.map(o => `#${o.id} (${o.pct}%)`).join(', ')}\n`;
      if (overlapsDrawn.length > 0)
        msg += `New polygons: ${overlapsDrawn.map(o => `#${o.id} (${o.pct}%)`).join(', ')}`;
      msg += '\n\nSave anyway?';
      if (confirm(msg)) proceed();
    } else {
      proceed();
    }
  });
}

function addDrawnToMap(polygon) {
  if (drawnLayer && map.hasLayer(drawnLayer) && drawnLayerMap[polygon.id]) {
    map.removeLayer(drawnLayerMap[polygon.id].layer);
    if (drawnLayerMap[polygon.id].label) map.removeLayer(drawnLayerMap[polygon.id].label);
  }

  const layer = L.geoJSON({ type: 'Feature', geometry: polygon.geometry }, {
    pane: 'drawnPane',
    style: { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 }
  }).addTo(map);

  // Small label
  let labelMarker = null;
  try {
    const center = layer.getBounds().getCenter();
    labelMarker = L.marker(center, {
      pane: 'drawnLabelPane',
      icon: L.divIcon({
        html: `<span style="font-size:9px;font-weight:700;color:#1d4ed8;background:rgba(255,255,255,0.75);padding:1px 3px;border-radius:3px;white-space:nowrap">NEW</span>`,
        className: '', iconAnchor: [12, 6]
      })
    }).addTo(map);
  } catch(e) {}

  drawnLayerMap[polygon.id] = { layer, label: labelMarker };
}

function addDrawnLabels() {}

function renderDrawnPolygons() {
  // Remove all drawn layers
  Object.values(drawnLayerMap).forEach(({ layer, label }) => {
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    if (label && map.hasLayer(label)) map.removeLayer(label);
  });
  drawnLayerMap = {};

  drawnPolygons.filter(p => p.district === currentDistrict).forEach(p => addDrawnToMap(p));
  renderDrawnList();
}

function renderDrawnList() {
  const list = $('#drawnPolygonList');
  const empty = $('#drawnEmpty');
  if (!list) return;

  const districtPolys = drawnPolygons.filter(p => p.district === currentDistrict);

  if (districtPolys.length === 0) {
    list.innerHTML = '';
    if (empty) { empty.style.display = ''; list.appendChild(empty); }
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = '';
  districtPolys.forEach(p => {
    const card = document.createElement('div');
    card.className = `drawn-card${editingDrawnId === p.id ? ' editing' : ''}`;
    card.innerHTML = `
      <div class="drawn-card-header">
        <span class="drawn-card-id">NEW • ${p.area_ha} ha</span>
        <span class="drawn-card-user">${p.user || ''}</span>
      </div>
      ${p.note ? `<div class="drawn-card-note">${p.note}</div>` : ''}
      <div class="drawn-card-actions">
        <button class="btn btn-sm drawn-btn-zoom" data-id="${p.id}">Zoom</button>
        <button class="btn btn-sm drawn-btn-edit" data-id="${p.id}">${editingDrawnId === p.id ? 'Save' : 'Edit'}</button>
        <button class="btn btn-sm drawn-btn-delete" data-id="${p.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.drawn-btn-zoom').forEach(btn => {
    btn.addEventListener('click', () => zoomDrawn(btn.dataset.id));
  });
  list.querySelectorAll('.drawn-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      if (editingDrawnId === btn.dataset.id) saveEditDrawn(btn.dataset.id);
      else startEditDrawn(btn.dataset.id);
    });
  });
  list.querySelectorAll('.drawn-btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteDrawn(btn.dataset.id));
  });
}

function zoomDrawn(id) {
  const entry = drawnLayerMap[id];
  if (entry?.layer) {
    const bounds = entry.layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  }
}

function startEditDrawn(id) {
  if (editingDrawnId) saveEditDrawn(editingDrawnId);

  editingDrawnId = id;
  const entry = drawnLayerMap[id];
  if (!entry) return;

  editingLeafletLayer = entry.layer;
  editingLeafletLayer.eachLayer(l => {
    if (l.editing) l.editing.enable();
    l.setStyle({ color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 0.25 });
  });
  renderDrawnList();
}

function saveEditDrawn(id) {
  const entry = drawnLayerMap[id];
  if (!entry) { editingDrawnId = null; editingLeafletLayer = null; renderDrawnList(); return; }

  let newGeom = null;
  entry.layer.eachLayer(l => {
    if (l.editing) l.editing.disable();
    newGeom = l.toGeoJSON().geometry;
    l.setStyle({ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.12 });
  });

  const poly = drawnPolygons.find(p => p.id === id);
  if (poly && newGeom) {
    poly.geometry = newGeom;
    poly.area_ha = parseFloat((turf.area({ type: 'Feature', geometry: newGeom }) / 10000).toFixed(3));
    saveDrawnToCloud(poly);
  }

  editingDrawnId = null;
  editingLeafletLayer = null;
  renderDrawnList();
}

function deleteDrawn(id) {
  if (!confirm('Delete this drawn polygon?')) return;
  const poly = drawnPolygons.find(p => p.id === id);
  if (poly) deleteDrawnFromCloud(poly);

  const entry = drawnLayerMap[id];
  if (entry) {
    if (entry.layer && map.hasLayer(entry.layer)) map.removeLayer(entry.layer);
    if (entry.label && map.hasLayer(entry.label)) map.removeLayer(entry.label);
    delete drawnLayerMap[id];
  }

  drawnPolygons = drawnPolygons.filter(p => p.id !== id);
  if (editingDrawnId === id) { editingDrawnId = null; editingLeafletLayer = null; }
  renderDrawnList();
  updateDrawnBadge();
}

// ---- Cloud Sync ----
async function loadFromCloud() {
  updateSyncUI('connecting');
  try {
    const res = await fetch(`${GSHEET_API}?action=getAll`);
    const data = await res.json();
    if (data.verifications) {
      Object.entries(data.verifications).forEach(([key, val]) => {
        if (val.status && val.status !== 'pending') {
          verificationResults[key] = val;
        }
      });
    }
    if (data.drawnPolygons) {
      drawnPolygons = data.drawnPolygons;
    }
    updateSyncUI('synced');
    if (currentDistrict) {
      renderPolygons(geojsonData.features);
      updateProgress();
      renderList();
      renderDrawnPolygons();
    }
  } catch(e) {
    updateSyncUI('error');
  }
}

async function saveToCloud(key, status) {
  if (isSaving) return;
  isSaving = true;
  updateSyncUI('saving');
  try {
    await fetch(GSHEET_API, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveVerification',
        key, status,
        user: currentUser,
        timestamp: new Date().toISOString()
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    updateSyncUI('synced');
  } catch(e) {
    updateSyncUI('error');
  } finally {
    isSaving = false;
  }
}

async function saveDrawnToCloud(polygon) {
  try {
    await fetch(GSHEET_API, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveDrawnPolygon', ...polygon }),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch(e) {}
}

async function deleteDrawnFromCloud(polygon) {
  try {
    await fetch(GSHEET_API, {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteDrawnPolygon', id: polygon.id, district: polygon.district }),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch(e) {}
}

function updateSyncUI(state) {
  const indicator = $('#syncIndicator');
  if (!indicator) return;
  const dot = indicator.querySelector('.sync-dot');
  const text = indicator.querySelector('.sync-text');
  const states = {
    connecting: ['dot-connecting', 'Connecting...'],
    synced:     ['dot-synced',     'Synced'],
    saving:     ['dot-saving',     'Saving...'],
    error:      ['dot-error',      'Offline']
  };
  const [cls, label] = states[state] || states.error;
  if (dot) { dot.className = `sync-dot ${cls}`; }
  if (text) text.textContent = label;
}

// ---- Helpers ----
function refreshPolygonStyle(pid) {
  if (!polygonLayer) return;
  polygonLayer.eachLayer(layer => {
    if (layer.feature?.properties?.id === pid) {
      layer.setStyle(stylePolygon(layer.feature));
    }
  });
}

function updateListSelection() {
  document.querySelectorAll('.polygon-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.pid == selectedPolygonId);
  });
}

// ---- Export ----
function exportCSV(districtName, features) {
  const rows = [['polygon_id', 'status', 'verified_by', 'timestamp', 'area_ha']];
  features.forEach(f => {
    const pid = f.properties.id;
    const key = `${districtName}:${pid}`;
    const r = verificationResults[key];
    let areaHa = '';
    try { areaHa = (turf.area(f) / 10000).toFixed(3); } catch(e) {}
    rows.push([pid, r?.status || 'pending', r?.user || '', r?.timestamp || '', areaHa]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`${districtName}_verification.csv`, csv, 'text/csv');
}

function exportGeoJSON(districtName, features) {
  const enriched = features.map(f => {
    const key = `${districtName}:${f.properties.id}`;
    const r = verificationResults[key];
    return { ...f, properties: { ...f.properties, status: r?.status || 'pending', verified_by: r?.user || '', timestamp: r?.timestamp || '' } };
  });
  const fc = JSON.stringify({ type: 'FeatureCollection', features: enriched }, null, 2);
  download(`${districtName}_verification.geojson`, fc, 'application/json');
}

async function exportAllCSV() {
  const districts = Object.keys(districtIndex);
  const rows = [['district', 'polygon_id', 'status', 'verified_by', 'timestamp', 'area_ha']];
  for (const d of districts) {
    try {
      const res = await fetch(`./data/${districtIndex[d].file}`);
      const gj = await res.json();
      gj.features.forEach(f => {
        const pid = f.properties.id;
        const key = `${d}:${pid}`;
        const r = verificationResults[key];
        let areaHa = '';
        try { areaHa = (turf.area(f) / 10000).toFixed(3); } catch(e) {}
        rows.push([d, pid, r?.status || 'pending', r?.user || '', r?.timestamp || '', areaHa]);
      });
    } catch(e) {}
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download('all_districts_verification.csv', csv, 'text/csv');
}

async function exportAllGeoJSON() {
  const districts = Object.keys(districtIndex);
  const allFeatures = [];
  for (const d of districts) {
    try {
      const res = await fetch(`./data/${districtIndex[d].file}`);
      const gj = await res.json();
      gj.features.forEach(f => {
        const key = `${d}:${f.properties.id}`;
        const r = verificationResults[key];
        allFeatures.push({ ...f, properties: { district: d, ...f.properties, status: r?.status || 'pending', verified_by: r?.user || '', timestamp: r?.timestamp || '' } });
      });
    } catch(e) {}
  }
  const fc = JSON.stringify({ type: 'FeatureCollection', features: allFeatures }, null, 2);
  download('all_districts_verification.geojson', fc, 'application/json');
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

// ---- Filter Buttons ----
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });
});

// ---- District Select ----
districtSelect.addEventListener('change', () => {
  const d = districtSelect.value;
  if (d) loadDistrict(d);
});

// ---- Verify Panel Buttons ----
$('#btnYes').addEventListener('click',  () => verify('yes'));
$('#btnNo').addEventListener('click',   () => verify('no'));
$('#btnSkip').addEventListener('click', closeVerifyPanel);
$('#btnModify').addEventListener('click', modifyVerification);
$('#closeVerify').addEventListener('click', closeVerifyPanel);

$('#btnPrev').addEventListener('click', () => {
  if (!selectedPolygonId || !geojsonData) return;
  const features = geojsonData.features;
  const idx = features.findIndex(f => f.properties.id === selectedPolygonId);
  if (idx > 0) openVerifyPanel(features[idx - 1].properties.id);
});

$('#btnNext').addEventListener('click', () => {
  if (!selectedPolygonId || !geojsonData) return;
  const features = geojsonData.features;
  const idx = features.findIndex(f => f.properties.id === selectedPolygonId);
  if (idx < features.length - 1) openVerifyPanel(features[idx + 1].properties.id);
});

// ---- Overlay Toggle ----
$('#overlayToggle').addEventListener('change', (e) => {
  if (!polygonLayer) return;
  if (e.target.checked) map.addLayer(polygonLayer);
  else map.removeLayer(polygonLayer);
});

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'y' || e.key === 'Y') { if (!verifyPanel.classList.contains('hidden')) verify('yes'); }
  if (e.key === 'n' || e.key === 'N') { if (!verifyPanel.classList.contains('hidden')) verify('no'); }
  if (e.key === ' ') { e.preventDefault(); if (!verifyPanel.classList.contains('hidden')) closeVerifyPanel(); }
  if (e.key === 'Escape') closeVerifyPanel();
  if (e.key === 'M' || e.key === 'm') { if (!verifyPanel.classList.contains('hidden')) modifyVerification(); }
  if (e.key === 'ArrowRight') $('#btnNext')?.click();
  if (e.key === 'ArrowLeft')  $('#btnPrev')?.click();
});

// ---- Export Buttons ----
$('#exportBtn').addEventListener('click', () => {
  if (currentDistrict && geojsonData) exportCSV(currentDistrict, geojsonData.features);
});
$('#exportJsonBtn').addEventListener('click', () => {
  if (currentDistrict && geojsonData) exportGeoJSON(currentDistrict, geojsonData.features);
});
$('#exportAllBtn').addEventListener('click', exportAllCSV);
$('#exportAllGeoBtn').addEventListener('click', exportAllGeoJSON);

// ---- Refresh ----
$('#refreshBtn').addEventListener('click', () => loadFromCloud().then(() => { if (currentDistrict) renderPolygons(geojsonData.features); }));

// ---- Draw Button ----
$('#drawBtn').addEventListener('click', () => {
  initDrawControl();
  // Simulate click on the polygon draw button in leaflet.draw
  const drawBtn = document.querySelector('.leaflet-draw-draw-polygon');
  if (drawBtn) drawBtn.click();
});

// ---- Drawn Panel Toggle ----
$('#drawnToggleBtn').addEventListener('click', () => {
  const body = $('#drawnBody');
  const chevron = $('#drawnChevron');
  const btn = $('#drawnToggleBtn');
  const isOpen = btn.getAttribute('aria-expanded') === 'true';
  body.style.display = isOpen ? 'none' : '';
  btn.setAttribute('aria-expanded', String(!isOpen));
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
});

// ---- Guide Panel ----
$('#guideToggle').addEventListener('click', () => {
  const panel = $('#guidePanel');
  panel.classList.toggle('hidden');
});
$('#closeGuide').addEventListener('click', () => {
  $('#guidePanel').classList.add('hidden');
});

// ---- User Modal ----
$('#userNameSubmit').addEventListener('click', () => {
  const val = $('#userName').value.trim();
  if (!val) return;
  currentUser = val;
  $('#currentUserDisplay').textContent = val;
  $('#userModal').style.display = 'none';
  loadFromCloud();
});
$('#userName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#userNameSubmit').click();
});

// ---- Init ----
loadDistrictIndex();
