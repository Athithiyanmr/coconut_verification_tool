// ============================================================
// registration.js  — Worker Login / Registration / Admin
// ============================================================
// ⚠️  STEP 1: Paste your Apps Script Web App URL below.
//     Go to Extensions → Apps Script → Deploy → New Deployment
//     Execute as: Me   |   Access: Anyone
//     Copy the URL that looks like:
//     https://script.google.com/macros/s/AKfycb.../exec
// ============================================================
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE'; // ← REPLACE THIS

// ---- District polygon counts ----
const DISTRICT_COUNTS = {
  "Ariyalur":35,"Chengalpattu":668,"Chennai":4,"Coimbatore":9235,
  "Cuddalore":444,"Dharmapuri":1982,"Dindigul":6077,"Erode":7364,
  "Kallakurichi":482,"Kancheepuram":287,"Kanniyakumari":3968,
  "Karur":1750,"Krishnagiri":4515,"Madurai":2722,"Mayiladuthurai":321,
  "Nagapattinam":93,"Namakkal":4058,"Perambalur":189,"Pudukkottai":1186,
  "Ramanathapuram":242,"Ranipet":706,"Salem":5335,"Sivagangai":1853,
  "Tenkasi":3245,"Thanjavur":1447,"The Nilgiris":13,"Theni":3803,
  "Thiruvannamalai":1773,"Thoothukudi":1931,"Tiruchirapalli":1767,
  "Tirunelveli":2299,"Tirupathur":2652,"Tiruppur":12091,"Tiruvallur":190,
  "Tiruvarur":311,"Vellore":3155,"Villupuram":733,"Virudhunagar":1512
};

// Current session
window.SESSION = {
  name: '', email: '', district: '', role: 'worker',
  assignedStart: 1, assignedEnd: 100, active: false
};

const ADMIN_PWD_LOCAL = 'coconut2024admin'; // Must match Apps Script ADMIN_PASSWORD

// ============================================================
// INIT
// ============================================================
function initRegistration() {
  // Check if URL is still placeholder — show setup warning
  if (APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    const modal = document.getElementById('userModal');
    if (modal) {
      const warn = document.createElement('div');
      warn.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 14px;font-size:13px;color:#856404;margin-bottom:12px;text-align:left';
      warn.innerHTML = '<b>⚠️ Setup Required</b><br>The Apps Script URL is not set yet. Please follow the <a href="https://github.com/Athithiyanmr/coconut_verification_tool#setup" target="_blank">setup instructions</a> in the README, then paste your URL into <code>registration.js</code>.';
      const card = modal.querySelector('.modal-card');
      if (card) card.insertBefore(warn, card.firstChild);
    }
  }

  const districts = Object.keys(DISTRICT_COUNTS).sort();

  // Register district dropdown
  const regDist = document.getElementById('regDistrict');
  if (regDist) {
    districts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${d} (${DISTRICT_COUNTS[d].toLocaleString()} polygons)`;
      regDist.appendChild(opt);
    });
  }

  // Admin filter dropdown
  const adminFilter = document.getElementById('adminFilterDistrict');
  if (adminFilter) {
    districts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      adminFilter.appendChild(opt);
    });
  }

  setupModalEvents();
  setupAdminPanel();
}

// ============================================================
// TAB SWITCHING
// ============================================================
window.switchTab = function(tab) {
  document.getElementById('tabLogin').classList.toggle('reg-tab-active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('reg-tab-active', tab === 'register');
  document.getElementById('panelLogin').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('panelRegister').style.display = tab === 'register' ? '' : 'none';
};

// ============================================================
// MODAL EVENTS
// ============================================================
function setupModalEvents() {
  const btnSignIn = document.getElementById('btnSignIn');
  if (btnSignIn) {
    btnSignIn.addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value.trim();
      if (!email) { showError('loginError', 'Please enter your email.'); return; }

      if (APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
        showError('loginError', '⚠️ Apps Script URL not configured yet. See setup instructions above.');
        return;
      }

      btnSignIn.textContent = 'Looking up...';
      btnSignIn.disabled = true;
      hideError('loginError');
      try {
        const res = await apiFetch(`${APPS_SCRIPT_URL}?action=getAssignment&email=${encodeURIComponent(email)}`);
        if (res.success) {
          applySession(res);
        } else {
          showError('loginError', res.error || 'Not registered. Please register first.');
          btnSignIn.textContent = 'Sign In →';
          btnSignIn.disabled = false;
        }
      } catch(e) {
        showError('loginError', 'Connection error. Check Apps Script URL and deployment.');
        btnSignIn.textContent = 'Sign In →';
        btnSignIn.disabled = false;
      }
    });
  }

  // Register step 1 validation
  const regName  = document.getElementById('regName');
  const regEmail = document.getElementById('regEmail');
  const regDist  = document.getElementById('regDistrict');
  const btnStep1 = document.getElementById('btnStep1Next');

  function validateStep1() {
    const ok = regName && regName.value.trim().length > 1 &&
               regEmail && regEmail.value.trim().includes('@') &&
               regDist && regDist.value;
    if (btnStep1) btnStep1.disabled = !ok;
  }
  [regName, regEmail, regDist].forEach(el => {
    if (el) {
      el.addEventListener('input', validateStep1);
      el.addEventListener('change', validateStep1);
    }
  });

  btnStep1 && btnStep1.addEventListener('click', goRegStep2);

  const btnReg = document.getElementById('btnRegSubmit');
  btnReg && btnReg.addEventListener('click', submitRegistration);
}

// ============================================================
// STEP 2: Range Picker
// ============================================================
let takenRanges = [];

async function goRegStep2() {
  const district = document.getElementById('regDistrict').value;
  const total = DISTRICT_COUNTS[district] || 100;

  document.getElementById('regStep1').style.display = 'none';
  document.getElementById('regStep2').style.display = '';
  document.getElementById('regStep2District').textContent = district;
  document.getElementById('regTotalLabel').textContent = `(total: ${total.toLocaleString()} polygons)`;

  try {
    if (APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE') {
      const res = await apiFetch(`${APPS_SCRIPT_URL}?action=getTakenRanges&district=${encodeURIComponent(district)}`);
      takenRanges = res.ranges || [];
    } else {
      takenRanges = [];
    }
  } catch(e) { takenRanges = []; }

  setupRangeSlider('reg', total, takenRanges);
  renderTakenOverlay('reg', total, takenRanges);

  const legend = document.getElementById('takenLegend');
  if (legend) legend.classList.toggle('hidden', takenRanges.length === 0);
}

window.goRegStep1 = function() {
  document.getElementById('regStep2').style.display = 'none';
  document.getElementById('regStep1').style.display = '';
};

// ============================================================
// RANGE SLIDER
// ============================================================
function setupRangeSlider(prefix, total, taken) {
  const sliderMin = document.getElementById(`${prefix}SliderMin`);
  const sliderMax = document.getElementById(`${prefix}SliderMax`);
  const fromInput = document.getElementById(`${prefix}RangeFrom`);
  const toInput   = document.getElementById(`${prefix}RangeTo`);
  const track     = document.getElementById(`${prefix}SliderTrack`);
  const info      = document.getElementById(`${prefix}RangeInfo`);

  if (!sliderMin || !sliderMax) return;

  sliderMin.max = total; sliderMax.max = total;
  sliderMin.value = 1;   sliderMax.value = Math.min(total, 500);
  if (fromInput) { fromInput.min = 1; fromInput.max = total; fromInput.value = 1; }
  if (toInput)   { toInput.min   = 1; toInput.max   = total; toInput.value   = Math.min(total, 500); }

  function updateTrack() {
    const minVal = parseInt(sliderMin.value);
    const maxVal = parseInt(sliderMax.value);
    const pctMin = ((minVal - 1) / (total - 1)) * 100;
    const pctMax = ((maxVal - 1) / (total - 1)) * 100;
    if (track) { track.style.left = `${pctMin}%`; track.style.width = `${pctMax - pctMin}%`; }
    if (fromInput) fromInput.value = minVal;
    if (toInput)   toInput.value   = maxVal;
    if (info) info.textContent = `Polygons #${minVal.toLocaleString()} – #${maxVal.toLocaleString()} · ${(maxVal - minVal + 1).toLocaleString()} polygons selected`;
    checkOverlapLocal(minVal, maxVal, taken);
  }

  sliderMin.addEventListener('input', () => {
    if (parseInt(sliderMin.value) >= parseInt(sliderMax.value))
      sliderMin.value = parseInt(sliderMax.value) - 1;
    updateTrack();
  });
  sliderMax.addEventListener('input', () => {
    if (parseInt(sliderMax.value) <= parseInt(sliderMin.value))
      sliderMax.value = parseInt(sliderMin.value) + 1;
    updateTrack();
  });
  fromInput && fromInput.addEventListener('change', () => {
    let v = Math.max(1, Math.min(parseInt(fromInput.value) || 1, parseInt(sliderMax.value) - 1));
    sliderMin.value = v; fromInput.value = v; updateTrack();
  });
  toInput && toInput.addEventListener('change', () => {
    let v = Math.min(total, Math.max(parseInt(toInput.value) || total, parseInt(sliderMin.value) + 1));
    sliderMax.value = v; toInput.value = v; updateTrack();
  });

  updateTrack();
}

function checkOverlapLocal(start, end, taken) {
  const warn = document.getElementById('overlapWarning');
  if (!warn) return;
  const overlaps = taken.some(r => start <= r.end && end >= r.start);
  warn.classList.toggle('hidden', !overlaps);
}

function renderTakenOverlay(prefix, total, taken) {
  const overlay = document.getElementById('takenOverlay');
  if (!overlay || total <= 1) return;
  overlay.innerHTML = '';
  taken.forEach(r => {
    const left  = ((r.start - 1) / (total - 1)) * 100;
    const width = Math.max(1, ((r.end - r.start) / (total - 1)) * 100);
    const seg = document.createElement('div');
    seg.className = 'taken-segment';
    seg.style.left  = `${left}%`;
    seg.style.width = `${width}%`;
    seg.title = `${r.name}: #${r.start}–#${r.end}`;
    overlay.appendChild(seg);
  });
}

// ============================================================
// SUBMIT REGISTRATION
// ============================================================
async function submitRegistration() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const district = document.getElementById('regDistrict').value;
  const start    = parseInt(document.getElementById('regSliderMin').value);
  const end      = parseInt(document.getElementById('regSliderMax').value);

  const warn = document.getElementById('overlapWarning');
  if (warn && !warn.classList.contains('hidden')) {
    showError('regSubmitError', 'Please choose a range that does not overlap.');
    return;
  }

  if (APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    showError('regSubmitError', '⚠️ Apps Script URL not configured. Contact the admin.');
    return;
  }

  const btn = document.getElementById('btnRegSubmit');
  if (btn) { btn.textContent = 'Registering...'; btn.disabled = true; }
  hideError('regSubmitError');

  try {
    const res = await apiPost(APPS_SCRIPT_URL, {
      action: 'register', name, email, district,
      assigned_start: start, assigned_end: end
    });
    if (res.success) {
      applySession(res);
    } else {
      showError('regSubmitError', res.error || 'Registration failed.');
      if (btn) { btn.textContent = 'Register & Start →'; btn.disabled = false; }
    }
  } catch(e) {
    showError('regSubmitError', 'Connection error. Check Apps Script deployment.');
    if (btn) { btn.textContent = 'Register & Start →'; btn.disabled = false; }
  }
}

// ============================================================
// APPLY SESSION
// ============================================================
function applySession(data) {
  window.SESSION.name          = data.name || '';
  window.SESSION.email         = data.email || '';
  window.SESSION.district      = data.district || '';
  window.SESSION.role          = data.role || 'worker';
  window.SESSION.assignedStart = parseInt(data.assigned_start) || 1;
  window.SESSION.assignedEnd   = parseInt(data.assigned_end)   || 9999;
  window.SESSION.active        = true;

  if (typeof currentUser !== 'undefined') currentUser = window.SESSION.name || window.SESSION.email;

  const display = document.getElementById('currentUserDisplay');
  if (display) display.textContent = window.SESSION.name;

  const badge = document.getElementById('assignmentBadge');
  if (badge && window.SESSION.role !== 'admin') {
    badge.textContent = `${window.SESSION.district} · #${window.SESSION.assignedStart.toLocaleString()}–${window.SESSION.assignedEnd.toLocaleString()}`;
    badge.classList.remove('hidden');
  }

  if (window.SESSION.role === 'admin') {
    const adminBtn = document.getElementById('adminOpenBtn');
    if (adminBtn) adminBtn.style.display = '';
    const badge2 = document.getElementById('assignmentBadge');
    if (badge2) { badge2.textContent = '🔒 Admin'; badge2.classList.remove('hidden'); }
  }

  const modal = document.getElementById('userModal');
  if (modal) modal.classList.add('hidden');

  const districtSelect = document.getElementById('districtSelect');
  if (districtSelect && window.SESSION.district && window.SESSION.role !== 'admin') {
    districtSelect.value = window.SESSION.district;
    districtSelect.disabled = true;
    districtSelect.dispatchEvent(new Event('change'));
  }
}

// ============================================================
// POLYGON RANGE FILTER — called from app.js
// ============================================================
window.getAssignedFeatures = function(allFeatures) {
  if (!window.SESSION.active) return allFeatures;
  if (window.SESSION.role === 'admin') return allFeatures;
  const start = window.SESSION.assignedStart;
  const end   = window.SESSION.assignedEnd;
  return allFeatures.filter((_, idx) => {
    const polyNum = idx + 1;
    return polyNum >= start && polyNum <= end;
  });
};

// ============================================================
// ADMIN PANEL
// ============================================================
let adminData = null;

function setupAdminPanel() {
  document.getElementById('closeAdmin')?.addEventListener('click', () => {
    document.getElementById('adminModal').classList.add('hidden');
  });

  document.getElementById('btnAdminAuth')?.addEventListener('click', () => {
    const pwd = document.getElementById('adminPwdInput').value;
    if (pwd === ADMIN_PWD_LOCAL) {
      document.getElementById('adminAuthModal').classList.add('hidden');
      document.getElementById('adminModal').classList.remove('hidden');
      loadAdminStats();
    } else {
      showError('adminAuthError', 'Incorrect password.');
    }
  });

  document.getElementById('adminRefreshBtn')?.addEventListener('click', loadAdminStats);
  document.getElementById('adminSearch')?.addEventListener('input', renderAdminTable);
  document.getElementById('adminFilterDistrict')?.addEventListener('change', renderAdminTable);
}

window.openAdminPanel = function() {
  if (window.SESSION.role === 'admin') {
    document.getElementById('adminModal').classList.remove('hidden');
    loadAdminStats();
  } else {
    document.getElementById('adminAuthModal').classList.remove('hidden');
  }
};

async function loadAdminStats() {
  const tbody = document.getElementById('adminTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Loading...</td></tr>';
  try {
    const res = await apiFetch(`${APPS_SCRIPT_URL}?action=getAdminStats&pwd=${encodeURIComponent(ADMIN_PWD_LOCAL)}`);
    if (res.error) throw new Error(res.error);
    adminData = res;
    const s = res.summary;
    setText('adminTotalWorkers', s.total_workers);
    setText('adminTotalAssigned', s.total_assigned.toLocaleString());
    setText('adminTotalVerified', s.total_verified.toLocaleString());
    setText('adminOverallPct', `${s.overall_pct}%`);
    renderAdminTable();
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--color-error,#a12c7b);padding:24px">Error: ${e.message}</td></tr>`;
  }
}

function renderAdminTable() {
  if (!adminData) return;
  const search = (document.getElementById('adminSearch')?.value || '').toLowerCase();
  const distF  = document.getElementById('adminFilterDistrict')?.value || '';
  const tbody  = document.getElementById('adminTableBody');
  if (!tbody) return;

  let workers = adminData.workers.filter(w => w.role === 'worker');
  if (search) workers = workers.filter(w =>
    w.name.toLowerCase().includes(search) ||
    w.email.toLowerCase().includes(search) ||
    w.district.toLowerCase().includes(search)
  );
  if (distF) workers = workers.filter(w => w.district === distF);

  if (workers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No workers found.</td></tr>';
    return;
  }

  tbody.innerHTML = workers.map(w => {
    const assigned = (parseInt(w.assigned_end) - parseInt(w.assigned_start) + 1);
    const pct = w.progress_pct || 0;
    const barColor = pct >= 80 ? '#437a22' : pct >= 40 ? '#d19900' : '#01696f';
    return `<tr>
      <td><b>${esc(w.name)}</b></td>
      <td style="font-size:12px;color:var(--text-muted)">${esc(w.email)}</td>
      <td>${esc(w.district)}</td>
      <td style="font-variant-numeric:tabular-nums">#${parseInt(w.assigned_start).toLocaleString()}–${parseInt(w.assigned_end).toLocaleString()}</td>
      <td style="font-variant-numeric:tabular-nums">${assigned.toLocaleString()}</td>
      <td style="font-variant-numeric:tabular-nums;color:#437a22">${(w.verified_total||0).toLocaleString()}</td>
      <td style="font-variant-numeric:tabular-nums;color:var(--text-muted)">${(w.pending||0).toLocaleString()}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;background:#d4d1ca;border-radius:4px;height:6px;overflow:hidden">
            <div style="width:${pct}%;background:${barColor};height:100%;border-radius:4px"></div>
          </div>
          <span style="font-size:12px;width:34px;text-align:right;font-variant-numeric:tabular-nums">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
// HELPERS
// ============================================================
async function apiFetch(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }, redirect: 'follow'
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}
function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', initRegistration);
