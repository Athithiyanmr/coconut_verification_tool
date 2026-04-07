// ============================================================
// Google Apps Script — Coconut Verifier Backend
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://sheets.google.com → Create a new blank spreadsheet
// 2. Name it "Coconut Verifier Data"
// 3. Rename Sheet1 to "verifications" 
// 4. Add headers in Row 1: key | status | user | timestamp
// 5. Create a second sheet named "drawn_polygons"
// 6. Add headers in Row 1: id | district | geometry | area_ha | user | timestamp | note
// 7. Go to Extensions → Apps Script
// 8. Delete any existing code and paste this entire file
// 9. Click Deploy → New Deployment
// 10. Select type: "Web app"
// 11. Set "Execute as": Me
// 12. Set "Who has access": Anyone
// 13. Click Deploy → Authorize → Copy the Web App URL
// 14. Paste that URL into app.js as the API_URL value
// ============================================================

const SHEET_NAME_VERIFICATIONS = 'verifications';
const SHEET_NAME_DRAWN = 'drawn_polygons';

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e.parameter.action || 'getAll';

  let result;
  if (action === 'getAll') {
    result = getAllData(ss);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);
  const action = data.action || 'save';

  let result;
  if (action === 'saveVerification') {
    result = saveVerification(ss, data);
  } else if (action === 'saveDrawnPolygon') {
    result = saveDrawnPolygon(ss, data);
  } else if (action === 'deleteDrawnPolygon') {
    result = deleteDrawnPolygon(ss, data);
  } else if (action === 'saveBatch') {
    result = saveBatch(ss, data);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- GET all data ----
function getAllData(ss) {
  const verifications = {};
  const vSheet = ss.getSheetByName(SHEET_NAME_VERIFICATIONS);
  if (vSheet && vSheet.getLastRow() > 1) {
    const vData = vSheet.getRange(2, 1, vSheet.getLastRow() - 1, 4).getValues();
    vData.forEach(row => {
      if (row[0]) {
        verifications[row[0]] = {
          status: row[1],
          user: row[2],
          timestamp: row[3],
        };
      }
    });
  }

  const drawnPolygons = [];
  const dSheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  if (dSheet && dSheet.getLastRow() > 1) {
    const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 7).getValues();
    dData.forEach(row => {
      if (row[0]) {
        drawnPolygons.push({
          id: row[0],
          district: row[1],
          geometry: JSON.parse(row[2] || '{}'),
          area_ha: row[3],
          user: row[4],
          timestamp: row[5],
          note: row[6],
        });
      }
    });
  }

  return { verifications, drawnPolygons };
}

// ---- Save a single verification ----
function saveVerification(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_VERIFICATIONS);
  const key = data.key; // e.g. "Chennai:1"
  const status = data.status;
  const user = data.user;
  const timestamp = data.timestamp || new Date().toISOString();

  // Check if key already exists → update
  if (sheet.getLastRow() > 1) {
    const keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = keys.indexOf(key);
    if (rowIndex >= 0) {
      const row = rowIndex + 2; // +1 for 0-index, +1 for header
      sheet.getRange(row, 2, 1, 3).setValues([[status, user, timestamp]]);
      return { success: true, action: 'updated' };
    }
  }

  // New key → append
  sheet.appendRow([key, status, user, timestamp]);
  return { success: true, action: 'created' };
}

// ---- Save a drawn polygon ----
function saveDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  const id = data.id;
  const district = data.district;

  // Check if exists → update
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const districts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === id && districts[i] === district) {
        const row = i + 2;
        sheet.getRange(row, 1, 1, 7).setValues([[
          id, district, JSON.stringify(data.geometry), data.area_ha,
          data.user, data.timestamp, data.note
        ]]);
        return { success: true, action: 'updated' };
      }
    }
  }

  sheet.appendRow([
    id, district, JSON.stringify(data.geometry), data.area_ha,
    data.user, data.timestamp || new Date().toISOString(), data.note || ''
  ]);
  return { success: true, action: 'created' };
}

// ---- Delete a drawn polygon ----
function deleteDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  if (sheet.getLastRow() <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const districts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i] === data.id && districts[i] === data.district) {
      sheet.deleteRow(i + 2);
      return { success: true, action: 'deleted' };
    }
  }
  return { success: false };
}

// ---- Batch save (for efficiency) ----
function saveBatch(ss, data) {
  const results = [];
  if (data.verifications) {
    Object.entries(data.verifications).forEach(([key, val]) => {
      results.push(saveVerification(ss, {
        key, status: val.status, user: val.user, timestamp: val.timestamp
      }));
    });
  }
  if (data.drawnPolygons) {
    data.drawnPolygons.forEach(p => {
      results.push(saveDrawnPolygon(ss, p));
    });
  }
  return { success: true, count: results.length };
}
