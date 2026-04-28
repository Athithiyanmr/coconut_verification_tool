// ============================================================
// Google Apps Script — Coconut Verifier Backend
// ============================================================
// SHEETS NEEDED:
// 1. "verifications"  → key | status | user | timestamp
// 2. "drawn_polygons" → id | district | geometry | area_ha | user | timestamp | note
// 3. "workers"        → (auto from Google Form) + AssignedStart | AssignedEnd | Role | Active
// ============================================================


const SHEET_NAME_VERIFICATIONS = 'verifications';
const SHEET_NAME_DRAWN         = 'drawn_polygons';
const SHEET_NAME_WORKERS       = 'workers';
const ADMIN_EMAIL              = 'athithiyan@aurovilleconsulting.com';


// ============================================================
// doGet — handles all read actions
// ============================================================
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = (e.parameter.action || 'getAll');
  var output;

  if (action === 'getAll') {
    output = getAllData(ss);
  } else if (action === 'getWorker') {
    var name = (e.parameter.name || '').toString().trim();
    output = getWorker(ss, name);
  } else {
    output = { error: 'Unknown action: ' + action };
  }

  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// doPost — handles all write actions
// ============================================================
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
  } else {
    result = { error: 'Unknown action: ' + action };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// getAllData — returns all verifications + drawn polygons
// ============================================================
function getAllData(ss) {
  const verifications = {};
  const vSheet = ss.getSheetByName(SHEET_NAME_VERIFICATIONS);
  if (vSheet && vSheet.getLastRow() > 1) {
    const vData = vSheet.getRange(2, 1, vSheet.getLastRow() - 1, 4).getValues();
    vData.forEach(function(row) {
      if (row[0]) {
        verifications[row[0]] = { status: row[1], user: row[2], timestamp: row[3] };
      }
    });
  }

  const drawnPolygons = [];
  const dSheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  if (dSheet && dSheet.getLastRow() > 1) {
    const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 7).getValues();
    dData.forEach(function(row) {
      if (row[0]) {
        try {
          drawnPolygons.push({
            id: row[0],
            district: row[1],
            geometry: JSON.parse(row[2] || '{}'),
            area_ha: row[3],
            user: row[4],
            timestamp: row[5],
            note: row[6]
          });
        } catch (err) {}
      }
    });
  }

  return { verifications: verifications, drawnPolygons: drawnPolygons };
}


// ============================================================
// saveVerification
// ============================================================
function saveVerification(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_VERIFICATIONS);
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


// ============================================================
// saveDrawnPolygon
// ============================================================
function saveDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  const id = data.id;
  const district = data.district;

  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const districts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === id && districts[i] === district) {
        sheet.getRange(i + 2, 1, 1, 7).setValues([[
          id,
          district,
          JSON.stringify(data.geometry),
          data.area_ha,
          data.user,
          data.timestamp,
          data.note
        ]]);
        return { success: true, action: 'updated' };
      }
    }
  }

  sheet.appendRow([
    id,
    district,
    JSON.stringify(data.geometry),
    data.area_ha,
    data.user,
    data.timestamp || new Date().toISOString(),
    data.note || ''
  ]);
  return { success: true, action: 'created' };
}


// ============================================================
// deleteDrawnPolygon
// ============================================================
function deleteDrawnPolygon(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAME_DRAWN);
  if (sheet.getLastRow() <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const districts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();

  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i] === data.id && districts[i] === data.district) {
      sheet.deleteRow(i + 2);
      return { success: true, action: 'deleted' };
    }
  }

  return { success: false };
}


// ============================================================
// saveBatch
// ============================================================
function saveBatch(ss, data) {
  var count = 0;

  if (data.verifications) {
    Object.entries(data.verifications).forEach(function(entry) {
      saveVerification(ss, {
        key: entry[0],
        status: entry[1].status,
        user: entry[1].user,
        timestamp: entry[1].timestamp
      });
      count++;
    });
  }

  if (data.drawnPolygons) {
    data.drawnPolygons.forEach(function(p) {
      saveDrawnPolygon(ss, p);
      count++;
    });
  }

  return { success: true, count: count };
}


// ============================================================
// buildWorkerStats — supports MULTIPLE rows per worker
// ============================================================
function buildWorkerStats(ss) {
  var wSheet = ss.getSheetByName(SHEET_NAME_WORKERS);
  var vSheet = ss.getSheetByName(SHEET_NAME_VERIFICATIONS);
  if (!wSheet || !vSheet) return [];

  var vData = vSheet.getLastRow() > 1
    ? vSheet.getRange(2, 1, vSheet.getLastRow() - 1, 3).getValues()
    : [];

  var wAll = wSheet.getRange(1, 1, wSheet.getLastRow(), wSheet.getLastColumn()).getValues();
  var headers = wAll[0];

  function col(label) {
    return headers.findIndex(function(h) {
      return h.toString().trim().toLowerCase() === label.toLowerCase();
    });
  }

  var nameCol  = col('Full Name') !== -1 ? col('Full Name') : col('Name');
  var emailCol = col('Email') !== -1 ? col('Email') : col('Email Address');
  var distCol  = col('District') !== -1 ? col('District') : col('district');
  var startCol = col('AssignedStart');
  var endCol   = col('AssignedEnd');
  var roleCol  = col('Role');
  var activeCol= col('Active');

  var workerMap = {};

  for (var i = 1; i < wAll.length; i++) {
    var row = wAll[i];
    var active = activeCol >= 0 ? row[activeCol] : true;
    if (active === false || active === 'FALSE' || String(active).toLowerCase() === 'false') continue;

    var role = roleCol >= 0 ? row[roleCol].toString().trim().toLowerCase() : 'worker';
    if (role === 'admin') continue;

    var name     = nameCol  >= 0 ? row[nameCol].toString().trim()  : '';
    var email    = emailCol >= 0 ? row[emailCol].toString().trim() : '';
    var district = distCol  >= 0 ? row[distCol].toString().trim()  : '';
    var start    = parseInt(row[startCol], 10) || 0;
    var end      = parseInt(row[endCol],   10) || 0;

    if (!name || !start || !end || !district) continue;

    var mapKey = name.toLowerCase() + '||' + district.toLowerCase();
    if (!workerMap[mapKey]) {
      workerMap[mapKey] = { name: name, email: email, district: district, ranges: [] };
    }
    workerMap[mapKey].ranges.push({ start: start, end: end });
  }

  var stats = [];

  Object.values(workerMap).forEach(function(w) {
    var nameLower = w.name.toLowerCase();
    var distLower = w.district.toLowerCase();

    var total = 0;
    w.ranges.forEach(function(r) { total += (r.end - r.start + 1); });

    var completed = 0;
    vData.forEach(function(v) {
      var key    = (v[0] || '').toString();
      var status = (v[1] || '').toString().toLowerCase();
      var user   = (v[2] || '').toString().toLowerCase().trim();
      if (user !== nameLower) return;

      var parts = key.split(':');
      if (parts.length < 2) return;
      if (parts[0].toLowerCase() !== distLower) return;

      var polyId = parseInt(parts[1], 10);
      if (isNaN(polyId)) return;

      var inRange = w.ranges.some(function(r) {
        return polyId >= r.start && polyId <= r.end;
      });
      if (!inRange) return;

      if (['coconut','non-coconut','verified','yes','no'].indexOf(status) >= 0) completed++;
    });

    var rangeStr = w.ranges.map(function(r) { return r.start + '–' + r.end; }).join(', ');

    stats.push({
      name: w.name, email: w.email, district: w.district,
      rangeStr: rangeStr, ranges: w.ranges,
      total: total, completed: completed,
      remaining: total - completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0
    });
  });

  return stats;
}


// ============================================================
// getWorker — groups by district, returns all districts
// ============================================================
function getWorker(ss, name) {
  if (!name) return { found: false, message: 'No name provided.' };

  var sheet = ss.getSheetByName(SHEET_NAME_WORKERS);
  if (!sheet) return { found: false, message: 'Workers sheet not found.' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { found: false, message: 'No workers registered yet.' };

  var data    = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = data[0];

  function colIdx(label) {
    return headers.findIndex(function(h) {
      return h.toString().trim().toLowerCase() === label.toLowerCase();
    });
  }

  var nameCol  = colIdx('Full Name') !== -1 ? colIdx('Full Name') : colIdx('Name');
  var emailCol = colIdx('Email')     !== -1 ? colIdx('Email')     : colIdx('Email Address');
  var distCol  = colIdx('District')  !== -1 ? colIdx('District')  : colIdx('district');
  var capCol   = colIdx('How much time can you dedicate to using this tool each day?');
  var startCol = colIdx('AssignedStart');
  var endCol   = colIdx('AssignedEnd');
  var roleCol  = colIdx('Role');
  var activeCol= colIdx('Active');
  if (capCol === -1) capCol = colIdx('Capacity');

  var matched = {
    found: false, name: '', email: '',
    capacity: '', role: 'worker',
    districts: []
  };

  var districtMap = {};

  for (var i = 1; i < data.length; i++) {
    var rowName = nameCol >= 0 ? data[i][nameCol].toString().trim().toLowerCase() : '';
    if (rowName !== name.toLowerCase()) continue;

    var active = activeCol >= 0 ? data[i][activeCol] : true;
    if (active === false || active === 'FALSE' || String(active).toLowerCase() === 'false') {
      return { found: false, message: 'Your account is inactive. Contact admin.' };
    }

    if (!matched.found) {
      matched.found    = true;
      matched.name     = nameCol  >= 0 ? data[i][nameCol].toString().trim()  : name;
      matched.email    = emailCol >= 0 ? data[i][emailCol].toString().trim() : '';
      matched.capacity = capCol   >= 0 ? data[i][capCol]                     : '';
      matched.role     = roleCol  >= 0 ? data[i][roleCol].toString().trim()  : 'worker';
    }

    var district = distCol  >= 0 ? data[i][distCol].toString().trim()   : '';
    var start    = parseInt(data[i][startCol], 10) || 0;
    var end      = parseInt(data[i][endCol],   10) || 0;

    if (!district || !start || !end) continue;

    var dk = district.toLowerCase();
    if (!districtMap[dk]) {
      districtMap[dk] = { district: district, ranges: [] };
    }
    districtMap[dk].ranges.push({ start: start, end: end });
  }

  if (!matched.found) {
    return { found: false, message: 'Name not found. Check spelling or register via the Google Form.' };
  }

  matched.districts = Object.values(districtMap);

  if (matched.districts.length === 0) {
    return { found: false, message: 'You are registered but polygon range not yet assigned. Please wait for admin.' };
  }

  // Backwards-compatibility for single-district workers
  if (matched.districts.length === 1) {
    var d = matched.districts[0];
    matched.district      = d.district;
    matched.ranges        = d.ranges;
    matched.assignedStart = d.ranges[0].start;
    matched.assignedEnd   = d.ranges[d.ranges.length - 1].end;
  }

  return matched;
}


// ============================================================
// sendProgressEmails — HTML email to each worker
// ============================================================
function sendProgressEmails() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var stats = buildWorkerStats(ss);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy');
  var sent = 0, failed = 0;

  stats.forEach(function(w) {
    if (!w.email) return;

    var statusMsg, statusColor, barColor;

    if (w.remaining === 0) {
      statusMsg   = 'Excellent! You have completed all your assigned polygons. Please contact admin for the next assignment.';
      statusColor = '#16a34a';
      barColor    = 'linear-gradient(90deg,#16a34a,#22c55e)';
    } else if (w.percent >= 75) {
      statusMsg   = 'Great progress! You are almost done. Keep it up.';
      statusColor = '#0891b2';
      barColor    = 'linear-gradient(90deg,#0891b2,#22d3ee)';
    } else if (w.percent >= 25) {
      statusMsg   = 'Good progress! Please continue when you have time.';
      statusColor = '#d97706';
      barColor    = 'linear-gradient(90deg,#d97706,#fbbf24)';
    } else {
      statusMsg   = 'Please remember to continue your assigned polygon verification.';
      statusColor = '#dc2626';
      barColor    = 'linear-gradient(90deg,#dc2626,#f87171)';
    }

    var subject  = 'Coconut Verification Progress - ' + w.district + ' (' + today + ')';
    var htmlBody = buildWorkerEmailHtml(w, today, statusMsg, statusColor, barColor);

    try {
      GmailApp.sendEmail(w.email, subject, 'Your email client does not support HTML.', {
        htmlBody: htmlBody, cc: ADMIN_EMAIL
      });
      Logger.log('Sent → ' + w.name + ' | ' + w.completed + '/' + w.total);
      sent++;
    } catch (err) {
      Logger.log('Failed → ' + w.name + ' | ' + err.message);
      failed++;
    }
  });

  Logger.log('=== Done: ' + sent + ' sent, ' + failed + ' failed ===');
}


// ============================================================
// sendAdminSummary — HTML summary table email to admin
// ============================================================
function sendAdminSummary() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var stats = buildWorkerStats(ss);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy HH:mm');

  var grandTotal = 0, grandDone = 0;
  stats.forEach(function(w) { grandTotal += w.total; grandDone += w.completed; });
  var grandPercent = grandTotal > 0 ? Math.round((grandDone / grandTotal) * 100) : 0;

  var rowsHtml = '';
  stats.forEach(function(w) {
    var rowBg    = w.remaining === 0 ? '#f0fdf4' : '#ffffff';
    var pctColor = w.percent >= 75 ? '#16a34a' : w.percent >= 25 ? '#d97706' : '#dc2626';
    rowsHtml +=
      '<tr style="background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' +
      '<td style="padding:10px 14px;font-size:13px;color:#111827;font-weight:500;">' + w.name + '</td>' +
      '<td style="padding:10px 14px;font-size:13px;color:#374151;">' + w.district + '</td>' +
      '<td style="padding:10px 14px;font-size:13px;color:#374151;">' + w.rangeStr + '</td>' +
      '<td style="padding:10px 14px;font-size:13px;color:#16a34a;font-weight:700;">' + w.completed + '</td>' +
      '<td style="padding:10px 14px;font-size:13px;color:#dc2626;font-weight:700;">' + w.remaining + '</td>' +
      '<td style="padding:10px 14px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div style="flex:1;background:#e5e7eb;border-radius:999px;height:8px;min-width:80px;">' +
            '<div style="background:' + pctColor + ';height:100%;width:' + w.percent + '%;border-radius:999px;"></div>' +
          '</div>' +
          '<span style="font-size:12px;font-weight:700;color:' + pctColor + ';min-width:32px;">' + w.percent + '%</span>' +
        '</div>' +
      '</td></tr>';
  });

  if (!rowsHtml) {
    rowsHtml = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#9ca3af;font-size:13px;">No active workers found.</td></tr>';
  }

  var subject  = 'Admin Summary - Coconut Verification (' + today + ')';
  var htmlBody =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">' +
    '<div style="max-width:760px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">' +
    '<div style="background:#15803d;padding:28px 32px;">' +
    '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Coconut Plantation Verification</h1>' +
    '<p style="margin:4px 0 0;color:#d1fae5;font-size:13px;">Admin Progress Summary • ' + today + '</p>' +
    '</div>' +
    '<div style="display:flex;border-bottom:1px solid #e5e7eb;">' +
    buildStatBox('Total Polygons', String(grandTotal), '#111827') +
    buildStatBox('Completed', String(grandDone), '#16a34a') +
    buildStatBox('Remaining', String(grandTotal - grandDone), '#dc2626') +
    buildStatBox('Overall', grandPercent + '%', grandPercent >= 75 ? '#16a34a' : grandPercent >= 25 ? '#d97706' : '#dc2626') +
    '</div>' +
    '<div style="padding:16px 32px;border-bottom:1px solid #e5e7eb;">' +
    '<div style="background:#e5e7eb;border-radius:999px;height:12px;overflow:hidden;">' +
    '<div style="background:linear-gradient(90deg,#16a34a,#22c55e);height:100%;width:' + grandPercent + '%;border-radius:999px;"></div>' +
    '</div></div>' +
    '<div style="padding:24px 32px;">' +
    '<h2 style="margin:0 0 16px;font-size:15px;color:#111827;font-weight:700;">Worker Breakdown</h2>' +
    '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">' +
    '<thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Worker</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">District</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Range</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Done</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Left</th>' +
    '<th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Progress</th>' +
    '</tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '</table></div></div>' +
    '<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">' +
    '<p style="margin:0;font-size:12px;color:#9ca3af;">Auto-generated • Athithiyan • Coconut Plantation Mapping Project</p>' +
    '</div></div></body></html>';

  GmailApp.sendEmail(ADMIN_EMAIL, subject, 'Your email client does not support HTML.', { htmlBody: htmlBody });
  Logger.log('Admin summary sent to: ' + ADMIN_EMAIL);
}


// ============================================================
// buildWorkerEmailHtml — HTML template for individual worker
// ============================================================
function buildWorkerEmailHtml(w, today, statusMsg, statusColor, barColor) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">' +
    '<div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">' +
    '<div style="background:#15803d;padding:28px 32px;">' +
    '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Coconut Plantation Verification</h1>' +
    '<p style="margin:4px 0 0;color:#d1fae5;font-size:13px;">Progress Update • ' + today + '</p>' +
    '</div>' +
    '<div style="padding:24px 32px 0;">' +
    '<p style="margin:0;font-size:16px;color:#111827;">Hi <strong>' + w.name + '</strong>,</p>' +
    '<p style="margin:8px 0 0;font-size:14px;color:#6b7280;">Here is your latest progress update for the Coconut Plantation Verification project.</p>' +
    '</div>' +
    '<div style="margin:20px 32px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;">' +
    buildRow('District', w.district) +
    buildRow('Assigned Range', 'Polygons ' + w.rangeStr + '&nbsp;&nbsp;(Total: ' + w.total + ')') +
    buildRow('Completed', '<span style="color:#16a34a;font-weight:700;">' + w.completed + '</span>') +
    buildRow('Remaining', '<span style="color:#dc2626;font-weight:700;">' + w.remaining + '</span>') +
    '<div style="margin-top:12px;">' +
    '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">' +
    '<span style="font-size:12px;color:#6b7280;">Overall Progress</span>' +
    '<span style="font-size:12px;font-weight:700;color:#15803d;">' + w.percent + '%</span>' +
    '</div>' +
    '<div style="background:#e5e7eb;border-radius:999px;height:10px;overflow:hidden;">' +
    '<div style="background:' + barColor + ';height:100%;width:' + w.percent + '%;border-radius:999px;"></div>' +
    '</div></div></div>' +
    '<div style="margin:0 32px 20px;padding:14px 16px;background:#f9fafb;border-left:4px solid ' + statusColor + ';border-radius:6px;">' +
    '<p style="margin:0;font-size:13px;color:' + statusColor + ';">' + statusMsg + '</p>' +
    '</div>' +
    (w.remaining > 0
      ? '<div style="text-align:center;margin:0 32px 28px;">' +
        '<a href="https://athithiyanmr.github.io/coconut_verification_tool/" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Continue Verification</a>' +
        '</div>'
      : '') +
    '<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">' +
    '<p style="margin:0;font-size:12px;color:#9ca3af;">Sent by Athithiyan • Coconut Plantation Mapping Project</p>' +
    '</div>' +
    '</div></body></html>';
}


// ============================================================
// buildRow / buildStatBox — reusable HTML snippets
// ============================================================
function buildRow(label, value) {
  return '<div style="display:flex;justify-content:space-between;margin-bottom:12px;">' +
    '<span style="font-size:13px;color:#6b7280;">' + label + '</span>' +
    '<strong style="font-size:13px;color:#111827;">' + value + '</strong>' +
    '</div>';
}

function buildStatBox(label, value, color) {
  return '<div style="flex:1;padding:20px 24px;text-align:center;border-right:1px solid #e5e7eb;">' +
    '<div style="font-size:22px;font-weight:700;color:' + color + ';">' + value + '</div>' +
    '<div style="font-size:11px;color:#9ca3af;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>' +
    '</div>';
}
