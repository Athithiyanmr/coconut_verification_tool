/* ================================================================
   Coconut Polygon Verifier — Google Apps Script Backend
   Paste this entire file into Google Apps Script editor.

   SHEETS NEEDED IN YOUR SPREADSHEET:
   1. "verifications"  — polygon verification records
   2. "drawnPolygons" — user-drawn polygon shapes
   3. "workers"        — from Google Form responses (or manually filled)

   WORKERS SHEET COLUMNS (Row 1 = headers):
   A: Timestamp  B: Name  C: District  D: TimePerDay (10/15/20)
   E: AssignedStart  F: AssignedEnd  (filled automatically by this script)
   ================================================================ */

const SHEET_VERIFICATIONS = 'verifications';
const SHEET_DRAWN = 'drawnPolygons';
const SHEET_WORKERS = 'workers';

// Time → polygon count mapping
const TIME_TO_POLYGONS = { '10': 500, '15': 750, '20': 1000 };

function doGet(e) {
  const action = e.parameter.action || 'getAll';
  if (action === 'getAll')       return jsonResponse(getAllData());
  if (action === 'getWorker')    return jsonResponse(getWorkerAssignment(e.parameter.name));
  if (action === 'getWorkers')   return jsonResponse(getAllWorkers());
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'saveVerification')  return jsonResponse(saveVerification(body));
    if (body.action === 'saveDrawnPolygon') return jsonResponse(saveDrawnPolygon(body));
    if (body.action === 'deleteDrawnPolygon') return jsonResponse(deleteDrawnPolygon(body));
    if (body.action === 'registerWorker')   return jsonResponse(registerWorker(body));
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- getAll (verifications + drawnPolygons) ----
function getAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vSheet = getOrCreateSheet(ss, SHEET_VERIFICATIONS);
  const dSheet = getOrCreateSheet(ss, SHEET_DRAWN);

  const verifications = {};
  const vData = vSheet.getDataRange().getValues();
  for (let i = 1; i < vData.length; i++) {
    const [key, status, user, timestamp] = vData[i];
    if (key) verifications[key] = { status, user, timestamp };
  }

  const drawnPolygons = [];
  const dData = dSheet.getDataRange().getValues();
  for (let i = 1; i < dData.length; i++) {
    const [district, id, geometryJson, area_ha, user, timestamp, note, overlaps] = dData[i];
    if (!id) continue;
    try {
      drawnPolygons.push({
        district, id,
        geometry: JSON.parse(geometryJson || '{}'),
        area_ha, user, timestamp, note,
        overlaps_existing: overlaps ? overlaps.split(',') : []
      });
    } catch (e) {}
  }

  return { verifications, drawnPolygons };
}

// ---- saveVerification ----
function saveVerification(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_VERIFICATIONS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.key) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[body.key, body.status, body.user, body.timestamp]]);
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow([body.key, body.status, body.user, body.timestamp]);
  return { ok: true, inserted: true };
}

// ---- saveDrawnPolygon ----
function saveDrawnPolygon(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_DRAWN);
  const data = sheet.getDataRange().getValues();
  const geoStr = JSON.stringify(body.geometry || {});
  const overlapsStr = (body.overlaps_existing || []).join(',');
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.district && data[i][1] === body.id) {
      sheet.getRange(i + 1, 1, 1, 8).setValues([[body.district, body.id, geoStr, body.area_ha, body.user, body.timestamp, body.note, overlapsStr]]);
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow([body.district, body.id, geoStr, body.area_ha, body.user, body.timestamp, body.note, overlapsStr]);
  return { ok: true, inserted: true };
}

// ---- deleteDrawnPolygon ----
function deleteDrawnPolygon(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_DRAWN);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.district && data[i][1] === body.id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, reason: 'Not found' };
}

// ================================================================
//  WORKER ASSIGNMENT SYSTEM
// ================================================================

/*
  Workers sheet columns:
  A: Timestamp  B: Name  C: District  D: TimePerDay
  E: AssignedStart  F: AssignedEnd

  When a name is looked up:
  - If AssignedStart & AssignedEnd are already set → return them
  - If not set → calculate next available range for that district
    (find the max AssignedEnd for that district, add 1)
  - Save back to sheet
*/

function getWorkerAssignment(name) {
  if (!name) return { error: 'No name provided' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_WORKERS);
  const data = sheet.getDataRange().getValues();

  // Find the worker row (case-insensitive trim match)
  const nameLower = name.trim().toLowerCase();
  let workerRow = -1;
  let workerData = null;

  for (let i = 1; i < data.length; i++) {
    const rowName = String(data[i][1] || '').trim().toLowerCase();
    if (rowName === nameLower) {
      workerRow = i + 1; // 1-indexed sheet row
      workerData = data[i];
      break;
    }
  }

  if (!workerData) {
    return { found: false, message: 'Name not found in workers sheet. Please register via the Google Form first.' };
  }

  const district  = String(workerData[2] || '').trim();
  const timeInput = String(workerData[3] || '10').trim();
  const capacity  = TIME_TO_POLYGONS[timeInput] || 500;

  let assignedStart = parseInt(workerData[4]) || 0;
  let assignedEnd   = parseInt(workerData[5]) || 0;

  // Already assigned — return existing range
  if (assignedStart > 0 && assignedEnd > 0) {
    return {
      found: true,
      name: String(workerData[1]).trim(),
      district,
      timePerDay: timeInput,
      capacity,
      assignedStart,
      assignedEnd
    };
  }

  // Not yet assigned — calculate next free range for this district
  let maxEnd = 0;
  for (let i = 1; i < data.length; i++) {
    const rowDistrict = String(data[i][2] || '').trim();
    const rowEnd = parseInt(data[i][5]) || 0;
    if (rowDistrict.toLowerCase() === district.toLowerCase() && rowEnd > maxEnd) {
      maxEnd = rowEnd;
    }
  }

  assignedStart = maxEnd + 1;
  assignedEnd   = assignedStart + capacity - 1;

  // Save back to sheet
  sheet.getRange(workerRow, 5).setValue(assignedStart);
  sheet.getRange(workerRow, 6).setValue(assignedEnd);

  return {
    found: true,
    name: String(workerData[1]).trim(),
    district,
    timePerDay: timeInput,
    capacity,
    assignedStart,
    assignedEnd
  };
}

// ---- getAllWorkers (admin use) ----
function getAllWorkers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_WORKERS);
  const data = sheet.getDataRange().getValues();
  const workers = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    workers.push({
      name:           String(data[i][1] || '').trim(),
      district:       String(data[i][2] || '').trim(),
      timePerDay:     String(data[i][3] || '').trim(),
      capacity:       TIME_TO_POLYGONS[String(data[i][3] || '10').trim()] || 500,
      assignedStart:  parseInt(data[i][4]) || 0,
      assignedEnd:    parseInt(data[i][5]) || 0
    });
  }
  return { workers };
}

// ---- registerWorker (from tool itself if needed) ----
function registerWorker(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_WORKERS);
  const data = sheet.getDataRange().getValues();
  const nameLower = String(body.name || '').trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1] || '').trim().toLowerCase() === nameLower) {
      return { ok: false, reason: 'Name already registered' };
    }
  }
  sheet.appendRow([new Date().toISOString(), body.name, body.district, body.timePerDay, '', '']);
  return { ok: true };
}

// ---- Helper ----
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_VERIFICATIONS) sheet.appendRow(['key', 'status', 'user', 'timestamp']);
    if (name === SHEET_DRAWN)         sheet.appendRow(['district', 'id', 'geometry', 'area_ha', 'user', 'timestamp', 'note', 'overlaps_existing']);
    if (name === SHEET_WORKERS)       sheet.appendRow(['Timestamp', 'Name', 'District', 'TimePerDay', 'AssignedStart', 'AssignedEnd']);
  }
  return sheet;
}
