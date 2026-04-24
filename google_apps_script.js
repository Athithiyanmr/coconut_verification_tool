// ============================================================
// Google Apps Script — Coconut Verifier Backend v2
// Worker Registration + Assignment + Admin Monitor
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://sheets.google.com → Create a new blank spreadsheet
// 2. Name it "Coconut Verifier Data"
// 3. Create these sheets (tabs):
//    Sheet 1: "workers"
//       Headers: timestamp | name | email | district | capacity | assigned_start | assigned_end | role | active
//    Sheet 2: "verifications"
//       Headers: key | status | user | timestamp
//    Sheet 3: "drawn_polygons"
//       Headers: id | district | geometry | area_ha | user | timestamp | note
// 4. In Sheet "workers", add ONE admin row manually:
//       [now] | Athithiyan | your@email.com | ALL | 0 | 0 | 0 | admin | true
// 5. Go to Extensions → Apps Script → Delete all code → Paste this file
// 6. Click Deploy → New Deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 7. Copy the Web App URL and paste in registration.js as APPS_SCRIPT_URL
// ============================================================

const SHEET_WORKERS       = 'workers';
const SHEET_VERIFICATIONS = 'verifications';
const SHEET_DRAWN         = 'drawn_polygons';
const ADMIN_PASSWORD      = 'coconut2024admin'; // Change this!

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e.parameter.action || 'getAssignment';
  let result;

  if (action === 'getAssignment') {
    result = getAssignment(ss, e.parameter.email);
  } else if (action === 'getAdminStats') {
    if (e.parameter.pwd !== ADMIN_PASSWORD) {
      result = { error: 'Unauthorized' };
    } else {
      result = getAdminStats(ss);
    }
  } else if (action === 'getTakenRanges') {
    result = getTakenRanges(ss, e.parameter.district);
  } else if (action === 'getAll') {
    result = getAllVerifications(ss, e.parameter.email);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);
  const action = data.action || '';
  let result;

  if (action === 'register') {
    result = registerWorker(ss, data);
  } else if (action === 'saveVerification') {
    result = saveVerification(ss, data);
  } else if (action === 'saveDrawnPolygon') {
    result = saveDrawnPolygon(ss, data);
  } else if (action === 'deleteDrawnPolygon') {
    result = deleteDrawnPolygon(ss, data);
  } else if (action === 'saveBatch') {
    result = saveBatch(ss, data);
  } else {
    result = { error: 'Unknown action' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// WORKER REGISTRATION
// ============================================================
function registerWorker(ss, data) {
  const sheet = ss.getSheetByName(SHEET_WORKERS);
  const email = (data.email || '').toLowerCase().trim();
  const name  = (data.name  || '').trim();
  const district = (data.district || '').trim();
  const start = parseInt(data.assigned_start) || 1;
  const end   = parseInt(data.assigned_end)   || 1;

  if (!email || !name || !district || start < 1 || end < start) {
    return { success: false, error: 'Invalid registration data' };
  }

  // Check if email already registered
  if (sheet.getLastRow() > 1) {
    const emails = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().flat().map(e => String(e).toLowerCase().trim());
    if (emails.indexOf(email) >= 0) {
      return { success: false, error: 'Email already registered. Use login instead.' };
    }
  }

  // Check for range overlap in same district
  const overlap = checkOverlap(ss, district, start, end, '');
  if (overlap) {
    return { success: false, error: 'Range overlaps with an existing assignment. Please choose a different range.' };
  }

  const capacity = end - start + 1;
  sheet.appendRow([
    new Date().toISOString(),
    name,
    email,
    district,
    capacity,
    start,
    end,
    'worker',
    true
  ]);

  return {
    success: true,
    name: name,
    email: email,
    district: district,
    assigned_start: start,
    assigned_end: end,
    capacity: capacity
  };
}

// ============================================================
// GET ASSIGNMENT FOR A WORKER
// ============================================================
function getAssignment(ss, email) {
  if (!email) return { success: false, error: 'No email provided' };
  email = email.toLowerCase().trim();

  const sheet = ss.getSheetByName(SHEET_WORKERS);
  if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'Not registered' };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  for (const row of rows) {
    const rowEmail = String(row[2]).toLowerCase().trim();
    if (rowEmail === email) {
      return {
        success: true,
        name:           row[1],
        email:          row[2],
        district:       row[3],
        capacity:       row[4],
        assigned_start: row[5],
        assigned_end:   row[6],
        role:           row[7],
        active:         row[8]
      };
    }
  }
  return { success: false, error: 'Not registered. Please register first.' };
}

// ============================================================
// GET TAKEN RANGES FOR A DISTRICT (for slider greyed-out UI)
// ============================================================
function getTakenRanges(ss, district) {
  if (!district) return { ranges: [] };
  const sheet = ss.getSheetByName(SHEET_WORKERS);
  if (!sheet || sheet.getLastRow() < 2) return { ranges: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  const ranges = [];
  for (const row of rows) {
    if (String(row[3]).trim() === district && row[8] !== false) {
      ranges.push({ start: row[5], end: row[6], name: row[1] });
    }
  }
  return { ranges };
}

// ============================================================
// ADMIN STATS
// ============================================================
function getAdminStats(ss) {
  const wSheet = ss.getSheetByName(SHEET_WORKERS);
  const vSheet = ss.getSheetByName(SHEET_VERIFICATIONS);

  const workers = [];
  if (wSheet && wSheet.getLastRow() > 1) {
    const rows = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, 9).getValues();
    for (const row of rows) {
      workers.push({
        timestamp:      row[0],
        name:           row[1],
        email:          row[2],
        district:       row[3],
        capacity:       row[4],
        assigned_start: row[5],
        assigned_end:   row[6],
        role:           row[7],
        active:         row[8]
      });
    }
  }

  // Count verifications per worker email
  const verifiedByEmail = {};
  if (vSheet && vSheet.getLastRow() > 1) {
    const vRows = vSheet.getRange(2, 1, vSheet.getLastRow() - 1, 4).getValues();
    for (const row of vRows) {
      const user = String(row[2]).toLowerCase().trim();
      const status = row[1];
      if (!verifiedByEmail[user]) verifiedByEmail[user] = { yes: 0, no: 0, total: 0 };
      verifiedByEmail[user].total++;
      if (status === 'yes') verifiedByEmail[user].yes++;
      else if (status === 'no') verifiedByEmail[user].no++;
    }
  }

  // Merge
  const result = workers.map(w => {
    const email = String(w.email).toLowerCase().trim();
    const stats = verifiedByEmail[email] || { yes: 0, no: 0, total: 0 };
    const assigned = w.assigned_end - w.assigned_start + 1;
    return {
      ...w,
      verified_total: stats.total,
      verified_yes:   stats.yes,
      verified_no:    stats.no,
      pending:        Math.max(0, assigned - stats.total),
      progress_pct:   assigned > 0 ? Math.round((stats.total / assigned) * 100) : 0
    };
  });

  const totalAssigned = result.filter(w => w.role === 'worker').reduce((s, w) => s + (w.assigned_end - w.assigned_start + 1), 0);
  const totalVerified = result.filter(w => w.role === 'worker').reduce((s, w) => s + w.verified_total, 0);

  return {
    workers: result,
    summary: {
      total_workers: result.filter(w => w.role === 'worker').length,
      total_assigned: totalAssigned,
      total_verified: totalVerified,
      overall_pct: totalAssigned > 0 ? Math.round((totalVerified / totalAssigned) * 100) : 0
    }
  };
}

// ============================================================
// OVERLAP CHECK
// ============================================================
function checkOverlap(ss, district, start, end, excludeEmail) {
  const sheet = ss.getSheetByName(SHEET_WORKERS);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  for (const row of rows) {
    const rowDistrict = String(row[3]).trim();
    const rowEmail    = String(row[2]).toLowerCase().trim();
    if (rowDistrict !== district) continue;
    if (excludeEmail && rowEmail === excludeEmail) continue;
    const rStart = parseInt(row[5]);
    const rEnd   = parseInt(row[6]);
    if (start <= rEnd && end >= rStart) return true;
  }
  return false;
}

// ============================================================
// VERIFICATIONS (unchanged from v1)
// ============================================================
function getAllVerifications(ss, email) {
  const verifications = {};
  const vSheet = ss.getSheetByName(SHEET_VERIFICATIONS);
  if (vSheet && vSheet.getLastRow() > 1) {
    const vData = vSheet.getRange(2, 1, vSheet.getLastRow() - 1, 4).getValues();
    vData.forEach(row => {
      if (row[0]) {
        verifications[row[0]] = { status: row[1], user: row[2], timestamp: row[3] };
      }
    });
  }
  const drawnPolygons = [];
  const dSheet = ss.getSheetByName(SHEET_DRAWN);
  if (dSheet && dSheet.getLastRow() > 1) {
    const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 7).getValues();
    dData.forEach(row => {
      if (row[0]) {
        drawnPolygons.push({
          id: row[0], district: row[1], geometry: JSON.parse(row[2] || '{}'),
          area_ha: row[3], user: row[4], timestamp: row[5], note: row[6]
        });
      }
    });
  }
  return { verifications, drawnPolygons };
}

function saveVerification(ss, data) {
  const sheet = ss.getSheetByName(SHEET_VERIFICATIONS);
  const key = data.key;
  const status = data.status;
  const user = data.user;
  const timestamp = data.timestamp || new Date().toISOString();
  if (sheet.getLastRow() > 1) {
    const keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const rowIndex = keys.indexOf(key);
    if (rowIndex >= 0) {
      sheet.getRange(rowIndex + 2, 2, 1, 3).setValues([[status, user, timestamp]]);
      return { success: true, action: 'updated' };
    }
  }
  sheet.appendRow([key, status, user, timestamp]);
  return { success: true, action: 'created' };
}

function saveDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_DRAWN);
  const id = data.id;
  const district = data.district;
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const districts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === id && districts[i] === district) {
        sheet.getRange(i + 2, 1, 1, 7).setValues([[
          id, district, JSON.stringify(data.geometry), data.area_ha,
          data.user, data.timestamp, data.note
        ]]);
        return { success: true, action: 'updated' };
      }
    }
  }
  sheet.appendRow([id, district, JSON.stringify(data.geometry), data.area_ha,
    data.user, data.timestamp || new Date().toISOString(), data.note || '']);
  return { success: true, action: 'created' };
}

function deleteDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_DRAWN);
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

function saveBatch(ss, data) {
  const results = [];
  if (data.verifications) {
    Object.entries(data.verifications).forEach(([key, val]) => {
      results.push(saveVerification(ss, { key, status: val.status, user: val.user, timestamp: val.timestamp }));
    });
  }
  if (data.drawnPolygons) {
    data.drawnPolygons.forEach(p => results.push(saveDrawnPolygon(ss, p)));
  }
  return { success: true, count: results.length };
}
