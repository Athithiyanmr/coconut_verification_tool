/* =============================================================
   Coconut Polygon Verifier — Google Apps Script Backend
   Sheets: "verifications", "drawn_polygons", "workers"
   Manual email functions: sendProgressEmails(), sendAdminSummary()
   ============================================================= */

// ── CONFIG ────────────────────────────────────────────────────
const SPREADSHEET_ID  = SpreadsheetApp.getActiveSpreadsheet().getId();
const ADMIN_EMAIL     = 'athithiyanmr@gmail.com';
const TOOL_URL        = 'https://athithiyanmr.github.io/coconut_verification_tool/';

// ── SHEET HELPERS ─────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── doGet ─────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getAll';
  try {
    if (action === 'getAll')    return respond(getAllData());
    if (action === 'getWorker') return respond(getWorker(e.parameter.name || ''));
    return respond({ error: 'Unknown action' });
  } catch (err) {
    return respond({ error: err.message });
  }
}

// ── doPost ────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'saveVerification')  return respond(saveVerification(body));
    if (action === 'saveDrawnPolygon')  return respond(saveDrawnPolygon(body));
    if (action === 'deleteDrawnPolygon') return respond(deleteDrawnPolygon(body));
    if (action === 'saveBatch')         return respond(saveBatch(body));
    return respond({ error: 'Unknown action' });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── getWorker ─────────────────────────────────────────────────
function getWorker(rawName) {
  const name   = rawName.trim().toLowerCase();
  const sheet  = getSheet('workers');
  const data   = sheet.getDataRange().getValues();
  if (data.length < 2) return { found: false, message: 'Workers sheet is empty.' };

  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const nameIdx  = headers.indexOf('name');
  const distIdx  = headers.indexOf('district');
  const startIdx = headers.indexOf('assigned_start');
  const endIdx   = headers.indexOf('assigned_end');
  const capIdx   = headers.indexOf('capacity');

  if (nameIdx === -1) return { found: false, message: 'Workers sheet missing "name" column.' };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[nameIdx]).trim().toLowerCase() === name) {
      return {
        found:         true,
        name:          String(row[nameIdx]).trim(),
        district:      distIdx  >= 0 ? String(row[distIdx]).trim()  : '',
        assignedStart: startIdx >= 0 ? Number(row[startIdx])        : 1,
        assignedEnd:   endIdx   >= 0 ? Number(row[endIdx])          : 9999,
        capacity:      capIdx   >= 0 ? Number(row[capIdx])          : 0,
        email:         headers.indexOf('email') >= 0 ? String(row[headers.indexOf('email')]).trim() : '',
      };
    }
  }
  return { found: false, message: `"${rawName}" not found in workers sheet.` };
}

// ── getAllData ────────────────────────────────────────────────
function getAllData() {
  // Verifications
  const vSheet = getSheet('verifications');
  const vData  = vSheet.getDataRange().getValues();
  const verifications = {};
  if (vData.length > 1) {
    const h = vData[0].map(x => String(x).trim().toLowerCase());
    const kI = h.indexOf('key'), stI = h.indexOf('status'),
          uI = h.indexOf('user'), tsI = h.indexOf('timestamp');
    for (let i = 1; i < vData.length; i++) {
      const r = vData[i];
      const key = String(r[kI] || '').trim();
      if (!key) continue;
      verifications[key] = {
        status:    String(r[stI]  || '').trim(),
        user:      String(r[uI]   || '').trim(),
        timestamp: String(r[tsI]  || '').trim(),
      };
    }
  }

  // Drawn polygons
  const dSheet = getSheet('drawn_polygons');
  const dData  = dSheet.getDataRange().getValues();
  const drawnPolygons = [];
  if (dData.length > 1) {
    const h = dData[0].map(x => String(x).trim().toLowerCase());
    for (let i = 1; i < dData.length; i++) {
      const r = dData[i];
      const obj = {};
      h.forEach((col, ci) => { obj[col] = r[ci]; });
      try { obj.geometry = JSON.parse(obj.geometry); } catch (e) { /* skip */ }
      try { obj.overlaps_existing = JSON.parse(obj.overlaps_existing || '[]'); } catch (e) { obj.overlaps_existing = []; }
      drawnPolygons.push(obj);
    }
  }

  return { verifications, drawnPolygons };
}

// ── saveVerification ──────────────────────────────────────────
function saveVerification(body) {
  const { key, status, user, timestamp } = body;
  if (!key) return { success: false, error: 'Missing key' };

  const sheet = getSheet('verifications');
  const data  = sheet.getDataRange().getValues();

  // Ensure headers
  if (data.length === 0) {
    sheet.appendRow(['key', 'status', 'user', 'timestamp']);
    data.push(['key', 'status', 'user', 'timestamp']);
  }
  const h   = data[0].map(x => String(x).trim().toLowerCase());
  const kI  = h.indexOf('key');
  const stI = h.indexOf('status');
  const uI  = h.indexOf('user');
  const tsI = h.indexOf('timestamp');

  // Find existing row
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][kI]).trim() === key) {
      sheet.getRange(i + 1, stI + 1).setValue(status);
      sheet.getRange(i + 1, uI  + 1).setValue(user);
      sheet.getRange(i + 1, tsI + 1).setValue(timestamp);
      return { success: true, updated: true };
    }
  }
  sheet.appendRow([key, status, user, timestamp]);
  return { success: true, inserted: true };
}

// ── saveDrawnPolygon ──────────────────────────────────────────
function saveDrawnPolygon(body) {
  const { district, id } = body;
  if (!district || !id) return { success: false, error: 'Missing district or id' };

  const sheet   = getSheet('drawn_polygons');
  const data    = sheet.getDataRange().getValues();
  const COLS    = ['district','id','geometry','area_ha','user','timestamp','note','overlaps_existing'];

  if (data.length === 0) {
    sheet.appendRow(COLS);
    data.push(COLS);
  }
  const h   = data[0].map(x => String(x).trim().toLowerCase());
  const dI  = h.indexOf('district');
  const idI = h.indexOf('id');

  const row = COLS.map(col => {
    const val = body[col];
    if (col === 'geometry' || col === 'overlaps_existing') return JSON.stringify(val ?? []);
    return val !== undefined ? val : '';
  });

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][dI]).trim() === district && String(data[i][idI]).trim() === id) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { success: true, updated: true };
    }
  }
  sheet.appendRow(row);
  return { success: true, inserted: true };
}

// ── deleteDrawnPolygon ────────────────────────────────────────
function deleteDrawnPolygon(body) {
  const { district, id } = body;
  if (!district || !id) return { success: false, error: 'Missing district or id' };

  const sheet = getSheet('drawn_polygons');
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, deleted: false };

  const h  = data[0].map(x => String(x).trim().toLowerCase());
  const dI = h.indexOf('district');
  const iI = h.indexOf('id');

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][dI]).trim() === district && String(data[i][iI]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { success: true, deleted: true };
    }
  }
  return { success: true, deleted: false };
}

// ── saveBatch ─────────────────────────────────────────────────
function saveBatch(body) {
  const results = { verifications: 0, drawnPolygons: 0 };
  if (Array.isArray(body.verifications)) {
    body.verifications.forEach(v => { saveVerification(v); results.verifications++; });
  }
  if (Array.isArray(body.drawnPolygons)) {
    body.drawnPolygons.forEach(p => { saveDrawnPolygon(p); results.drawnPolygons++; });
  }
  return { success: true, ...results };
}

// ── buildWorkerStats ──────────────────────────────────────────
function buildWorkerStats() {
  const wSheet = getSheet('workers');
  const wData  = wSheet.getDataRange().getValues();
  if (wData.length < 2) return [];

  const wh      = wData[0].map(h => String(h).trim().toLowerCase());
  const nameIdx = wh.indexOf('name');
  const distIdx = wh.indexOf('district');
  const stIdx   = wh.indexOf('assigned_start');
  const enIdx   = wh.indexOf('assigned_end');
  const capIdx  = wh.indexOf('capacity');
  const emailIdx= wh.indexOf('email');

  const workers = [];
  for (let i = 1; i < wData.length; i++) {
    const r = wData[i];
    const name  = String(r[nameIdx] || '').trim();
    if (!name) continue;
    workers.push({
      name,
      district:      distIdx  >= 0 ? String(r[distIdx]).trim()  : '',
      assignedStart: stIdx    >= 0 ? Number(r[stIdx])           : 1,
      assignedEnd:   enIdx    >= 0 ? Number(r[enIdx])           : 9999,
      capacity:      capIdx   >= 0 ? Number(r[capIdx])          : 0,
      email:         emailIdx >= 0 ? String(r[emailIdx]).trim() : '',
    });
  }

  // Count completions per worker from verifications sheet
  const vSheet = getSheet('verifications');
  const vData  = vSheet.getDataRange().getValues();
  const vh     = vData.length > 0 ? vData[0].map(h => String(h).trim().toLowerCase()) : [];
  const uIdx   = vh.indexOf('user');
  const stIx   = vh.indexOf('status');

  const countMap = {}; // name -> { yes, no }
  for (let i = 1; i < vData.length; i++) {
    const r      = vData[i];
    const uname  = String(r[uIdx] || '').trim().toLowerCase();
    const status = String(r[stIx] || '').trim();
    if (!uname || status === 'pending') continue;
    if (!countMap[uname]) countMap[uname] = { yes: 0, no: 0 };
    if (status === 'yes') countMap[uname].yes++;
    if (status === 'no')  countMap[uname].no++;
  }

  return workers.map(w => {
    const key   = w.name.toLowerCase();
    const done  = countMap[key] || { yes: 0, no: 0 };
    const total = done.yes + done.no;
    const pct   = w.capacity > 0 ? Math.round(total / w.capacity * 100) : 0;
    return { ...w, completedYes: done.yes, completedNo: done.no, completed: total, pct };
  });
}

// ── sendProgressEmails ────────────────────────────────────────
// Run manually from Apps Script editor: Run → sendProgressEmails
function sendProgressEmails() {
  const stats = buildWorkerStats();
  if (!stats.length) { Logger.log('No workers found.'); return; }

  stats.forEach(w => {
    if (!w.email) { Logger.log('No email for ' + w.name + ', skipping.'); return; }

    const subject = `[Coconut Verifier] Your Progress Update — ${w.name}`;
    const html    = buildWorkerEmailHtml(w);

    GmailApp.sendEmail(w.email, subject, '', {
      htmlBody: html,
      cc:       ADMIN_EMAIL,
      name:     'Coconut Verifier Bot',
    });
    Logger.log('Sent to ' + w.email);
  });
}

// ── sendAdminSummary ──────────────────────────────────────────
// Run manually from Apps Script editor: Run → sendAdminSummary
function sendAdminSummary() {
  const stats   = buildWorkerStats();
  const now     = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const total   = stats.reduce((s, w) => s + w.completed, 0);
  const cap     = stats.reduce((s, w) => s + w.capacity,  0);
  const overall = cap > 0 ? Math.round(total / cap * 100) : 0;

  const rows = stats.map(w => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${w.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${w.district}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${w.capacity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#27ae60"><b>${w.completedYes}</b></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#e74c3c"><b>${w.completedNo}</b></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${w.completed}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${w.pct}%</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:DM Sans,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1a1a2e">Admin Summary — Coconut Verifier</h2>
      <p style="color:#555">Generated: ${now} IST</p>
      <p><b>Overall:</b> ${total} / ${cap} polygons verified (${overall}%)</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
        <thead>
          <tr style="background:#f1f1f1">
            <th style="padding:8px 12px;text-align:left">Worker</th>
            <th style="padding:8px 12px;text-align:left">District</th>
            <th style="padding:8px 12px;text-align:center">Capacity</th>
            <th style="padding:8px 12px;text-align:center">Yes ✓</th>
            <th style="padding:8px 12px;text-align:center">No ✗</th>
            <th style="padding:8px 12px;text-align:center">Done</th>
            <th style="padding:8px 12px;text-align:center">%</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px"><a href="${TOOL_URL}">Open Verification Tool →</a></p>
    </div>`;

  GmailApp.sendEmail(ADMIN_EMAIL, '[Coconut Verifier] Admin Summary', '', {
    htmlBody: html,
    name:     'Coconut Verifier Bot',
  });
  Logger.log('Admin summary sent to ' + ADMIN_EMAIL);
}

// ── buildWorkerEmailHtml ──────────────────────────────────────
function buildWorkerEmailHtml(w) {
  const remaining = w.capacity - w.completed;
  const barWidth  = Math.min(w.pct, 100);
  const barColor  = w.pct >= 80 ? '#27ae60' : w.pct >= 40 ? '#f1c40f' : '#e74c3c';

  return `
    <div style="font-family:DM Sans,sans-serif;max-width:520px;margin:0 auto;background:#f7f6f2;padding:32px 24px;border-radius:12px">
      <h2 style="margin:0 0 4px;color:#1a1a2e">Hi ${w.name} 👋</h2>
      <p style="color:#555;margin:0 0 24px">Here's your verification progress for <b>${w.district}</b>.</p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
        ${buildStatBox('Completed', w.completed, '#27ae60')}
        ${buildStatBox('Remaining', remaining < 0 ? 0 : remaining, '#e67e22')}
        ${buildStatBox('Capacity',  w.capacity,  '#3498db')}
      </div>

      <div style="background:#e0e0e0;border-radius:999px;height:12px;overflow:hidden;margin-bottom:8px">
        <div style="width:${barWidth}%;background:${barColor};height:100%;border-radius:999px"></div>
      </div>
      <p style="text-align:right;margin:0 0 24px;font-size:13px;color:#666">${w.pct}% complete</p>

      <p style="margin:0 0 8px">✅ Coconut (Yes): <b style="color:#27ae60">${w.completedYes}</b></p>
      <p style="margin:0 0 24px">❌ Not Coconut (No): <b style="color:#e74c3c">${w.completedNo}</b></p>

      <a href="${TOOL_URL}" style="display:inline-block;background:#01696f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
        Continue Verifying →
      </a>

      <p style="margin-top:24px;font-size:12px;color:#aaa">
        Polygon range: #${w.assignedStart} – #${w.assignedEnd} · District: ${w.district}
      </p>
    </div>`;
}

function buildStatBox(label, value, color) {
  return `
    <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:14px 16px;border-top:3px solid ${color}">
      <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">${label}</div>
    </div>`;
}
