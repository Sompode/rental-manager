// ============================================================================
// RentalPro Desktop - Frontend Application
// รองรับทั้ง บ้านเช่าเป็นหลัง และ ห้องเช่า/อพาร์ตเมนต์ + ใบแจ้งหนี้/ใบเสร็จ ขนาด A5
// ============================================================================

let appState = {
  settings: {},
  units: [],
  tenants: [],
  invoices: [],
  maintenances: [],
  transactions: []
};

let currentTab = 'dashboard';
let categoryFilter = 'all'; // 'all' | 'house' | 'room'
let selectedZoneFilter = 'all'; // 'all' | zoneName
let selectedBillingMonth = new Date().toISOString().slice(0, 7);
let invoiceStatusFilter = 'all';
let meterProgressFilter = 'all'; // 'all' | 'pending' | 'done'
let hasUnsavedMeterChanges = false;
let searchQuery = '';
let desktopInfo = { isElectron: false, dataDir: '' };
let pendingUpdateState = null;

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedMeterChanges) {
    e.preventDefault();
    e.returnValue = 'คุณมีข้อมูลมิเตอร์ที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?';
  }
});

// ----------------------------------------------------------------------------
// Initialization & API Helpers
// ----------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.isElectron) {
    try {
      desktopInfo = await window.electronAPI.getAppInfo();
      const statusEl = document.getElementById('storage-status-text');
      if (statusEl) {
        statusEl.textContent = 'โหมดโปรแกรมติดตั้งลงเครื่อง (SQLite/JSON)';
      }
      if (window.electronAPI.onUpdaterEvent) {
        window.electronAPI.onUpdaterEvent(handleNativeUpdaterEvent);
      }
    } catch (e) {
      console.warn(e);
    }
  }
  applySavedUiPrefs();
  await fetchState();
  // Auto-check OTA update on startup if updateUrl is configured
  setTimeout(() => {
    checkOtaUpdateSilent();
  }, 2000);
});

function applySavedUiPrefs() {
  try {
    const collapsed = localStorage.getItem('rentalpro_sidebar_collapsed') === '1';
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
    }
    const savedZoom = localStorage.getItem('rentalpro_ui_zoom');
    if (savedZoom) {
      setUiZoom(savedZoom, true);
    }
  } catch (e) {}
}

function toggleSidebarCollapsed() {
  if (window.innerWidth <= 1240) {
    document.body.classList.toggle('sidebar-expanded-mobile');
  } else {
    const isNowCollapsed = document.body.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('rentalpro_sidebar_collapsed', isNowCollapsed ? '1' : '0');
    } catch (e) {}
  }
}

function setUiZoom(val, silent = false) {
  const num = Number(val) || 1;
  document.documentElement.style.zoom = String(num);
  const sel = document.getElementById('ui-zoom-select');
  if (sel) sel.value = String(num);
  try {
    localStorage.setItem('rentalpro_ui_zoom', String(num));
  } catch (e) {}
  if (!silent) {
    showToast(`🔍 ปรับขนาดการแสดงผลเป็น ${Math.round(num * 100)}% เรียบร้อยแล้ว`);
  }
}

async function fetchState() {
  const res = await fetch('/api/state');
  appState = await res.json();
  if (Array.isArray(appState.invoices) && appState.invoices.length > 0) {
    const hasCurrentMonth = appState.invoices.some(i => i.billingMonth === selectedBillingMonth);
    if (!hasCurrentMonth) {
      const months = appState.invoices.map(i => i.billingMonth).filter(Boolean).sort();
      if (months.length > 0) {
        selectedBillingMonth = months[months.length - 1];
      }
    }
  }
  updateGlobalUI();
  renderCurrentTab();
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
  }
  if (data.state) {
    appState = data.state;
    updateGlobalUI();
  }
  return data;
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  const icon = type === 'error' ? '⚠️' : '✅';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3200);
}

function updateGlobalUI() {
  const s = appState.settings || {};
  document.getElementById('sidebar-biz-name').textContent = s.businessName || 'RentalPro Desktop';
  const logoEl = document.getElementById('sidebar-brand-logo');
  if (logoEl) {
    if (s.logoDataUrl) {
      logoEl.innerHTML = `<img src="${s.logoDataUrl}" alt="Logo" style="width:100%; height:100%; object-fit:contain; border-radius:8px; background:#fff; padding:2px;" />`;
      logoEl.style.background = 'transparent';
    } else {
      logoEl.textContent = 'H';
      logoEl.style.background = '';
    }
  }
  const verEl = document.getElementById('app-version-label');
  if (verEl && appState.appVersion) {
    verEl.textContent = `เวอร์ชัน v${appState.appVersion.version || '1.0.0'}`;
  }

  const units = appState.units || [];
  const houses = units.filter(u => u.category === 'house');
  const rooms = units.filter(u => u.category === 'room');
  const activeTenants = (appState.tenants || []).filter(t => t.status === 'active');
  const unpaidInvoices = (appState.invoices || []).filter(i => i.status !== 'paid' && i.status !== 'draft');

  document.getElementById('count-all').textContent = units.length;
  document.getElementById('count-house').textContent = houses.length;
  document.getElementById('count-room').textContent = rooms.length;
  document.getElementById('badge-units-count').textContent = units.length;
  document.getElementById('badge-tenants-count').textContent = activeTenants.length;
  document.getElementById('badge-unpaid-count').textContent = unpaidInvoices.length;

  document.querySelectorAll('#global-category-filter .cat-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === categoryFilter);
  });
}

function setCategoryFilter(cat) {
  categoryFilter = cat;
  updateGlobalUI();
  renderCurrentTab();
}

function switchTab(tab) {
  if (currentTab === 'meter' && tab !== 'meter' && hasUnsavedMeterChanges) {
    const leave = confirm('คุณมีการกรอกเลขมิเตอร์ค้างไว้ที่ยังไม่ได้กดบันทึก\n\nหากเปลี่ยนหน้าตอนนี้ ข้อมูลที่พิมพ์ไว้จะหายไป!\nต้องการเปลี่ยนหน้าโดยไม่บันทึกใช่หรือไม่? (กด Cancel เพื่ออยู่ต่อแล้วกดปุ่มบันทึกความคืบหน้า)');
    if (!leave) return;
    hasUnsavedMeterChanges = false;
  }
  currentTab = tab;
  document.body.classList.remove('sidebar-expanded-mobile');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const titles = {
    dashboard: [
      'ภาพรวมกิจการ & ผังบ้านเช่า / ห้องเช่า',
      'ดูสถานะบ้านเช่าเป็นหลัง และห้องเช่า/อพาร์ตเมนต์แบบเรียลไทม์'
    ],
    units: [
      'จัดการข้อมูลบ้านเช่าเป็นหลัง & ห้องเช่า/อพาร์ตเมนต์',
      'เพิ่ม/แก้ไขรายละเอียดบ้านเช่า ห้องพัก อัตราค่าเช่า และรูปแบบการคิดค่าน้ำ-ค่าไฟ'
    ],
    tenants: [
      'ทะเบียนผู้เช่า & สัญญาเช่า',
      'จัดการผู้เช่าเข้าอยู่ (Check-in) พิมพ์สัญญาเช่า และคำนวณคืนเงินประกันวันย้ายออก'
    ],
    meter: [
      'จดมิเตอร์ค่าน้ำ-ค่าไฟ & คำนวณบิลรายเดือน',
      'กรอกเลขมิเตอร์น้ำ-ไฟ หรือยอดบิลจริง เพื่อสร้างใบแจ้งหนี้ขนาด A5 อัตโนมัติ'
    ],
    invoices: [
      'ใบแจ้งหนี้ / ใบเสร็จรับเงิน (มาตรฐานขนาด A5)',
      'ดูตัวอย่าง พิมพ์ออกเครื่องปริ้นท์ หรือบันทึกเป็น PDF ขนาด A5 (แนวตั้ง / แนวนอน / 2 ใบใน A4)'
    ],
    accounting: [
      'รายงานสรุปประจำเดือน & บัญชีรายรับ-รายจ่าย',
      'สรุปยอดค่าเช่า ค่าน้ำ ค่าไฟ แยกตามอาคาร/โซน พร้อมส่งออกเป็นไฟล์ Excel (.xls / .csv)'
    ],
    settings: [
      'ตั้งค่ากิจการ & สำรองฐานข้อมูลในเครื่อง',
      'กำหนดข้อมูลหัวบิล A5 เรทค่าน้ำ-ค่าไฟ บัญชีธนาคาร และสำรอง/กู้คืนข้อมูลแบบ Offline'
    ]
  };

  const [title, sub] = titles[tab] || titles.dashboard;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = sub;

  renderCurrentTab();
}

function renderCurrentTab() {
  const container = document.getElementById('main-view');
  if (currentTab === 'dashboard') renderDashboard(container);
  else if (currentTab === 'units') renderUnitsTab(container);
  else if (currentTab === 'tenants') renderTenantsTab(container);
  else if (currentTab === 'meter') renderMeterTab(container);
  else if (currentTab === 'invoices') renderInvoicesTab(container);
  else if (currentTab === 'accounting') renderAccountingTab(container);
  else if (currentTab === 'settings') renderSettingsTab(container);
}

// ----------------------------------------------------------------------------
// Formatting & Thai Baht Text Helpers
// ----------------------------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(num) {
  const val = Number(num || 0);
  return val.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDateThai(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  const y = parseInt(parts[0], 10) + 543;
  const m = months[parseInt(parts[1], 10) - 1] || parts[1];
  const d = parseInt(parts[2], 10);
  return `${d} ${m} ${y}`;
}

function formatMonthThai(ym) {
  if (!ym) return '-';
  const [yStr, mStr] = ym.split('-');
  const monthsFull = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const y = parseInt(yStr, 10) + 543;
  const m = monthsFull[parseInt(mStr, 10) - 1] || mStr;
  return `${m} ${y}`;
}

function thaiBahtText(amount) {
  const num = Number(amount || 0).toFixed(2);
  const [intPart, decPart] = num.split('.');
  if (Number(intPart) === 0 && Number(decPart) === 0) return 'ศูนย์บาทถ้วน';

  const txtNum = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const txtDigit = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertInteger(str) {
    let result = '';
    const len = str.length;
    for (let i = 0; i < len; i++) {
      const n = parseInt(str.charAt(i), 10);
      const pos = (len - i - 1) % 6;
      if (n !== 0) {
        if (pos === 1 && n === 1) {
          result += '';
        } else if (pos === 1 && n === 2) {
          result += 'ยี่';
        } else if (pos === 0 && n === 1 && len > 1 && str.charAt(i - 1) !== '0') {
          result += 'เอ็ด';
        } else {
          result += txtNum[n];
        }
        result += txtDigit[pos];
      }
      if ((len - i - 1) > 0 && pos === 0) {
        result += 'ล้าน';
      }
    }
    return result;
  }

  let bahtStr = '';
  if (Number(intPart) > 0) {
    bahtStr += convertInteger(String(Number(intPart))) + 'บาท';
  }
  if (Number(decPart) === 0) {
    bahtStr += 'ถ้วน';
  } else {
    bahtStr += convertInteger(String(Number(decPart))) + 'สตางค์';
  }
  return bahtStr;
}

function filterByCategory(items, getCatFn) {
  if (categoryFilter === 'all') return items;
  return items.filter(item => getCatFn(item) === categoryFilter);
}

const ZONE_PALETTES = [
  { border: '#2563eb', bg: '#eff6ff', text: '#1e40af', badgeBg: '#dbeafe' },
  { border: '#059669', bg: '#ecfdf5', text: '#065f46', badgeBg: '#d1fae5' },
  { border: '#7c3aed', bg: '#f5f3ff', text: '#5b21b6', badgeBg: '#ede9fe' },
  { border: '#d97706', bg: '#fffbeb', text: '#92400e', badgeBg: '#fef3c7' },
  { border: '#0891b2', bg: '#ecfeff', text: '#155e75', badgeBg: '#cffafe' },
  { border: '#e11d48', bg: '#fff1f2', text: '#9f1239', badgeBg: '#ffe4e6' },
  { border: '#4f46e5', bg: '#eef2ff', text: '#3730a3', badgeBg: '#e0e7ff' },
  { border: '#0d9488', bg: '#f0fdfa', text: '#115e59', badgeBg: '#ccfbf1' }
];

function getCustomBuildingsList() {
  const fromSettings = appState.settings?.customBuildings;
  if (Array.isArray(fromSettings)) return fromSettings;
  if (Array.isArray(appState.buildings)) return appState.buildings;
  return [];
}

function getAllZonesList() {
  const zones = [];
  for (const b of getCustomBuildingsList()) {
    if (b.name && !zones.includes(b.name)) zones.push(b.name);
  }
  for (const u of appState.units || []) {
    const z = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    if (!zones.includes(z)) zones.push(z);
  }
  return zones;
}

function getBuildingConfig(zoneName) {
  const s = appState.settings || {};
  const saved = getCustomBuildingsList().find(b => b.name === zoneName);
  const zUnits = (appState.units || []).filter(
    u => (u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === zoneName
  );
  const firstUnit = zUnits[0] || {};

  // Auto-detect prefix from existing rooms (e.g. "H1-01" -> "H1-")
  let detectedPrefix = '';
  if (firstUnit.code) {
    const m = String(firstUnit.code).match(/^([A-Za-zก-๙0-9]+[-/])\d+$/);
    if (m) detectedPrefix = m[1];
  }

  const category = saved?.category || firstUnit.category || (String(zoneName || '').includes('บ้าน') ? 'house' : 'room');
  const defWMin = Number(s.waterMinCharge ?? 100);
  const defEMin = Number(s.electricMinCharge !== undefined && s.electricMinCharge !== 0 ? s.electricMinCharge : (s.waterMinCharge ?? 100));
  return {
    id: saved?.id || '',
    name: zoneName || '',
    category,
    codePrefix: saved?.codePrefix !== undefined ? saved.codePrefix : detectedPrefix,
    defaultRent: saved?.defaultRent ?? firstUnit.baseRent ?? (category === 'house' ? 6000 : 2000),
    defaultDeposit: saved?.defaultDeposit ?? firstUnit.defaultDeposit ?? (category === 'house' ? 8000 : 3000),
    commonFee: saved?.commonFee ?? firstUnit.commonFee ?? (category === 'house' ? (s.commonFeeHouse ?? 0) : (s.commonFeeRoom ?? 20)),
    defaultRoomType: saved?.defaultRoomType || firstUnit.bedrooms || (category === 'house' ? 'บ้านเดี่ยว' : 'ห้องพัดลม'),
    waterBillingType: saved?.waterBillingType || firstUnit.waterBillingType || (category === 'house' ? 'direct' : 'meter'),
    waterRate: saved?.waterRate ?? firstUnit.customWaterRate ?? (category === 'house' ? 0 : (s.waterRate ?? 50)),
    waterMinCharge: saved?.waterMinCharge ?? firstUnit.waterMinCharge ?? (category === 'house' ? 0 : defWMin),
    electricBillingType: saved?.electricBillingType || firstUnit.electricBillingType || (category === 'house' ? 'direct' : 'meter'),
    electricRate: saved?.electricRate ?? firstUnit.customElectricRate ?? (category === 'house' ? 0 : (s.electricRate ?? 7)),
    electricMinCharge: saved?.electricMinCharge ?? firstUnit.electricMinCharge ?? (category === 'house' ? 0 : defEMin)
  };
}

function suggestNextRoomCode(zoneName) {
  const cfg = getBuildingConfig(zoneName);
  const zUnits = (appState.units || []).filter(
    u => (u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === zoneName
  );
  let maxNum = 0;
  let padLen = 2;
  let prefix = cfg.codePrefix || '';

  for (const u of zUnits) {
    const m = String(u.code || '').match(/^(.*?)(\d+)$/);
    if (m) {
      if (!prefix && m[1]) prefix = m[1];
      const n = parseInt(m[2], 10);
      if (n > maxNum) {
        maxNum = n;
        padLen = m[2].length;
      }
    }
  }
  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(padLen, '0')}`;
}

function getZoneTheme(zoneName) {
  const zones = getAllZonesList();
  const idx = Math.max(0, zones.indexOf(zoneName));
  return ZONE_PALETTES[idx % ZONE_PALETTES.length];
}

function setZoneFilter(zone) {
  selectedZoneFilter = zone;
  renderCurrentTab();
}

function renderZoneSelectorBar() {
  const catUnits = filterByCategory(appState.units || [], u => u.category);
  const zoneCounts = new Map();
  for (const b of getCustomBuildingsList()) {
    if (b.name && (categoryFilter === 'all' || b.category === categoryFilter)) {
      zoneCounts.set(b.name, 0);
    }
  }
  for (const u of catUnits) {
    const z = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    zoneCounts.set(z, (zoneCounts.get(z) || 0) + 1);
  }
  const zones = Array.from(zoneCounts.keys());

  if (selectedZoneFilter !== 'all' && !zoneCounts.has(selectedZoneFilter)) {
    selectedZoneFilter = 'all';
  }

  const allActive = selectedZoneFilter === 'all';
  let buttonsHtml = `
    <button type="button" onclick="setZoneFilter('all')" style="
      padding: 7px 14px;
      border-radius: 999px;
      border: 1.5px solid ${allActive ? '#0f172a' : '#cbd5e1'};
      background: ${allActive ? '#0f172a' : '#ffffff'};
      color: ${allActive ? '#ffffff' : '#334155'};
      font-weight: ${allActive ? '800' : '600'};
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: ${allActive ? '0 2px 6px rgba(15,23,42,0.18)' : 'none'};
    ">
      <span>🏢 ทุกตึก / ทุกโซน</span>
      <span style="background:${allActive ? 'rgba(255,255,255,0.22)' : '#f1f5f9'}; color:${allActive ? '#fff' : '#475569'}; padding:1px 8px; border-radius:99px; font-size:11.5px;">${catUnits.length}</span>
    </button>
  `;

  for (const z of zones) {
    const count = zoneCounts.get(z);
    const theme = getZoneTheme(z);
    const isActive = selectedZoneFilter === z;
    buttonsHtml += `
      <button type="button" onclick="setZoneFilter('${escapeHtml(z.replace(/'/g, "\\'"))}')" style="
        padding: 7px 14px;
        border-radius: 999px;
        border: 1.5px solid ${isActive ? theme.border : '#cbd5e1'};
        background: ${isActive ? theme.border : '#ffffff'};
        color: ${isActive ? '#ffffff' : '#1e293b'};
        font-weight: ${isActive ? '800' : '600'};
        font-size: 13px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: ${isActive ? '0 2px 6px rgba(37,99,235,0.22)' : 'none'};
      ">
        <span style="width:8px; height:8px; border-radius:50%; background:${isActive ? '#ffffff' : theme.border}; display:inline-block;"></span>
        <span>${escapeHtml(z)}</span>
        <span style="background:${isActive ? 'rgba(255,255,255,0.24)' : theme.badgeBg}; color:${isActive ? '#ffffff' : theme.text}; padding:1px 8px; border-radius:99px; font-size:11.5px; font-weight:700;">${count}</span>
      </button>
    `;
  }

  return `
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:11px 16px; margin-bottom:16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; box-shadow:0 1px 2px rgba(15,23,42,0.04);">
      <span style="font-size:12.5px; font-weight:800; color:#475569; margin-right:4px;">เลือกตึก/อาคาร:</span>
      ${buttonsHtml}
      <div style="margin-left:auto; display:flex; gap:6px;">
        ${selectedZoneFilter !== 'all' ? `
          <button type="button" class="btn btn-sm btn-outline" onclick="openBuildingModal('${escapeHtml(selectedZoneFilter.replace(/'/g, "\\'"))}')">⚙️ ตั้งค่าตึก ${escapeHtml(selectedZoneFilter)}</button>
          <button type="button" class="btn btn-sm btn-outline" style="color:#dc2626; border-color:#fecaca;" onclick="confirmDeleteBuilding('${escapeHtml(selectedZoneFilter.replace(/'/g, "\\'"))}')">🗑️ ลบตึกนี้</button>
        ` : ''}
        <button type="button" class="btn btn-sm btn-primary" onclick="openBuildingModal()">🏢 + เพิ่มตึกใหม่ / สร้างห้องทั้งตึก</button>
      </div>
    </div>
  `;
}

function getCategoryBadge(category) {
  if (category === 'house') {
    return `<span class="badge badge-house">🏠 บ้านเช่าเป็นหลัง</span>`;
  }
  return `<span class="badge badge-room">🏢 ห้องเช่า/อพาร์ตเมนต์</span>`;
}

function getUnitStatusBadge(status) {
  const map = {
    available: ['badge-available', '● ว่างพร้อมเช่า'],
    occupied: ['badge-occupied', '● มีผู้เช่า'],
    reserved: ['badge-occupied', '● จองแล้ว'],
    maintenance: ['badge-maintenance', '🔧 ซ่อมบำรุง']
  };
  const [cls, label] = map[status] || ['badge-available', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getInvoiceStatusBadge(status) {
  const map = {
    paid: ['badge-paid', '✓ ชำระแล้ว'],
    partial: ['badge-maintenance', '🌓 ชำระบางส่วน'],
    unpaid: ['badge-unpaid', '⏳ รอชำระ'],
    overdue: ['badge-overdue', '⚠️ เกินกำหนด'],
    draft: ['badge-room', '📝 บันทึกร่าง']
  };
  const [cls, label] = map[status] || ['badge-unpaid', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getUnitSubtitle(u, zName = '') {
  const bed = (u.bedrooms || 'ห้องพัก').trim();
  const fl = (u.floor || 'ชั้น 1').trim();
  let name = (u.name || '').trim();

  // Strip duplicate building/zone references e.g. "ห้องแอร์ (หอพัก "หาญยิ่ง 1")"
  if (name) {
    if (zName && name.includes(zName)) {
      name = name.split(zName).join('').replace(/[()"']/g, '').trim();
    }
    name = name.replace(/\s*\([^)]*(ตึก|อาคาร|หอพัก|Harnying|Zone)[^)]*\)/gi, '').trim();
  }

  if (name && name !== bed) {
    return `${bed} (${name}) • ${fl}`;
  }
  return `${bed} • ${fl}`;
}

// ----------------------------------------------------------------------------
// TAB 1: DASHBOARD & UNIT MAP
// ----------------------------------------------------------------------------
function renderDashboard(container) {
  const units = filterByCategory(appState.units || [], u => u.category);
  const allUnits = appState.units || [];
  const houses = allUnits.filter(u => u.category === 'house');
  const rooms = allUnits.filter(u => u.category === 'room');

  const getEffUnitStatus = (u) => {
    const hasActiveTenant = (appState.tenants || []).some(t => t.unitId === u.id && t.status === 'active');
    if (hasActiveTenant && u.status !== 'maintenance') return 'occupied';
    return u.status || 'available';
  };

  const occupiedCount = units.filter(u => getEffUnitStatus(u) === 'occupied').length;
  const availableCount = units.filter(u => getEffUnitStatus(u) === 'available').length;
  const maintCount = units.filter(u => getEffUnitStatus(u) === 'maintenance').length;

  const monthInvoices = filterByCategory(
    (appState.invoices || []).filter(i => i.billingMonth === selectedBillingMonth && i.status !== 'draft'),
    i => i.unitCategory
  );
  const totalBilled = monthInvoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
  const totalCollected = monthInvoices
    .filter(i => i.status === 'paid' || i.status === 'partial')
    .reduce((s, i) => s + Number(i.paidAmount ?? (i.status === 'paid' ? i.totalAmount : 0)), 0);
  const unpaidBills = filterByCategory(
    (appState.invoices || []).filter(i => i.status !== 'paid' && i.status !== 'draft'),
    i => i.unitCategory
  );
  const totalUnpaidAmount = unpaidBills.reduce((s, i) => {
    const paid = i.status === 'partial' ? Number(i.paidAmount || 0) : 0;
    return s + Math.max(0, Number(i.totalAmount || 0) - paid);
  }, 0);

  // Expiring lease alert (within 30 days or already expired)
  const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const expiringLeases = (appState.tenants || [])
    .filter(t => t.status === 'active' && t.contractEndDate)
    .map(t => {
      const endMs = new Date(t.contractEndDate).getTime();
      const daysLeft = Math.ceil((endMs - todayMs) / (1000 * 60 * 60 * 24));
      const u = (appState.units || []).find(x => x.id === t.unitId);
      return { tenant: t, unit: u, daysLeft };
    })
    .filter(x => !isNaN(x.daysLeft) && x.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Group units by zone (and filter by selectedZoneFilter if selected)
  const filteredUnits = units.filter(u => {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    return selectedZoneFilter === 'all' || zName === selectedZoneFilter;
  });

  const zonesMap = {};
  for (const u of filteredUnits) {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    if (!zonesMap[zName]) zonesMap[zName] = [];
    zonesMap[zName].push(u);
  }

  let zonesHtml = '';
  const zoneKeys = Object.keys(zonesMap);
  if (zoneKeys.length === 0) {
    zonesHtml = `
      <div class="card">
        <div class="card-body text-center" style="padding: 48px;">
          <p style="font-size: 16px; color: var(--text-muted); margin-bottom: 14px;">ยังไม่มีข้อมูลบ้านเช่าหรือห้องเช่าในหมวดนี้</p>
          <button class="btn btn-primary" onclick="openUnitModal()">+ เพิ่มบ้านเช่า / ห้องเช่าแรกของคุณ</button>
        </div>
      </div>
    `;
  } else {
    for (const zName of zoneKeys) {
      const zUnits = zonesMap[zName];
      const theme = getZoneTheme(zName);
      const zOcc = zUnits.filter(u => getEffUnitStatus(u) === 'occupied').length;
      const zAvail = zUnits.filter(u => getEffUnitStatus(u) === 'available').length;
      const zMaint = zUnits.filter(u => getEffUnitStatus(u) === 'maintenance').length;

      // Group by floor inside each building if there are multiple floors
      const floorGroups = {};
      for (const u of zUnits) {
        const fl = (u.floor || 'ชั้น 1').trim();
        if (!floorGroups[fl]) floorGroups[fl] = [];
        floorGroups[fl].push(u);
      }
      const floorKeys = Object.keys(floorGroups);

      const renderUnitCard = (u) => {
        const tenant = (appState.tenants || []).find(t => t.unitId === u.id && t.status === 'active');
        const latestInv = (appState.invoices || []).find(i => i.unitId === u.id);
        const effectiveStatus = getEffUnitStatus(u);

        const isWaterDirect = u.waterBillingType === 'direct';
        const isElecDirect = u.electricBillingType === 'direct';

        const waterModeShort = isWaterDirect
          ? 'จ่ายตรงประปา'
          : u.waterBillingType === 'actual_bill'
          ? 'ตามบิลประปา'
          : u.waterBillingType === 'flat'
          ? 'เหมาจ่าย'
          : `${u.customWaterRate ?? appState.settings?.waterRate ?? 50} บ./หน่วย`;

        const elecModeShort = isElecDirect
          ? 'จ่ายตรงการไฟฟ้า'
          : u.electricBillingType === 'actual_bill'
          ? 'ตามบิลไฟฟ้า'
          : u.electricBillingType === 'flat'
          ? 'เหมาจ่าย'
          : `${u.customElectricRate ?? appState.settings?.electricRate ?? 7} บ./หน่วย`;

        const subtitle = getUnitSubtitle(u, zName);

        return `
          <div class="unit-card status-${effectiveStatus}">
            <div class="unit-top">
              <div>
                <div class="unit-code">
                  <span>${u.category === 'house' ? '🏠' : '🏢'}</span>
                  <span>${escapeHtml(u.code)}</span>
                </div>
                <div class="unit-name">${escapeHtml(subtitle)}</div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                ${getUnitStatusBadge(effectiveStatus)}
              </div>
            </div>

            <div class="unit-meta-list" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:7px;">
              <!-- ค่าเช่า & สถานะผู้เช่า -->
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:12px; color:var(--text-muted); font-weight:600;">ค่าเช่า/เดือน:</span>
                <strong style="font-size:16px; color:#1d4ed8;">฿${formatMoney(u.baseRent)}</strong>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; border-top:1px solid #edf2f7; padding-top:6px;">
                <span style="color:var(--text-muted); font-weight:600;">ผู้เช่าปัจจุบัน:</span>
                ${tenant ? `
                  <strong style="color:#0f172a; display:flex; align-items:center; gap:5px;">
                    👤 ${escapeHtml(tenant.fullName)}
                    <button type="button" class="btn btn-sm btn-outline" style="padding:1px 6px; font-size:10px; line-height:1.3;" onclick="openTenantModal('${tenant.id}')" title="แก้ไขข้อมูลผู้เช่าและสัญญาเช่า">✏️</button>
                  </strong>
                ` : effectiveStatus === 'occupied' ? `
                  <span style="font-weight:700; color:#1d4ed8; background:#eff6ff; padding:2px 8px; border-radius:6px; font-size:11px; border:1px solid #bfdbfe; cursor:pointer;" onclick="openTenantModal(null, '${u.id}')" title="คลิกเพื่อระบุชื่อผู้เช่าและทำสัญญา">
                    ● มีผู้เช่า (คลิกระบุชื่อ)
                  </span>
                ` : effectiveStatus === 'maintenance' ? `
                  <span style="font-weight:700; color:#b45309; background:#fef3c7; padding:2px 8px; border-radius:6px; font-size:11px; border:1px solid #fde68a;">
                    🔧 ปิดซ่อมบำรุง
                  </span>
                ` : `
                  <span style="font-weight:700; color:#059669; background:#dcfce7; padding:2px 8px; border-radius:6px; font-size:11px; border:1px solid #a7f3d0;">
                    🟢 ว่างพร้อมเช่า
                  </span>
                `}
              </div>

              ${tenant && tenant.phone ? `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-muted);">
                <span>เบอร์โทร:</span>
                <span style="font-weight:600; color:#475569;">📞 ${escapeHtml(tenant.phone)}</span>
              </div>` : ''}

              <!-- กล่องมิเตอร์น้ำ และ มิเตอร์ไฟ (แยกคนละช่อง สวยงาม ไม่ซ้อนทับ ไม่ตัดบรรทัด) -->
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:2px;">
                <!-- น้ำ -->
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:6px 8px;">
                  <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#0369a1; font-weight:700;">
                    <span>💧 น้ำ</span>
                    <span style="font-size:10px; color:#0284c7; background:#e0f2fe; padding:1px 5px; border-radius:4px; font-weight:600;">${waterModeShort}</span>
                  </div>
                  <div style="font-size:${isWaterDirect ? '12px' : '14px'}; font-weight:800; color:#0c4a6e; margin-top:3px; display:flex; align-items:baseline; justify-content:space-between;">
                    ${isWaterDirect
                      ? `<span style="color:#0284c7;">ไม่คิดเพิ่ม</span><span style="font-size:10px; font-weight:500; color:#0369a1;">จ่ายเอง</span>`
                      : `<span>${u.lastWaterMeter || 0}</span><span style="font-size:10.5px; font-weight:500; color:#0369a1;">หน่วย</span>`}
                  </div>
                </div>

                <!-- ไฟ -->
                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 8px;">
                  <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#b45309; font-weight:700;">
                    <span>⚡ ไฟ</span>
                    <span style="font-size:10px; color:#d97706; background:#fef3c7; padding:1px 5px; border-radius:4px; font-weight:600;">${elecModeShort}</span>
                  </div>
                  <div style="font-size:${isElecDirect ? '12px' : '14px'}; font-weight:800; color:#78350f; margin-top:3px; display:flex; align-items:baseline; justify-content:space-between;">
                    ${isElecDirect
                      ? `<span style="color:#d97706;">ไม่คิดเพิ่ม</span><span style="font-size:10px; font-weight:500; color:#b45309;">จ่ายเอง</span>`
                      : `<span>${u.lastElectricMeter || 0}</span><span style="font-size:10.5px; font-weight:500; color:#b45309;">หน่วย</span>`}
                  </div>
                </div>
              </div>

              ${latestInv ? `
              <div style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px dashed #cbd5e1; border-radius:6px; padding:5px 8px; font-size:11.5px; margin-top:2px;">
                <span style="color:var(--text-muted); font-size:11px;">บิลล่าสุด (${escapeHtml(latestInv.billingMonth)})</span>
                <span style="display:flex; align-items:center; gap:6px;">
                  <strong style="color:#0f172a; font-size:12.5px;">฿${formatMoney(latestInv.totalAmount)}</strong>
                  ${getInvoiceStatusBadge(latestInv.status)}
                </span>
              </div>` : ''}
            </div>

            <div class="unit-actions" style="display:flex; align-items:center; gap:5px; margin-top:auto; padding-top:8px; border-top:1px solid #f1f5f9; flex-wrap:wrap;">
              ${effectiveStatus === 'available' ? `
                <button class="btn btn-sm btn-success" style="flex:1; justify-content:center; font-weight:700; font-size:12px; padding:5px 8px;" onclick="openTenantModal(null, '${u.id}')">+ ทำสัญญาเข้าอยู่</button>
              ` : ''}
              ${effectiveStatus === 'occupied' ? `
                <button class="btn btn-sm btn-primary" style="flex:1; justify-content:center; font-weight:700; font-size:12px; padding:5px 8px;" onclick="openQuickBillModal('${u.id}')">🧾 ออกบิล A5</button>
                ${!tenant ? `
                  <button class="btn btn-sm btn-outline" style="padding:4px 7px; font-size:11.5px; color:#2563eb; border-color:#93c5fd; background:#eff6ff;" onclick="openTenantModal(null, '${u.id}')" title="ลงชื่อ/ทำสัญญาผู้เช่าห้องนี้">+ ผู้เช่า</button>
                ` : ''}
              ` : ''}
              <button class="btn btn-sm btn-outline" style="padding:4px 8px; font-size:11.5px;" onclick="openContractPreviewModal('${tenant ? tenant.id : ''}', '${u.id}')" title="ดู/แก้ไขและพิมพ์หนังสือสัญญาเช่า">📄 สัญญา</button>
              ${latestInv ? `
                <button class="btn btn-sm btn-outline" style="padding:4px 7px; font-size:11.5px;" onclick="openA5PreviewModal('${latestInv.id}')" title="พิมพ์ใบแจ้งหนี้ขนาด A5">🖨️ A5</button>
              ` : ''}
              <button class="btn btn-sm btn-outline" style="padding:4px 8px; font-size:11.5px;" onclick="openUnitModal('${u.id}')">แก้ไข</button>
              <button class="btn btn-sm btn-outline" style="padding:4px 7px; font-size:11.5px; color:#dc2626; border-color:#fecaca;" onclick="confirmDeleteUnit('${u.id}')" title="ลบห้องนี้">🗑️</button>
            </div>
          </div>
        `;
      };

      let innerFloorHtml = '';
      if (floorKeys.length > 1) {
        innerFloorHtml = floorKeys.map(fl => `
          <div style="margin-bottom:14px;">
            <div style="font-size:12.5px; font-weight:800; color:${theme.text}; background:${theme.bg}; display:inline-block; padding:3px 12px; border-radius:6px; margin-bottom:8px; border:1px solid ${theme.badgeBg};">
              🪜 ${escapeHtml(fl)} (${floorGroups[fl].length} ห้อง)
            </div>
            <div class="units-grid">${floorGroups[fl].map(renderUnitCard).join('')}</div>
          </div>
        `).join('');
      } else {
        innerFloorHtml = `<div class="units-grid">${zUnits.map(renderUnitCard).join('')}</div>`;
      }

      const zEsc = escapeHtml(zName.replace(/'/g, "\\'"));
      zonesHtml += `
        <div class="zone-group" style="background:#ffffff; border:1px solid #e2e8f0; border-left:5px solid ${theme.border}; border-radius:14px; padding:16px 18px; margin-bottom:20px; box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <div class="zone-header" style="background:${theme.bg}; padding:10px 14px; border-radius:10px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <div class="zone-title" style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:16px; font-weight:800; color:${theme.text};">🏢 ${escapeHtml(zName)}</span>
              <span class="badge" style="background:${theme.border}; color:#ffffff; font-weight:700;">รวม ${zUnits.length} ยูนิต</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <div style="display:flex; gap:10px; font-size:12.5px; font-weight:700; margin-right:6px;">
                <span style="color:#2563eb;">● มีผู้เช่า ${zOcc}</span>
                <span style="color:#16a34a;">● ว่าง ${zAvail}</span>
                ${zMaint > 0 ? `<span style="color:#d97706;">● ซ่อมบำรุง ${zMaint}</span>` : ''}
              </div>
              <button class="btn btn-sm btn-outline" style="background:#fff;" onclick="openBuildingModal('${zEsc}')">⚙️ ตั้งค่าตึก</button>
              <button class="btn btn-sm btn-outline" style="background:#fff; color:#dc2626; border-color:#fecaca;" onclick="confirmDeleteBuilding('${zEsc}')">🗑️ ลบตึก</button>
              <button class="btn btn-sm btn-primary" onclick="openUnitModal(null, null, '${zEsc}')">+ เพิ่มห้องในตึกนี้</button>
            </div>
          </div>
          ${innerFloorHtml}
        </div>
      `;
    }
  }

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-header">
          <span>จำนวนยูนิตทั้งหมด</span>
          <div class="stat-icon" style="background:#eff6ff; color:#2563eb;">🏘️</div>
        </div>
        <div class="stat-value">${units.length} <span style="font-size:14px; font-weight:600; color:var(--text-muted)">ยูนิต</span></div>
        <div class="stat-sub">
          <span class="badge badge-house">🏠 บ้านเช่า ${houses.length} หลัง</span>
          <span class="badge badge-room">🏢 ห้องเช่า ${rooms.length} ห้อง</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span>สถานะการเข้าพัก</span>
          <div class="stat-icon" style="background:#dcfce7; color:#16a34a;">🔑</div>
        </div>
        <div class="stat-value">${occupiedCount} / ${units.length}</div>
        <div class="stat-sub">
          <span style="color:#16a34a; font-weight:700;">ว่าง ${availableCount}</span> •
          <span style="color:#2563eb; font-weight:700;">มีผู้เช่า ${occupiedCount}</span> •
          <span style="color:#d97706; font-weight:700;">ซ่อม ${maintCount}</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span>ยอดบิลประจำเดือน (${formatMonthThai(selectedBillingMonth)})</span>
          <div class="stat-icon" style="background:#f5f3ff; color:#7c3aed;">🧾</div>
        </div>
        <div class="stat-value">฿${formatMoney(totalBilled)}</div>
        <div class="stat-sub">
          <span>รับชำระแล้ว <strong style="color:#16a34a">฿${formatMoney(totalCollected)}</strong> (${monthInvoices.length} บิล)</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span>ยอดรอชำระ / ค้างชำระ</span>
          <div class="stat-icon" style="background:#fee2e2; color:#dc2626;">⏰</div>
        </div>
        <div class="stat-value" style="color:${unpaidBills.length > 0 ? '#dc2626' : '#16a34a'}">฿${formatMoney(totalUnpaidAmount)}</div>
        <div class="stat-sub">
          <span>จำนวน <strong>${unpaidBills.length}</strong> บิลที่ยังไม่ได้ชำระ</span>
          ${unpaidBills.length > 0 ? `<button class="btn btn-sm btn-outline" onclick="switchTab('invoices')">ดูรายการ</button>` : ''}
        </div>
      </div>
    </div>

    ${expiringLeases.length > 0 ? `
      <div class="card" style="border-left:4px solid #f59e0b; background:#fffbeb; margin-bottom:16px;">
        <div class="card-body" style="padding:12px 16px;">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <div style="font-weight:800; color:#92400e; font-size:14px;">
              📋 แจ้งเตือนสัญญาเช่าใกล้หมดอายุ / ครบกำหนด (${expiringLeases.length} ห้อง)
            </div>
            <button class="btn btn-sm btn-outline" style="background:#fff;" onclick="switchTab('tenants')">ดูทะเบียนผู้เช่าทั้งหมด</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${expiringLeases.slice(0, 8).map(item => `
              <div style="background:#fff; border:1px solid ${item.daysLeft < 0 ? '#fca5a5' : '#fde68a'}; border-radius:8px; padding:6px 10px; font-size:12px; display:flex; align-items:center; gap:8px;">
                <strong>${escapeHtml(item.unit?.code || '-')}</strong>
                <span style="color:#475569;">${escapeHtml(item.tenant.fullName)}</span>
                <span class="badge" style="background:${item.daysLeft < 0 ? '#fee2e2' : '#fef3c7'}; color:${item.daysLeft < 0 ? '#dc2626' : '#b45309'};">
                  ${item.daysLeft < 0 ? `เลยกำหนด ${Math.abs(item.daysLeft)} วัน` : item.daysLeft === 0 ? 'ครบกำหนดวันนี้' : `เหลือ ${item.daysLeft} วัน`}
                </span>
                <button class="btn btn-sm btn-outline" style="padding:2px 6px; font-size:11px;" onclick="openTenantModal('${item.tenant.id}')">ต่อสัญญา</button>
              </div>
            `).join('')}
            ${expiringLeases.length > 8 ? `<span style="font-size:12px; color:#92400e; align-self:center;">และอีก ${expiringLeases.length - 8} ห้อง...</span>` : ''}
          </div>
        </div>
      </div>
    ` : ''}

    ${renderZoneSelectorBar()}
    ${zonesHtml}
  `;
}

// ----------------------------------------------------------------------------
// TAB 2: UNITS MANAGEMENT (Houses & Rooms)
// ----------------------------------------------------------------------------
function renderUnitsTab(container) {
  const units = filterByCategory(appState.units || [], u => u.category).filter(u => {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    if (selectedZoneFilter !== 'all' && zName !== selectedZoneFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.code || '').toLowerCase().includes(q) ||
      (u.name || '').toLowerCase().includes(q) ||
      (u.zone || '').toLowerCase().includes(q)
    );
  });

  // Group rows by building/zone so buildings never blend together
  let rowsHtml = '';
  let lastZone = null;
  for (const u of units) {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    if (zName !== lastZone) {
      lastZone = zName;
      const theme = getZoneTheme(zName);
      const zCount = units.filter(x => (x.zone || (x.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === zName).length;
      const zEsc = escapeHtml(zName.replace(/'/g, "\\'"));
      rowsHtml += `
        <tr style="background:${theme.bg}; border-top:2px solid ${theme.border};">
          <td colspan="8" style="padding:9px 14px; font-weight:800; color:${theme.text}; font-size:13.5px;">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
              <div>
                🏢 อาคาร / โซน: ${escapeHtml(zName)} <span class="badge" style="background:${theme.border}; color:#fff; margin-left:6px;">${zCount} ยูนิต</span>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn btn-sm btn-outline" style="background:#fff;" onclick="openBuildingModal('${zEsc}')">⚙️ ตั้งค่าตึก</button>
                <button class="btn btn-sm btn-outline" style="background:#fff; color:#dc2626; border-color:#fecaca;" onclick="confirmDeleteBuilding('${zEsc}')">🗑️ ลบตึก</button>
                <button class="btn btn-sm btn-primary" onclick="openUnitModal(null, null, '${zEsc}')">+ เพิ่มห้องในตึก ${escapeHtml(zName)}</button>
              </div>
            </div>
          </td>
        </tr>
      `;
    }

    const tenant = (appState.tenants || []).find(t => t.unitId === u.id && t.status === 'active');
    const waterDesc = u.waterBillingType === 'direct'
      ? '<span style="color:#0284c7; font-weight:700;">จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</span>'
      : u.waterBillingType === 'actual_bill'
      ? 'ตามบิลการประปาจริง'
      : u.waterBillingType === 'flat'
      ? `เหมาจ่าย ฿${u.customWaterRate || 0}`
      : `มิเตอร์ (${u.customWaterRate ?? appState.settings.waterRate} บ./หน่วย) (ล่าสุด: ${u.lastWaterMeter || 0})`;
    const elecDesc = u.electricBillingType === 'direct'
      ? '<span style="color:#d97706; font-weight:700;">จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</span>'
      : u.electricBillingType === 'actual_bill'
      ? 'ตามบิลการไฟฟ้าจริง'
      : u.electricBillingType === 'flat'
      ? `เหมาจ่าย ฿${u.customElectricRate || 0}`
      : `มิเตอร์ (${u.customElectricRate ?? appState.settings.electricRate} บ./หน่วย) (ล่าสุด: ${u.lastElectricMeter || 0})`;

    rowsHtml += `
      <tr>
        <td><strong>${escapeHtml(u.code)}</strong></td>
        <td>${getCategoryBadge(u.category)}</td>
        <td>
          <div><strong>${escapeHtml(u.name || '-')}</strong></div>
          <div style="font-size:12px; color:var(--text-muted)">${escapeHtml(u.zone || '')} • ${escapeHtml(u.floor || '')} • ${escapeHtml(u.bedrooms || '')}</div>
        </td>
        <td class="text-right"><strong>฿${formatMoney(u.baseRent)}</strong></td>
        <td>
          <div style="font-size:12px;">💧 น้ำ: ${waterDesc}</div>
          <div style="font-size:12px;">⚡ ไฟ: ${elecDesc}</div>
        </td>
        <td>${tenant ? `<strong>👤 ${escapeHtml(tenant.fullName)}</strong>` : (u.status === 'occupied' ? `<a href="javascript:void(0)" onclick="openTenantModal(null, '${u.id}')" style="color:#2563eb; font-weight:700;">● มีผู้เช่า (คลิกระบุชื่อ)</a>` : '<span style="color:#94a3b8">- ไม่มีผู้เช่า -</span>')}</td>
        <td>${getUnitStatusBadge(u.status)}</td>
        <td class="text-right" style="white-space:nowrap;">
          <button class="btn btn-sm btn-outline" onclick="openContractPreviewModal('${tenant ? tenant.id : ''}', '${u.id}')">📄 สัญญา</button>
          <button class="btn btn-sm btn-outline" onclick="openUnitModal('${u.id}')">แก้ไข</button>
          <button class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="confirmDeleteUnit('${u.id}')">ลบ</button>
        </td>
      </tr>
    `;
  }

  container.innerHTML = `
    ${renderZoneSelectorBar()}
    <div class="card">
      <div class="card-header">
        <div class="card-title">🏘️ ทะเบียนบ้านเช่าเป็นหลัง & ห้องเช่า/อพาร์ตเมนต์ (${units.length} รายการ)</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="text" class="form-control" placeholder="ค้นหาเลขบ้าน/เลขห้อง/โซน..." value="${escapeHtml(searchQuery)}" oninput="searchQuery=this.value; renderCurrentTab();" style="width:220px;" />
          <button class="btn btn-outline" onclick="openBuildingModal()">🏢 + เพิ่มตึกใหม่ / สร้างหลายห้องรวดเดียว</button>
          <button class="btn btn-primary" onclick="openUnitModal()">+ เพิ่มห้อง / บ้านเช่า</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>บ้านเลขที่ / เลขห้อง</th>
              <th>ประเภท</th>
              <th>รายละเอียด / โซน / อาคาร</th>
              <th class="text-right">ค่าเช่า/เดือน</th>
              <th>รูปแบบค่าน้ำ / ค่าไฟ</th>
              <th>ผู้เช่าปัจจุบัน</th>
              <th>สถานะ</th>
              <th class="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="8" class="text-center" style="padding:32px; color:var(--text-muted)">ไม่พบข้อมูล</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// BUILDING SETUP & BATCH ROOM GENERATOR MODAL (ตั้งค่าตึกก่อน แล้วสร้างห้องอัตโนมัติ)
// ----------------------------------------------------------------------------
function openBuildingModal(existingZoneName = null) {
  const isEdit = Boolean(existingZoneName);
  const s = appState.settings || {};
  const cfg = isEdit
    ? getBuildingConfig(existingZoneName)
    : {
        name: '',
        category: 'room',
        codePrefix: '',
        defaultRent: 2000,
        defaultDeposit: 3000,
        commonFee: Number(s.commonFeeRoom ?? 20),
        defaultRoomType: 'ห้องพัดลม',
        waterBillingType: 'meter',
        waterRate: Number(s.waterRate ?? 50),
        electricBillingType: 'meter',
        electricRate: Number(s.electricRate ?? 7)
      };

  const existingRoomsCount = isEdit
    ? (appState.units || []).filter(u => (u.zone || '') === existingZoneName).length
    : 0;

  showModal({
    title: isEdit ? `🏢 ตั้งค่าตึก / อาคาร / โครงการ: ${existingZoneName}` : '🏢 เพิ่มตึก/อาคาร/โครงการใหม่ (พร้อมสร้างห้องอัตโนมัติ)',
    bodyHtml: `
      <form id="building-form" class="form-grid">
        <div class="form-group" style="grid-column: span 2;">
          <label>ชื่อตึก / อาคาร / โครงการ *</label>
          <input type="text" class="form-control" id="bld-name" value="${escapeHtml(cfg.name)}" placeholder="เช่น บ้านมาบโป่ง หรือ หอพัก หาญยิ่ง 1" oninput="onBldNameInput(this.value)" required />
        </div>
        <div class="form-group">
          <label>ประเภทหลักของตึก/โครงการ</label>
          <select class="form-control" id="bld-category" onchange="onBldCategoryChange(this.value)">
            <option value="room" ${cfg.category === 'room' ? 'selected' : ''}>🏢 ห้องเช่า / อพาร์ตเมนต์</option>
            <option value="house" ${cfg.category === 'house' ? 'selected' : ''}>🏠 บ้านเช่าเป็นหลัง</option>
          </select>
        </div>

        <div class="form-group">
          <label>อักษรนำหน้าเลขห้อง/บ้าน (Prefix)</label>
          <input type="text" class="form-control" id="bld-prefix" value="${escapeHtml(cfg.codePrefix)}" placeholder="เช่น H1- หรือ MP-" oninput="updateBatchRoomPreview()" />
        </div>
        <div class="form-group">
          <label>รูปแบบห้อง/บ้านมาตรฐาน</label>
          <select class="form-control" id="bld-roomType">
            <option value="ห้องพัดลม" ${cfg.defaultRoomType === 'ห้องพัดลม' ? 'selected' : ''}>🌀 ห้องพัดลม</option>
            <option value="ห้องแอร์" ${cfg.defaultRoomType === 'ห้องแอร์' ? 'selected' : ''}>❄️ ห้องแอร์</option>
            <option value="บ้านเดี่ยว" ${cfg.defaultRoomType === 'บ้านเดี่ยว' ? 'selected' : ''}>🏠 บ้านเดี่ยว / บ้านเช่า</option>
            <option value="ร้านค้า" ${cfg.defaultRoomType === 'ร้านค้า' ? 'selected' : ''}>🏪 ร้านค้า/พาณิชย์</option>
          </select>
        </div>
        <div class="form-group">
          <label>ค่าเช่ามาตรฐาน (บาท/เดือน)</label>
          <input type="number" class="form-control" id="bld-rent" value="${cfg.defaultRent}" style="font-weight:700; color:#1d4ed8;" />
        </div>

        <div class="form-group">
          <label>เงินประกันมาตรฐาน (บาท)</label>
          <input type="number" class="form-control" id="bld-deposit" value="${cfg.defaultDeposit}" />
        </div>
        <div class="form-group">
          <label>ค่าขยะ / ส่วนกลาง (บาท/เดือน)</label>
          <input type="number" class="form-control" id="bld-common" value="${cfg.commonFee}" />
        </div>

        <!-- ตั้งค่ารายละเอียด น้ำ / ไฟ ของตึกหรือบ้านเช่า (แก้ไขได้อิสระ) -->
        <div class="form-group full-width" style="background:#f0f9ff; border:1.5px solid #bae6fd; border-radius:12px; padding:12px 16px; margin-top:2px;">
          <div style="font-weight:800; color:#0369a1; font-size:13.5px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
            <span>💧 การคิดค่าน้ำประปา (สำหรับตึก/บ้านเช่านี้)</span>
            <span style="font-size:11.5px; color:#0284c7; background:#e0f2fe; padding:2px 8px; border-radius:10px;">แก้ไขได้</span>
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap:12px;">
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">วิธีคิดค่าน้ำ</label>
              <select class="form-control" id="bld-water-type" onchange="onBldUtilityModeChange()" style="background:#fff; border-color:#93c5fd; font-weight:600;">
                <option value="meter" ${cfg.waterBillingType === 'meter' ? 'selected' : ''}>คิดตามมิเตอร์ (บาท/หน่วย)</option>
                <option value="direct" ${cfg.waterBillingType === 'direct' ? 'selected' : ''}>จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</option>
                <option value="actual_bill" ${cfg.waterBillingType === 'actual_bill' ? 'selected' : ''}>เรียกเก็บตามบิลการประปาจริง</option>
                <option value="flat" ${cfg.waterBillingType === 'flat' ? 'selected' : ''}>เหมาจ่ายรายเดือน (บาท/เดือน)</option>
              </select>
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;" id="bld-water-rate-label">${cfg.waterBillingType === 'direct' ? 'เรทค่าน้ำ (ไม่คิดเพิ่ม)' : 'เรทค่าน้ำ (บาท/หน่วย หรือเหมา)'}</label>
              <input type="number" step="0.01" class="form-control" id="bld-water-rate" value="${cfg.waterBillingType === 'direct' ? 0 : cfg.waterRate}" ${cfg.waterBillingType === 'direct' ? 'readonly' : ''} style="background:${cfg.waterBillingType === 'direct' ? '#e2e8f0' : '#fff'}; border-color:#93c5fd; font-weight:800; color:#0369a1;" />
            </div>
          </div>
        </div>

        <div class="form-group full-width" style="background:#fffbeb; border:1.5px solid #fde68a; border-radius:12px; padding:12px 16px;">
          <div style="font-weight:800; color:#b45309; font-size:13.5px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
            <span>⚡ การคิดค่าไฟฟ้า (สำหรับตึก/บ้านเช่านี้)</span>
            <span style="font-size:11.5px; color:#d97706; background:#fef3c7; padding:2px 8px; border-radius:10px;">แก้ไขได้</span>
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap:12px;">
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;">วิธีคิดค่าไฟ</label>
              <select class="form-control" id="bld-elec-type" onchange="onBldUtilityModeChange()" style="background:#fff; border-color:#fcd34d; font-weight:600;">
                <option value="meter" ${cfg.electricBillingType === 'meter' ? 'selected' : ''}>คิดตามมิเตอร์ (บาท/หน่วย)</option>
                <option value="direct" ${cfg.electricBillingType === 'direct' ? 'selected' : ''}>จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</option>
                <option value="actual_bill" ${cfg.electricBillingType === 'actual_bill' ? 'selected' : ''}>เรียกเก็บตามบิลการไฟฟ้าจริง</option>
                <option value="flat" ${cfg.electricBillingType === 'flat' ? 'selected' : ''}>เหมาจ่ายรายเดือน (บาท/เดือน)</option>
              </select>
            </div>
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;" id="bld-elec-rate-label">${cfg.electricBillingType === 'direct' ? 'เรทค่าไฟ (ไม่คิดเพิ่ม)' : 'เรทค่าไฟ (บาท/หน่วย หรือเหมา)'}</label>
              <input type="number" step="0.01" class="form-control" id="bld-elec-rate" value="${cfg.electricBillingType === 'direct' ? 0 : cfg.electricRate}" ${cfg.electricBillingType === 'direct' ? 'readonly' : ''} style="background:${cfg.electricBillingType === 'direct' ? '#e2e8f0' : '#fff'}; border-color:#fcd34d; font-weight:800; color:#b45309;" />
            </div>
          </div>
        </div>

        ${isEdit && existingRoomsCount > 0 ? `
        <div class="form-group full-width" style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:10px 14px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color:#047857; font-size:13px; margin:0;">
            <input type="checkbox" id="bld-apply-to-units" checked style="width:16px; height:16px;" />
            <span>อัปเดตวิธีคิดค่าน้ำ/ค่าไฟ และประเภทหลักนี้ ไปยังทุกห้อง/บ้านใน "${escapeHtml(existingZoneName)}" (${existingRoomsCount} ยูนิต) ทันที</span>
          </label>
        </div>
        ` : ''}

        <div class="form-group full-width" style="background:#eff6ff; border:1.5px solid #bfdbfe; border-radius:12px; padding:14px; margin-top:2px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:800; color:#1e40af; font-size:14px; margin-bottom:8px;">
            <input type="checkbox" id="bld-auto-gen" ${!isEdit ? 'checked' : ''} onchange="document.getElementById('bld-auto-gen-box').style.display = this.checked ? 'grid' : 'none'; updateBatchRoomPreview();" style="width:17px; height:17px;" />
            <span>⚡ สร้างห้องพัก/บ้านเช่าในโครงการนี้รวดเดียวหลายยูนิต (ไม่ต้องนั่งพิมพ์ทีละห้อง!)</span>
          </label>
          <div id="bld-auto-gen-box" class="form-grid" style="display:${!isEdit ? 'grid' : 'none'}; margin-top:8px;">
            <div class="form-group">
              <label>เลขเริ่มต้น</label>
              <input type="number" min="1" class="form-control" id="bld-start-num" value="${existingRoomsCount + 1}" oninput="updateBatchRoomPreview()" />
            </div>
            <div class="form-group">
              <label>ถึงเลขที่</label>
              <input type="number" min="1" class="form-control" id="bld-end-num" value="${existingRoomsCount + 10}" oninput="updateBatchRoomPreview()" />
            </div>
            <div class="form-group">
              <label>อยู่ชั้นที่</label>
              <select class="form-control" id="bld-floor">
                <option value="ชั้น 1">ชั้น 1</option>
                <option value="ชั้น 2">ชั้น 2</option>
                <option value="ชั้น 3">ชั้น 3</option>
                <option value="ชั้น 4">ชั้น 4</option>
              </select>
            </div>
            <div class="form-group full-width" style="margin-bottom:0;">
              <div id="bld-batch-preview" style="font-size:12.5px; color:#1d4ed8; font-weight:700; background:#ffffff; padding:8px 12px; border-radius:8px; border:1px dashed #93c5fd;"></div>
            </div>
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      ${isEdit ? `<button class="btn btn-outline" style="color:#dc2626; border-color:#fecaca; margin-right:auto;" onclick="closeModal(); confirmDeleteBuilding('${escapeHtml(existingZoneName.replace(/'/g, "\\'"))}')">🗑️ ลบตึกนี้ (พร้อมห้องทั้งหมดในตึก)</button>` : ''}
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveBuildingForm('${isEdit ? escapeHtml(existingZoneName.replace(/'/g, "\\'")) : ''}')">💾 บันทึกข้อมูลตึก${!isEdit ? ' & สร้างห้อง' : ''}</button>
    `
  });

  updateBatchRoomPreview();
}

function onBldCategoryChange(cat) {
  const roomTypeEl = document.getElementById('bld-roomType');
  const wTypeEl = document.getElementById('bld-water-type');
  const eTypeEl = document.getElementById('bld-elec-type');
  if (cat === 'house') {
    if (roomTypeEl) roomTypeEl.value = 'บ้านเดี่ยว';
    if (wTypeEl) wTypeEl.value = 'direct';
    if (eTypeEl) eTypeEl.value = 'direct';
  } else {
    if (roomTypeEl && roomTypeEl.value === 'บ้านเดี่ยว') roomTypeEl.value = 'ห้องพัดลม';
    if (wTypeEl && wTypeEl.value === 'direct') wTypeEl.value = 'meter';
    if (eTypeEl && eTypeEl.value === 'direct') eTypeEl.value = 'meter';
  }
  onBldUtilityModeChange();
}

function onBldUtilityModeChange() {
  const s = appState.settings || {};
  const wType = document.getElementById('bld-water-type')?.value || 'meter';
  const wRateEl = document.getElementById('bld-water-rate');
  const wLabelEl = document.getElementById('bld-water-rate-label');
  if (wRateEl) {
    if (wType === 'direct') {
      wRateEl.value = 0;
      wRateEl.readOnly = true;
      wRateEl.style.background = '#e2e8f0';
      if (wLabelEl) wLabelEl.textContent = 'เรทค่าน้ำ (ผู้เช่าจ่ายตรง ไม่คิดเพิ่ม)';
    } else {
      wRateEl.readOnly = false;
      wRateEl.style.background = '#ffffff';
      if (Number(wRateEl.value) === 0) wRateEl.value = s.waterRate ?? 50;
      if (wLabelEl) wLabelEl.textContent = wType === 'flat' ? 'อัตราเหมาจ่ายค่าน้ำ (บาท/เดือน)' : 'เรทค่าน้ำ (บาท/หน่วย)';
    }
  }

  const eType = document.getElementById('bld-elec-type')?.value || 'meter';
  const eRateEl = document.getElementById('bld-elec-rate');
  const eLabelEl = document.getElementById('bld-elec-rate-label');
  if (eRateEl) {
    if (eType === 'direct') {
      eRateEl.value = 0;
      eRateEl.readOnly = true;
      eRateEl.style.background = '#e2e8f0';
      if (eLabelEl) eLabelEl.textContent = 'เรทค่าไฟ (ผู้เช่าจ่ายตรง ไม่คิดเพิ่ม)';
    } else {
      eRateEl.readOnly = false;
      eRateEl.style.background = '#ffffff';
      if (Number(eRateEl.value) === 0) eRateEl.value = s.electricRate ?? 7;
      if (eLabelEl) eLabelEl.textContent = eType === 'flat' ? 'อัตราเหมาจ่ายค่าไฟ (บาท/เดือน)' : 'เรทค่าไฟ (บาท/หน่วย)';
    }
  }
}

function onBldNameInput(val) {
  const prefixEl = document.getElementById('bld-prefix');
  if (prefixEl && !prefixEl.dataset.touched) {
    const m = String(val || '').match(/(\d+)/);
    if (m) {
      prefixEl.value = `H${m[1]}-`;
    }
  }
  if (String(val || '').includes('บ้าน')) {
    const catEl = document.getElementById('bld-category');
    if (catEl && catEl.value !== 'house') {
      catEl.value = 'house';
      onBldCategoryChange('house');
    }
  }
  updateBatchRoomPreview();
}

function updateBatchRoomPreview() {
  const previewEl = document.getElementById('bld-batch-preview');
  const chk = document.getElementById('bld-auto-gen');
  if (!previewEl || !chk || !chk.checked) return;

  const prefix = (document.getElementById('bld-prefix')?.value || '').trim();
  const start = parseInt(document.getElementById('bld-start-num')?.value || '1', 10);
  const end = parseInt(document.getElementById('bld-end-num')?.value || '1', 10);
  if (isNaN(start) || isNaN(end) || end < start) {
    previewEl.textContent = '⚠️ กรุณาระบุเลขห้องสิ้นสุดให้มากกว่าหรือเท่ากับเลขเริ่มต้น';
    return;
  }
  const count = Math.min(100, end - start + 1);
  const firstCode = `${prefix}${String(start).padStart(2, '0')}`;
  const lastCode = `${prefix}${String(start + count - 1).padStart(2, '0')}`;
  previewEl.textContent = `✨ ระบบจะสร้างรหัส: ${firstCode} ถึง ${lastCode} (รวมทั้งหมด ${count} ยูนิต) ให้ทันที`;
}

async function saveBuildingForm(existingZoneName = '') {
  const name = (document.getElementById('bld-name')?.value || '').trim();
  if (!name) {
    showToast('กรุณาระบุชื่อตึก / อาคาร', 'error');
    return;
  }

  const category = document.getElementById('bld-category')?.value || 'room';
  const codePrefix = (document.getElementById('bld-prefix')?.value || '').trim();
  const defaultRoomType = document.getElementById('bld-roomType')?.value || 'ห้องพัดลม';
  const defaultRent = Number(document.getElementById('bld-rent')?.value || 0);
  const defaultDeposit = Number(document.getElementById('bld-deposit')?.value || 0);
  const commonFee = Number(document.getElementById('bld-common')?.value || 0);
  const waterBillingType = document.getElementById('bld-water-type')?.value || 'meter';
  const waterRate = waterBillingType === 'direct' ? 0 : Number(document.getElementById('bld-water-rate')?.value || 0);
  const electricBillingType = document.getElementById('bld-elec-type')?.value || 'meter';
  const electricRate = electricBillingType === 'direct' ? 0 : Number(document.getElementById('bld-elec-rate')?.value || 0);
  const applyToExistingUnits = document.getElementById('bld-apply-to-units')?.checked;
  const autoGen = document.getElementById('bld-auto-gen')?.checked;

  const buildingPayload = {
    oldName: existingZoneName || undefined,
    name,
    category,
    codePrefix,
    defaultRoomType,
    defaultRent,
    defaultDeposit,
    commonFee,
    waterBillingType,
    waterRate,
    electricBillingType,
    electricRate
  };

  const unitsToCreate = [];
  if (autoGen) {
    const start = parseInt(document.getElementById('bld-start-num')?.value || '1', 10);
    const end = parseInt(document.getElementById('bld-end-num')?.value || '1', 10);
    const floor = document.getElementById('bld-floor')?.value || 'ชั้น 1';

    if (!isNaN(start) && !isNaN(end) && end >= start) {
      const limit = Math.min(start + 99, end);
      for (let num = start; num <= limit; num++) {
        const code = `${codePrefix}${String(num).padStart(2, '0')}`;
        unitsToCreate.push({
          code,
          name: defaultRoomType,
          category,
          zone: name,
          floor,
          sizeSqm: '',
          bedrooms: defaultRoomType,
          baseRent: defaultRent,
          defaultDeposit,
          waterBillingType,
          customWaterRate: waterRate,
          electricBillingType,
          customElectricRate: electricRate,
          commonFee,
          otherFixedFee: 0,
          otherFixedFeeLabel: '',
          lastWaterMeter: 0,
          lastElectricMeter: 0,
          status: 'available',
          notes: ''
        });
      }
    }
  }

  // Save building metadata into settings.customBuildings (compatible with all server versions)
  const customBuildings = [...getCustomBuildingsList()];
  const bIdx = customBuildings.findIndex(b => b.name === (existingZoneName || name));
  if (bIdx >= 0) {
    customBuildings[bIdx] = { ...customBuildings[bIdx], ...buildingPayload };
  } else {
    customBuildings.push(buildingPayload);
  }
  await apiPost('/api/settings', { customBuildings });

  // Update existing units in this building (rename zone and/or apply utility & category settings)
  const targetZoneMatch = existingZoneName || name;
  const existingUnitsInZone = (appState.units || []).filter(
    u => (u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === targetZoneMatch
  );
  for (const u of existingUnitsInZone) {
    const updatedUnit = { ...u, zone: name };
    if (applyToExistingUnits) {
      updatedUnit.category = category;
      updatedUnit.bedrooms = defaultRoomType;
      updatedUnit.baseRent = defaultRent;
      updatedUnit.defaultDeposit = defaultDeposit;
      updatedUnit.commonFee = commonFee;
      updatedUnit.waterBillingType = waterBillingType;
      updatedUnit.customWaterRate = waterRate;
      updatedUnit.electricBillingType = electricBillingType;
      updatedUnit.customElectricRate = electricRate;
    }
    await apiPost('/api/units', updatedUnit);
  }

  // Create batch units using universal /api/units endpoint
  for (const unit of unitsToCreate) {
    await apiPost('/api/units', unit);
  }

  selectedZoneFilter = name;
  closeModal();
  renderCurrentTab();
  if (unitsToCreate.length > 0) {
    showToast(`บันทึกตึก ${name} และสร้างห้องพัก ${unitsToCreate.length} ยูนิตเรียบร้อยแล้ว!`);
  } else {
    showToast(`บันทึกการตั้งค่า ${name} เรียบร้อยแล้ว`);
  }
}

// ----------------------------------------------------------------------------
// SMART COMPACT ROOM / UNIT MODAL (เลือกตึกแล้วดึงค่าอัตโนมัติ พิมพ์น้อยที่สุด)
// ----------------------------------------------------------------------------
function openUnitModal(unitId = null, defaultCategory = null, preselectZone = null) {
  const existing = unitId ? (appState.units || []).find(u => u.id === unitId) : null;
  const s = appState.settings || {};
  const allZones = getAllZonesList();
  const initialZone = existing
    ? existing.zone
    : preselectZone || (selectedZoneFilter !== 'all' ? selectedZoneFilter : (allZones[0] || 'Harnying 1'));

  const bldCfg = getBuildingConfig(initialZone);
  const autoNextCode = !existing ? suggestNextRoomCode(initialZone) : existing.code;

  const initialCat = defaultCategory || bldCfg.category || 'room';
  const u = existing || {
    id: '',
    code: autoNextCode,
    name: '',
    category: initialCat,
    zone: initialZone,
    floor: 'ชั้น 1',
    sizeSqm: '',
    bedrooms: bldCfg.defaultRoomType || (initialCat === 'house' ? 'บ้านเดี่ยว' : 'ห้องพัดลม'),
    baseRent: bldCfg.defaultRent ?? (initialCat === 'house' ? 6000 : 2000),
    defaultDeposit: bldCfg.defaultDeposit ?? (initialCat === 'house' ? 8000 : 3000),
    waterBillingType: bldCfg.waterBillingType || (initialCat === 'house' ? 'direct' : 'meter'),
    customWaterRate: bldCfg.waterRate ?? (initialCat === 'house' ? 0 : (s.waterRate ?? 50)),
    electricBillingType: bldCfg.electricBillingType || (initialCat === 'house' ? 'direct' : 'meter'),
    customElectricRate: bldCfg.electricRate ?? (initialCat === 'house' ? 0 : (s.electricRate ?? 7)),
    commonFee: bldCfg.commonFee ?? (initialCat === 'house' ? 0 : 20),
    otherFixedFee: 0,
    otherFixedFeeLabel: '',
    lastWaterMeter: 0,
    lastElectricMeter: 0,
    status: 'available',
    notes: ''
  };

  const zoneOptionsHtml = allZones.map(z => `<option value="${escapeHtml(z)}" ${z === u.zone ? 'selected' : ''}>🏢 ${escapeHtml(z)}</option>`).join('');
  const roomTypes = ['ห้องพัดลม', 'ห้องแอร์', 'บ้านเดี่ยว', 'ร้านค้า'];

  showModal({
    title: existing ? `แก้ไขข้อมูลห้อง/บ้าน: ${u.code} (${u.zone})` : `➕ เพิ่มห้องพัก / บ้านเช่าใหม่ (ดึงค่าจากตึกอัตโนมัติ)`,
    bodyHtml: `
      <form id="unit-form" style="display:flex; flex-direction:column; gap:14px;">
        
        <!-- SECTION 1: ข้อมูลตึกและห้องพัก -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 18px; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
          <div style="font-size:13.5px; font-weight:800; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
            <span style="display:flex; align-items:center; gap:6px;">🏢 1. ข้อมูลอาคาร & เลขห้อง</span>
            <button type="button" class="btn btn-sm btn-outline" style="padding:2px 10px; font-size:12px; font-weight:600;" onclick="closeModal(); openBuildingModal();">+ เพิ่มตึกใหม่</button>
          </div>

          <div style="display:grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1fr); gap:12px; margin-bottom:12px;">
            <div class="form-group">
              <label>ตึก / อาคาร / โครงการ *</label>
              <select class="form-control" name="zone" id="unit-zone-select" onchange="onUnitZoneChange(this.value)" style="font-weight:700; font-size:14px; border-color:#93c5fd; background:#eff6ff; color:#1e40af;">
                ${zoneOptionsHtml || `<option value="${escapeHtml(u.zone)}">${escapeHtml(u.zone)}</option>`}
              </select>
            </div>
            <div class="form-group">
              <label>ชั้น</label>
              <select class="form-control" name="floor" id="unit-floor-select">
                <option value="ชั้น 1" ${u.floor === 'ชั้น 1' || u.floor === '1 ชั้น' ? 'selected' : ''}>ชั้น 1</option>
                <option value="ชั้น 2" ${u.floor === 'ชั้น 2' || u.floor === '2 ชั้น' ? 'selected' : ''}>ชั้น 2</option>
                <option value="ชั้น 3" ${u.floor === 'ชั้น 3' ? 'selected' : ''}>ชั้น 3</option>
                <option value="ชั้น 4" ${u.floor === 'ชั้น 4' ? 'selected' : ''}>ชั้น 4</option>
                <option value="ชั้น 5" ${u.floor === 'ชั้น 5' ? 'selected' : ''}>ชั้น 5</option>
                <option value="ชั้น 6" ${u.floor === 'ชั้น 6' ? 'selected' : ''}>ชั้น 6</option>
                <option value="ชั้น 7" ${u.floor === 'ชั้น 7' ? 'selected' : ''}>ชั้น 7</option>
                <option value="ชั้น 8" ${u.floor === 'ชั้น 8' ? 'selected' : ''}>ชั้น 8</option>
              </select>
            </div>
            <div class="form-group">
              <label>เลขห้อง / บ้านเลขที่ *</label>
              <input type="text" class="form-control" name="code" id="unit-code-input" value="${escapeHtml(u.code)}" style="font-weight:800; font-size:16px; color:#1e293b; border-color:#93c5fd;" required />
            </div>
          </div>

          <div class="form-group" style="margin-bottom:12px;">
            <label>รูปแบบห้อง/บ้าน (คลิกเลือกได้ทันที หรือพิมพ์ระบุเอง)</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              ${roomTypes.map(rt => `
                <button type="button" class="btn btn-sm room-type-pill ${u.bedrooms === rt ? 'btn-primary' : 'btn-outline'}" style="padding:5px 12px; font-size:13px; font-weight:600;" onclick="selectQuickRoomType('${rt}', this)">
                  ${rt === 'ห้องพัดลม' ? '🌀' : rt === 'ห้องแอร์' ? '❄️' : rt === 'บ้านเดี่ยว' ? '🏠' : '🏪'} ${rt}
                </button>
              `).join('')}
              <input type="text" class="form-control" name="bedrooms" id="unit-bedrooms-input" value="${escapeHtml(u.bedrooms)}" style="width:170px; height:34px; font-size:13px;" placeholder="หรือระบุเอง..." />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); gap:12px;">
            <div class="form-group">
              <label>ประเภทอสังหาฯ</label>
              <select class="form-control" name="category" id="unit-cat-select" onchange="onUnitCategorySelectChange(this.value)">
                <option value="room" ${u.category === 'room' ? 'selected' : ''}>🏢 ห้องเช่า / อพาร์ตเมนต์</option>
                <option value="house" ${u.category === 'house' ? 'selected' : ''}>🏠 บ้านเช่าเป็นหลัง</option>
              </select>
            </div>
            <div class="form-group">
              <label>สถานะห้องปัจจุบัน</label>
              <select class="form-control" name="status" style="font-weight:700;">
                <option value="available" ${u.status === 'available' ? 'selected' : ''}>🟢 ว่างพร้อมเช่า</option>
                <option value="occupied" ${u.status === 'occupied' ? 'selected' : ''}>🔵 มีผู้เช่า</option>
                <option value="maintenance" ${u.status === 'maintenance' ? 'selected' : ''}>🟡 ปิดซ่อมบำรุง</option>
              </select>
            </div>
            <div class="form-group">
              <label>ชื่อเรียกเพิ่มเติม (ถ้ามี)</label>
              <input type="text" class="form-control" name="name" id="unit-name-input" value="${escapeHtml(u.name)}" placeholder="เช่น ห้องมุม, วิวสวน" />
            </div>
          </div>
        </div>

        <!-- SECTION 2: ค่าเช่าและเงินประกัน (3 คอลัมน์สมมาตรเป๊ะ) -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 18px; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
          <div style="font-size:13.5px; font-weight:800; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            💰 2. ค่าเช่าและเงินประกัน
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); gap:12px;">
            <div class="form-group">
              <label>ค่าเช่า (บาท/เดือน) *</label>
              <input type="number" class="form-control" name="baseRent" id="unit-rent-input" value="${u.baseRent}" style="font-weight:800; font-size:16px; color:#1d4ed8; background:#eff6ff; border:1.5px solid #93c5fd;" required />
            </div>
            <div class="form-group">
              <label>เงินประกันมาตรฐาน (บาท)</label>
              <input type="number" class="form-control" name="defaultDeposit" id="unit-deposit-input" value="${u.defaultDeposit}" style="font-weight:700;" />
            </div>
            <div class="form-group">
              <label>ค่าส่วนกลาง / ค่าขยะ (บาท/เดือน)</label>
              <input type="number" class="form-control" name="commonFee" id="unit-common-input" value="${u.commonFee}" style="font-weight:700;" />
            </div>
          </div>
        </div>

        <!-- SECTION 3: 💧 ค่าน้ำประปา (3 คอลัมน์ แถวเดียวกันชัดเจน พอดีกรอบ) -->
        <div style="background:#f0f9ff; border:1.5px solid #bae6fd; border-radius:12px; padding:14px 18px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="font-size:13.5px; font-weight:800; color:#0369a1; display:flex; align-items:center; gap:6px;">
              💧 3. ระบบค่าน้ำประปา
            </div>
            <span style="font-size:11.5px; color:#0284c7; background:#e0f2fe; padding:2px 10px; border-radius:12px; font-weight:700;">แก้ไขได้อิสระ</span>
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.85fr) minmax(0, 0.85fr); gap:12px;">
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">วิธีคิดค่าน้ำ</label>
              <select class="form-control" name="waterBillingType" id="unit-water-type" onchange="onUnitUtilityTypeChange()" style="background:#ffffff; border-color:#93c5fd; font-weight:600;">
                <option value="meter" ${u.waterBillingType === 'meter' ? 'selected' : ''}>คิดตามมิเตอร์ (บาท/หน่วย)</option>
                <option value="direct" ${u.waterBillingType === 'direct' ? 'selected' : ''}>จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</option>
                <option value="actual_bill" ${u.waterBillingType === 'actual_bill' ? 'selected' : ''}>เรียกเก็บตามบิลการประปาจริง</option>
                <option value="flat" ${u.waterBillingType === 'flat' ? 'selected' : ''}>เหมาจ่ายรายเดือน (บาท/เดือน)</option>
              </select>
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;" id="unit-water-rate-label">${u.waterBillingType === 'direct' ? 'เรทค่าน้ำ (ไม่คิดเพิ่ม)' : 'เรทค่าน้ำ (บาท/หน่วย)'}</label>
              <input type="number" step="0.01" class="form-control" name="customWaterRate" id="unit-water-rate" value="${u.waterBillingType === 'direct' ? 0 : u.customWaterRate}" ${u.waterBillingType === 'direct' ? 'readonly' : ''} style="background:${u.waterBillingType === 'direct' ? '#e2e8f0' : '#ffffff'}; border-color:#93c5fd; font-weight:800; font-size:15px; color:#0369a1;" />
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">เลขมิเตอร์น้ำปัจจุบัน</label>
              <input type="number" step="0.01" class="form-control" name="lastWaterMeter" value="${u.lastWaterMeter}" style="background:#ffffff; border-color:#93c5fd; font-weight:800; font-size:15px;" />
            </div>
          </div>
        </div>

        <!-- SECTION 4: ⚡ ค่าไฟฟ้า (3 คอลัมน์ แถวเดียวกันชัดเจน พอดีกรอบ) -->
        <div style="background:#fffbeb; border:1.5px solid #fde68a; border-radius:12px; padding:14px 18px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="font-size:13.5px; font-weight:800; color:#b45309; display:flex; align-items:center; gap:6px;">
              ⚡ 4. ระบบค่าไฟฟ้า
            </div>
            <span style="font-size:11.5px; color:#d97706; background:#fef3c7; padding:2px 10px; border-radius:12px; font-weight:700;">แก้ไขได้อิสระ</span>
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.85fr) minmax(0, 0.85fr); gap:12px;">
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;">วิธีคิดค่าไฟ</label>
              <select class="form-control" name="electricBillingType" id="unit-elec-type" onchange="onUnitUtilityTypeChange()" style="background:#ffffff; border-color:#fcd34d; font-weight:600;">
                <option value="meter" ${u.electricBillingType === 'meter' ? 'selected' : ''}>คิดตามมิเตอร์ (บาท/หน่วย)</option>
                <option value="direct" ${u.electricBillingType === 'direct' ? 'selected' : ''}>จ่ายตรงกับหน่วยงาน (ไม่คิดเพิ่ม)</option>
                <option value="actual_bill" ${u.electricBillingType === 'actual_bill' ? 'selected' : ''}>เรียกเก็บตามบิลการไฟฟ้าจริง</option>
                <option value="flat" ${u.electricBillingType === 'flat' ? 'selected' : ''}>เหมาจ่ายรายเดือน (บาท/เดือน)</option>
              </select>
            </div>
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;" id="unit-elec-rate-label">${u.electricBillingType === 'direct' ? 'เรทค่าไฟ (ไม่คิดเพิ่ม)' : 'เรทค่าไฟ (บาท/หน่วย)'}</label>
              <input type="number" step="0.01" class="form-control" name="customElectricRate" id="unit-elec-rate" value="${u.electricBillingType === 'direct' ? 0 : u.customElectricRate}" ${u.electricBillingType === 'direct' ? 'readonly' : ''} style="background:${u.electricBillingType === 'direct' ? '#e2e8f0' : '#ffffff'}; border-color:#fcd34d; font-weight:800; font-size:15px; color:#b45309;" />
            </div>
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;">เลขมิเตอร์ไฟปัจจุบัน</label>
              <input type="number" step="0.01" class="form-control" name="lastElectricMeter" value="${u.lastElectricMeter}" style="background:#ffffff; border-color:#fcd34d; font-weight:800; font-size:15px;" />
            </div>
          </div>
        </div>

        <!-- SECTION 5: 🚗 ค่าบริการคงที่อื่นๆ และหมายเหตุ -->
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px;">
          <div style="font-size:13.5px; font-weight:800; color:#475569; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
            🚗 5. ค่าบริการเพิ่มเติม & หมายเหตุ
          </div>
          <div style="display:grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap:12px; margin-bottom:10px;">
            <div class="form-group">
              <label>ชื่อค่าบริการอื่นๆ (เช่น ค่าที่จอดรถ, ค่า Wi-Fi)</label>
              <input type="text" class="form-control" name="otherFixedFeeLabel" value="${escapeHtml(u.otherFixedFeeLabel || '')}" placeholder="เว้นว่างไว้ถ้าไม่มี เช่น ค่าที่จอดรถ, ค่า Wi-Fi" />
            </div>
            <div class="form-group">
              <label>ค่าบริการคงที่ (บาท/เดือน)</label>
              <input type="number" class="form-control" name="otherFixedFee" value="${u.otherFixedFee || 0}" />
            </div>
          </div>
          <div class="form-group">
            <label>หมายเหตุห้องพัก / รายการสิ่งอำนวยความสะดวก</label>
            <input type="text" class="form-control" name="notes" value="${escapeHtml(u.notes || '')}" placeholder="เช่น มีเครื่องทำน้ำอุ่น, แอร์, เตียง 5 ฟุต หรือข้อตกลงพิเศษ" />
          </div>
        </div>

      </form>
    `,
    footerHtml: `
      ${existing ? `<button class="btn btn-outline" style="color:#dc2626; border-color:#fecaca; margin-right:auto;" onclick="closeModal(); confirmDeleteUnit('${u.id}')">🗑️ ลบห้องนี้</button>` : ''}
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      ${!existing ? `<button class="btn btn-outline" onclick="saveUnitForm('', true)">💾 บันทึก & เพิ่มห้องถัดไปต่อทันที</button>` : ''}
      <button class="btn btn-primary" onclick="saveUnitForm('${u.id || ''}', false)">💾 บันทึกข้อมูล</button>
    `
  });

  window.__isEditingExistingUnit = Boolean(existing);
}

function onUnitCategorySelectChange(cat) {
  const wTypeEl = document.getElementById('unit-water-type');
  const eTypeEl = document.getElementById('unit-elec-type');
  if (cat === 'house') {
    if (wTypeEl) wTypeEl.value = 'direct';
    if (eTypeEl) eTypeEl.value = 'direct';
  }
  onUnitUtilityTypeChange();
}

function onUnitUtilityTypeChange() {
  const s = appState.settings || {};
  const wType = document.getElementById('unit-water-type')?.value || 'meter';
  const wRateEl = document.getElementById('unit-water-rate');
  const wLabelEl = document.getElementById('unit-water-rate-label');
  if (wRateEl) {
    if (wType === 'direct') {
      wRateEl.value = 0;
      wRateEl.readOnly = true;
      wRateEl.style.background = '#e2e8f0';
      if (wLabelEl) wLabelEl.textContent = 'เรทค่าน้ำ (จ่ายตรง ไม่คิดเพิ่ม)';
    } else {
      wRateEl.readOnly = false;
      wRateEl.style.background = '#ffffff';
      if (Number(wRateEl.value) === 0) wRateEl.value = s.waterRate ?? 50;
      if (wLabelEl) wLabelEl.textContent = wType === 'flat' ? 'อัตราเหมาค่าน้ำ (บาท/เดือน)' : 'เรทค่าน้ำ (บาท/หน่วย)';
    }
  }

  const eType = document.getElementById('unit-elec-type')?.value || 'meter';
  const eRateEl = document.getElementById('unit-elec-rate');
  const eLabelEl = document.getElementById('unit-elec-rate-label');
  if (eRateEl) {
    if (eType === 'direct') {
      eRateEl.value = 0;
      eRateEl.readOnly = true;
      eRateEl.style.background = '#e2e8f0';
      if (eLabelEl) eLabelEl.textContent = 'เรทค่าไฟ (จ่ายตรง ไม่คิดเพิ่ม)';
    } else {
      eRateEl.readOnly = false;
      eRateEl.style.background = '#ffffff';
      if (Number(eRateEl.value) === 0) eRateEl.value = s.electricRate ?? 7;
      if (eLabelEl) eLabelEl.textContent = eType === 'flat' ? 'อัตราเหมาค่าไฟ (บาท/เดือน)' : 'เรทค่าไฟ (บาท/หน่วย)';
    }
  }
}

function selectQuickRoomType(rt, btnEl) {
  const input = document.getElementById('unit-bedrooms-input');
  if (input) input.value = rt;
  document.querySelectorAll('.room-type-pill').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-outline');
  });
  if (btnEl) {
    btnEl.classList.remove('btn-outline');
    btnEl.classList.add('btn-primary');
  }
  const catSelect = document.getElementById('unit-cat-select');
  const isHouse = rt.includes('บ้าน');
  if (catSelect) {
    catSelect.value = isHouse ? 'house' : 'room';
  }
  if (isHouse) {
    onUnitCategorySelectChange('house');
  }
}

function onUnitZoneChange(zoneName) {
  if (window.__isEditingExistingUnit) return;
  const cfg = getBuildingConfig(zoneName);
  const codeEl = document.getElementById('unit-code-input');
  const rentEl = document.getElementById('unit-rent-input');
  const depEl = document.getElementById('unit-deposit-input');
  const comEl = document.getElementById('unit-common-input');
  const catEl = document.getElementById('unit-cat-select');
  const bedEl = document.getElementById('unit-bedrooms-input');
  const wTypeEl = document.getElementById('unit-water-type');
  const wRateEl = document.getElementById('unit-water-rate');
  const eTypeEl = document.getElementById('unit-elec-type');
  const eRateEl = document.getElementById('unit-elec-rate');

  if (codeEl) codeEl.value = suggestNextRoomCode(zoneName);
  if (rentEl) rentEl.value = cfg.defaultRent;
  if (depEl) depEl.value = cfg.defaultDeposit;
  if (comEl) comEl.value = cfg.commonFee;
  if (catEl) catEl.value = cfg.category;
  if (bedEl) bedEl.value = cfg.defaultRoomType;
  if (wTypeEl) wTypeEl.value = cfg.waterBillingType || 'meter';
  if (wRateEl) wRateEl.value = cfg.waterRate ?? 50;
  if (eTypeEl) eTypeEl.value = cfg.electricBillingType || 'meter';
  if (eRateEl) eRateEl.value = cfg.electricRate ?? 7;
  onUnitUtilityTypeChange();
}

async function saveUnitForm(existingId, keepOpenForNext = false) {
  const form = document.getElementById('unit-form');
  const fd = new FormData(form);
  const code = (fd.get('code') || '').trim();
  if (!code) {
    showToast('กรุณาระบุบ้านเลขที่หรือรหัสห้อง', 'error');
    return;
  }

  const zone = fd.get('zone') || 'Harnying 1';
  const bedrooms = (fd.get('bedrooms') || 'ห้องพัดลม').trim();
  const customName = (fd.get('name') || '').trim();

  const payload = {
    id: existingId || undefined,
    code,
    name: customName || bedrooms,
    category: fd.get('category') || (bedrooms.includes('บ้าน') ? 'house' : 'room'),
    zone,
    floor: fd.get('floor') || 'ชั้น 1',
    bedrooms,
    baseRent: Number(fd.get('baseRent') || 0),
    defaultDeposit: Number(fd.get('defaultDeposit') || 0),
    commonFee: Number(fd.get('commonFee') || 0),
    waterBillingType: fd.get('waterBillingType') || 'meter',
    customWaterRate: Number(fd.get('customWaterRate') || 0),
    lastWaterMeter: Number(fd.get('lastWaterMeter') || 0),
    electricBillingType: fd.get('electricBillingType') || 'meter',
    customElectricRate: Number(fd.get('customElectricRate') || 0),
    lastElectricMeter: Number(fd.get('lastElectricMeter') || 0),
    otherFixedFee: Number(fd.get('otherFixedFee') || 0),
    otherFixedFeeLabel: fd.get('otherFixedFeeLabel') || '',
    status: fd.get('status') || 'available',
    notes: fd.get('notes') || ''
  };

  await apiPost('/api/units', payload);
  renderCurrentTab();
  showToast(`บันทึกห้อง ${code} (${zone}) เรียบร้อยแล้ว`);

  if (keepOpenForNext) {
    openUnitModal(null, payload.category, zone);
  } else {
    closeModal();
  }
}

async function confirmDeleteUnit(unitId) {
  const unit = (appState.units || []).find(u => u.id === unitId);
  if (!unit) return;
  if (!confirm(`ยืนยันการลบห้อง "${unit.code}" (${unit.zone || ''}) ใช่หรือไม่?`)) return;
  try {
    await apiPost('/api/units/delete', { id: unitId });
    renderCurrentTab();
    showToast(`ลบห้อง ${unit.code} เรียบร้อยแล้ว`);
  } catch (err) {
    showToast(`เกิดข้อผิดพลาดในการลบห้อง: ${err.message}`, 'error');
  }
}

async function confirmDeleteBuilding(zoneName) {
  if (!zoneName) return;
  const unitsInBuilding = (appState.units || []).filter(
    u => (u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === zoneName
  );
  const count = unitsInBuilding.length;
  const msg = count > 0
    ? `ยืนยันการลบตึก "${zoneName}" และห้องพักในตึกนี้ทั้งหมด (${count} ห้อง) ใช่หรือไม่?`
    : `ยืนยันการลบตึก "${zoneName}" ใช่หรือไม่?`;
  if (!confirm(msg)) return;

  try {
    // Delete all units in this building via universal /api/units/delete endpoint
    for (const u of unitsInBuilding) {
      await apiPost('/api/units/delete', { id: u.id });
    }
    // Remove building from settings.customBuildings
    const customBuildings = getCustomBuildingsList().filter(b => b.name !== zoneName);
    await apiPost('/api/settings', { customBuildings });
    // Also notify /api/buildings/delete if supported by server
    fetch('/api/buildings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: zoneName })
    }).catch(() => {});

    if (selectedZoneFilter === zoneName) {
      selectedZoneFilter = 'all';
    }
    renderCurrentTab();
    showToast(`ลบตึก ${zoneName} และห้องพักเรียบร้อยแล้ว`);
  } catch (err) {
    showToast(`เกิดข้อผิดพลาดในการลบตึก: ${err.message}`, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 3: TENANTS & CONTRACTS
// ----------------------------------------------------------------------------
function renderTenantsTab(container) {
  const unitsMap = {};
  for (const u of appState.units || []) unitsMap[u.id] = u;

  const tenants = (appState.tenants || []).filter(t => {
    const unit = unitsMap[t.unitId];
    if (categoryFilter !== 'all' && unit && unit.category !== categoryFilter) return false;
    if (selectedZoneFilter !== 'all') {
      const zName = unit ? (unit.zone || (unit.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) : '';
      if (zName !== selectedZoneFilter) return false;
    }
    return true;
  });

  const activeTenants = tenants.filter(t => t.status === 'active');
  const pastTenants = tenants.filter(t => t.status !== 'active');

  let rowsHtml = '';
  let lastZone = null;
  for (const t of activeTenants) {
    const u = unitsMap[t.unitId];
    const zName = u ? (u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) : 'ไม่ระบุอาคาร';
    if (zName !== lastZone) {
      lastZone = zName;
      const theme = getZoneTheme(zName);
      const zCount = activeTenants.filter(x => {
        const xu = unitsMap[x.unitId];
        return (xu ? (xu.zone || (xu.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) : 'ไม่ระบุอาคาร') === zName;
      }).length;
      rowsHtml += `
        <tr style="background:${theme.bg}; border-top:2px solid ${theme.border};">
          <td colspan="7" style="padding:9px 14px; font-weight:800; color:${theme.text}; font-size:13.5px;">
            🏢 อาคาร / โซน: ${escapeHtml(zName)} <span class="badge" style="background:${theme.border}; color:#fff; margin-left:6px;">${zCount} สัญญา</span>
          </td>
        </tr>
      `;
    }
    rowsHtml += `
      <tr>
        <td>
          <strong>${escapeHtml(u ? u.code : '-')}</strong>
          <div style="margin-top:2px;">${u ? getCategoryBadge(u.category) : ''}</div>
        </td>
        <td>
          <div><strong>${escapeHtml(t.fullName)}</strong></div>
          <div style="font-size:12px; color:var(--text-muted)">บัตร: ${escapeHtml(t.idCard || '-')}</div>
        </td>
        <td>
          <div>📞 ${escapeHtml(t.phone || '-')}</div>
          <div style="font-size:12px; color:var(--text-muted)">LINE: ${escapeHtml(t.lineId || '-')} | รถ: ${escapeHtml(t.vehiclePlate || '-')}</div>
        </td>
        <td>
          <div>เริ่ม: ${formatDateThai(t.contractStartDate)}</div>
          <div style="font-size:12px; color:var(--text-muted)">สิ้นสุด: ${formatDateThai(t.contractEndDate)}</div>
        </td>
        <td class="text-right"><strong>฿${formatMoney(t.agreedRent)}</strong></td>
        <td class="text-right">฿${formatMoney(t.depositAmount)}</td>
        <td class="text-right" style="white-space:nowrap;">
          <button class="btn btn-sm btn-outline" style="color:#1d4ed8; border-color:#93c5fd; background:#eff6ff; font-weight:600;" onclick="openContractPreviewModal('${t.id}', '${t.unitId}')">📄 ดู/แก้ใบสัญญา</button>
          <button class="btn btn-sm btn-outline" onclick="openTenantModal('${t.id}')">✏️ แก้ไขข้อมูล</button>
          <button class="btn btn-sm btn-warning" onclick="openMoveOutModal('${t.id}')">แจ้งย้ายออก</button>
        </td>
      </tr>
    `;
  }

  const pastRowsHtml = pastTenants.map(t => {
    const u = unitsMap[t.unitId];
    return `
      <tr>
        <td>${escapeHtml(u ? u.code : '-')}</td>
        <td>${escapeHtml(t.fullName)}</td>
        <td>${escapeHtml(t.phone || '-')}</td>
        <td>${formatDateThai(t.contractStartDate)} - ${formatDateThai(t.moveOutDate)}</td>
        <td class="text-right">฿${formatMoney(t.depositAmount)}</td>
        <td class="text-right">
          <button class="btn btn-sm btn-outline" onclick="openContractPreviewModal('${t.id}', '${t.unitId}')">📄 ดูใบสัญญา</button>
          <button class="btn btn-sm btn-outline" onclick="openTenantModal('${t.id}')">ดูข้อมูล</button>
          <button class="btn btn-sm btn-outline" style="color:#dc2626" onclick="confirmDeleteTenant('${t.id}')">ลบ</button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    ${renderZoneSelectorBar()}
    <div class="card">
      <div class="card-header" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="card-title">👥 ผู้เช่าปัจจุบัน & สัญญาเช่า (${activeTenants.length} ราย)</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline" style="border-color:#93c5fd; color:#1d4ed8; background:#eff6ff; font-weight:700;" onclick="openContractTemplateModal()">⚙️ แก้ไขแม่แบบข้อสัญญามาตรฐาน</button>
          <button class="btn btn-outline" onclick="openContractPreviewModal()">📄 ดู/แก้ไขใบสัญญาเช่า</button>
          <button class="btn btn-primary" onclick="openTenantModal()">+ ทำสัญญาผู้เช่าใหม่ (Check-in)</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>บ้าน / ห้อง</th>
              <th>ชื่อ-นามสกุลผู้เช่า</th>
              <th>เบอร์โทร / ติดต่อ</th>
              <th>ระยะเวลาสัญญา</th>
              <th class="text-right">ค่าเช่าตกลง</th>
              <th class="text-right">เงินประกัน</th>
              <th class="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `
              <tr>
                <td colspan="7" class="text-center" style="padding:36px 20px;">
                  <div style="font-size:15px; font-weight:700; color:#334155; margin-bottom:6px;">ยังไม่มีรายการสัญญาเช่าที่ลงทะเบียนผู้เช่า</div>
                  <div style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">คุณสามารถกดปุ่มด้านล่างเพื่อทำสัญญาเช่าห้องพัก หรือปรับแก้ข้อความแม่แบบหนังสือสัญญาเช่าได้ทันที</div>
                  <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="openTenantModal()">+ ทำสัญญาผู้เช่าใหม่ (Check-in)</button>
                    <button class="btn btn-outline" style="border-color:#93c5fd; color:#1d4ed8; background:#eff6ff; font-weight:700;" onclick="openContractTemplateModal()">⚙️ แก้ไขแม่แบบข้อสัญญามาตรฐาน</button>
                    <button class="btn btn-outline" onclick="openContractPreviewModal()">📄 เปิดดู/แก้ไขใบสัญญาเช่า</button>
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>

    ${pastTenants.length > 0 ? `
    <div class="card">
      <div class="card-header">
        <div class="card-title">📁 ประวัติผู้เช่าที่ย้ายออกแล้ว (${pastTenants.length} ราย)</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>บ้าน / ห้อง</th>
              <th>ชื่อ-นามสกุล</th>
              <th>เบอร์โทร</th>
              <th>ช่วงเวลาที่พักอาศัย</th>
              <th class="text-right">เงินประกันเดิม</th>
              <th class="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>${pastRowsHtml}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

function openTenantModal(tenantId = null, preselectUnitId = null) {
  let existing = tenantId ? (appState.tenants || []).find(t => t.id === tenantId) : null;
  if (!existing && preselectUnitId) {
    existing = (appState.tenants || []).find(t => t.unitId === preselectUnitId && t.status === 'active') || null;
  }
  const units = appState.units || [];
  const chosenUnitId = existing ? existing.unitId : (preselectUnitId || (units[0] ? units[0].id : ''));
  const chosenUnit = units.find(u => u.id === chosenUnitId) || {};
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = `${parseInt(today.slice(0, 4), 10) + 1}${today.slice(4)}`;

  const t = existing || {
    id: '',
    unitId: chosenUnitId,
    fullName: '',
    idCard: '',
    phone: '',
    lineId: '',
    emergencyContact: '',
    vehiclePlate: '',
    occupantCount: 1,
    permanentAddress: '',
    contractStartDate: today,
    contractEndDate: nextYear,
    agreedRent: chosenUnit.baseRent || 3500,
    depositAmount: chosenUnit.defaultDeposit || 5000,
    advanceRent: chosenUnit.baseRent || 3500,
    initialWaterMeter: chosenUnit.lastWaterMeter || 0,
    initialElectricMeter: chosenUnit.lastElectricMeter || 0,
    status: 'active',
    notes: ''
  };

  const unitOptions = units.map(u => {
    const label = `${u.category === 'house' ? '🏠' : '🏢'} ${u.code} (${u.zone || ''}) - ฿${formatMoney(u.baseRent)} [${u.status === 'available' ? 'ว่าง' : 'มีผู้เช่า'}]`;
    return `<option value="${u.id}" ${u.id === t.unitId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');

  showModal({
    title: existing ? `✏️ แก้ไขข้อมูลผู้เช่า & สัญญาเช่า: ${t.fullName}` : '📝 ทำสัญญาเช่า / ลงทะเบียนผู้เช่าเข้าอยู่ (Check-in)',
    bodyHtml: `
      <form id="tenant-form" style="display:flex; flex-direction:column; gap:14px;">
        <!-- CARD 1: ห้องพักและสถานะสัญญา -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
          <div style="font-size:13.5px; font-weight:800; color:#1e293b; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
            <span>🏢 1. ห้องพักที่ทำสัญญา & สถานะ</span>
            <button type="button" class="btn btn-sm btn-outline" style="padding:2px 10px; font-size:11.5px; color:#1d4ed8; border-color:#93c5fd; background:#eff6ff;" onclick="closeModal(); openContractTemplateModal('${t.id || ''}', '${t.unitId || ''}');">⚙️ ตั้งค่าแม่แบบข้อสัญญามาตรฐาน</button>
          </div>
          <div style="display:grid; grid-template-columns: 1.8fr 1fr 0.8fr; gap:12px;">
            <div class="form-group">
              <label>เลือกบ้านเช่า / ห้องเช่า *</label>
              <select class="form-control" name="unitId" id="tf-unitId" onchange="onTenantUnitSelectChange(this.value)" style="font-weight:700; color:#1e40af; background:#eff6ff; border-color:#93c5fd;">
                ${unitOptions}
              </select>
            </div>
            <div class="form-group">
              <label>สถานะสัญญา</label>
              <select class="form-control" name="status" style="font-weight:700;">
                <option value="active" ${t.status === 'active' ? 'selected' : ''}>🟢 กำลังเช่าอยู่ (Active)</option>
                <option value="moved_out" ${t.status === 'moved_out' ? 'selected' : ''}>🔴 ย้ายออกแล้ว</option>
              </select>
            </div>
            <div class="form-group">
              <label>จำนวนผู้พัก (คน)</label>
              <input type="number" min="1" class="form-control" name="occupantCount" value="${t.occupantCount || 1}" />
            </div>
          </div>
        </div>

        <!-- CARD 2: ข้อมูลผู้เช่าและการติดต่อ -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
          <div style="font-size:13.5px; font-weight:800; color:#1e293b; margin-bottom:10px;">
            👤 2. ข้อมูลผู้เช่าและการติดต่อ
          </div>
          <div style="display:grid; grid-template-columns: 1.3fr 1.1fr 1fr; gap:12px; margin-bottom:10px;">
            <div class="form-group">
              <label>ชื่อ-นามสกุลผู้เช่า *</label>
              <input type="text" class="form-control" name="fullName" value="${escapeHtml(t.fullName)}" placeholder="เช่น คุณสมชาย ใจดี" style="font-weight:700;" required />
            </div>
            <div class="form-group">
              <label>เลขบัตรประชาชน / พาสปอร์ต</label>
              <input type="text" class="form-control" name="idCard" value="${escapeHtml(t.idCard)}" placeholder="1-xxxx-xxxxx-xx-x" />
            </div>
            <div class="form-group">
              <label>เบอร์โทรศัพท์ *</label>
              <input type="text" class="form-control" name="phone" value="${escapeHtml(t.phone)}" placeholder="08x-xxx-xxxx" style="font-weight:700;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:10px;">
            <div class="form-group">
              <label>LINE ID (ถ้ามี)</label>
              <input type="text" class="form-control" name="lineId" value="${escapeHtml(t.lineId)}" placeholder="ไอดีไลน์สำหรับส่งบิล" />
            </div>
            <div class="form-group">
              <label>ทะเบียนรถ (รถยนต์ / มอเตอร์ไซค์)</label>
              <input type="text" class="form-control" name="vehiclePlate" value="${escapeHtml(t.vehiclePlate)}" placeholder="เช่น กข 1234" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:12px;">
            <div class="form-group">
              <label>ที่อยู่ตามบัตรประชาชน / ทะเบียนบ้าน (แสดงในใบสัญญา)</label>
              <input type="text" class="form-control" name="permanentAddress" value="${escapeHtml(t.permanentAddress)}" placeholder="บ้านเลขที่ ตำบล อำเภอ จังหวัด" />
            </div>
            <div class="form-group">
              <label>บุคคลติดต่อฉุกเฉิน และเบอร์โทรศัพท์</label>
              <input type="text" class="form-control" name="emergencyContact" value="${escapeHtml(t.emergencyContact)}" placeholder="เช่น มารดา 081-xxx-xxxx" />
            </div>
          </div>
        </div>

        <!-- CARD 3: ระยะเวลาสัญญาและอัตราค่าเช่า -->
        <div style="background:#f0f9ff; border:1.5px solid #bae6fd; border-radius:12px; padding:14px 18px;">
          <div style="font-size:13.5px; font-weight:800; color:#0369a1; margin-bottom:10px;">
            📅 3. ระยะเวลาสัญญาเช่า & เงินประกัน
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">วันเริ่มสัญญาเช่า</label>
              <input type="date" class="form-control" name="contractStartDate" value="${t.contractStartDate}" style="background:#fff;" />
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">วันสิ้นสุดสัญญาเช่า</label>
              <input type="date" class="form-control" name="contractEndDate" value="${t.contractEndDate}" style="background:#fff;" />
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">ค่าเช่าตกลง (บาท/เดือน)</label>
              <input type="number" class="form-control" name="agreedRent" id="tf-agreedRent" value="${t.agreedRent}" style="background:#fff; font-weight:800; color:#1d4ed8; font-size:15px;" />
            </div>
            <div class="form-group">
              <label style="color:#0369a1; font-weight:700;">เงินประกัน / มัดจำ (บาท)</label>
              <input type="number" class="form-control" name="depositAmount" id="tf-depositAmount" value="${t.depositAmount}" style="background:#fff; font-weight:800; font-size:15px;" />
            </div>
          </div>
        </div>

        <!-- CARD 4: มิเตอร์ตั้งต้นและข้อตกลงพิเศษในสัญญา -->
        <div style="background:#fffbeb; border:1.5px solid #fde68a; border-radius:12px; padding:14px 18px;">
          <div style="font-size:13.5px; font-weight:800; color:#b45309; margin-bottom:10px;">
            💧⚡ 4. เลขมิเตอร์วันเข้าอยู่ & ข้อตกลงเพิ่มเติมท้ายสัญญา
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:10px;">
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;">💧 เลขมิเตอร์น้ำประปา (วันเข้าอยู่)</label>
              <input type="number" step="0.01" class="form-control" name="initialWaterMeter" id="tf-waterMeter" value="${t.initialWaterMeter}" style="background:#fff; font-weight:700;" />
            </div>
            <div class="form-group">
              <label style="color:#b45309; font-weight:700;">⚡ เลขมิเตอร์ไฟฟ้า (วันเข้าอยู่)</label>
              <input type="number" step="0.01" class="form-control" name="initialElectricMeter" id="tf-elecMeter" value="${t.initialElectricMeter}" style="background:#fff; font-weight:700;" />
            </div>
          </div>
          <div class="form-group">
            <label style="color:#b45309; font-weight:700;">📌 ข้อตกลงเพิ่มเติมเฉพาะสัญญานี้ (จะปรากฏในใบสัญญาเช่าด้วย)</label>
            <textarea class="form-control" name="notes" rows="2" style="background:#fff;" placeholder="เช่น อนุญาตให้จอดรถยนต์ได้ 1 คัน, ห้ามเลี้ยงสัตว์, มีกุญแจคีย์การ์ดให้ 2 ชุด">${escapeHtml(t.notes || '')}</textarea>
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      ${existing ? `<button class="btn btn-outline" style="color:#dc2626; border-color:#fecaca; margin-right:auto;" onclick="closeModal(); confirmDeleteTenant('${t.id}')">🗑️ ลบสัญญานี้</button>` : ''}
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-outline" style="border-color:#93c5fd; color:#1d4ed8; background:#eff6ff; font-weight:700;" onclick="saveTenantForm('${t.id || ''}', true)">📄 บันทึก & เปิดดู/แก้ไขใบสัญญาเช่า</button>
      <button class="btn btn-primary" onclick="saveTenantForm('${t.id || ''}', false)">💾 บันทึกข้อมูลผู้เช่า</button>
    `
  });
}

function onTenantUnitSelectChange(unitId) {
  const u = (appState.units || []).find(item => item.id === unitId);
  if (!u) return;
  const rentEl = document.getElementById('tf-agreedRent');
  const depEl = document.getElementById('tf-depositAmount');
  const wEl = document.getElementById('tf-waterMeter');
  const eEl = document.getElementById('tf-elecMeter');
  if (rentEl) rentEl.value = u.baseRent || 0;
  if (depEl) depEl.value = u.defaultDeposit || 0;
  if (wEl) wEl.value = u.lastWaterMeter || 0;
  if (eEl) eEl.value = u.lastElectricMeter || 0;
}

async function saveTenantForm(existingId, openContractAfter = false) {
  const form = document.getElementById('tenant-form');
  const fd = new FormData(form);
  const fullName = (fd.get('fullName') || '').trim();
  if (!fullName) {
    showToast('กรุณากรอกชื่อ-นามสกุลผู้เช่า', 'error');
    return;
  }

  const unitId = fd.get('unitId');
  const payload = {
    id: existingId || undefined,
    unitId,
    fullName,
    idCard: fd.get('idCard'),
    phone: fd.get('phone'),
    lineId: fd.get('lineId'),
    vehiclePlate: fd.get('vehiclePlate'),
    occupantCount: Number(fd.get('occupantCount') || 1),
    permanentAddress: fd.get('permanentAddress'),
    emergencyContact: fd.get('emergencyContact'),
    contractStartDate: fd.get('contractStartDate'),
    contractEndDate: fd.get('contractEndDate'),
    agreedRent: Number(fd.get('agreedRent') || 0),
    depositAmount: Number(fd.get('depositAmount') || 0),
    initialWaterMeter: Number(fd.get('initialWaterMeter') || 0),
    initialElectricMeter: Number(fd.get('initialElectricMeter') || 0),
    status: fd.get('status'),
    notes: fd.get('notes'),
    customContractHtml: '' // Refresh contract sheet with updated info
  };

  await apiPost('/api/tenants', payload);
  renderCurrentTab();
  showToast(`บันทึกข้อมูลสัญญาเช่าของ ${fullName} เรียบร้อยแล้ว`);

  if (openContractAfter) {
    const saved = (appState.tenants || []).find(t => (existingId && t.id === existingId) || (t.unitId === unitId && t.fullName === fullName));
    openContractPreviewModal(saved ? saved.id : null, unitId);
  } else {
    closeModal();
  }
}

function openMoveOutModal(tenantId) {
  const t = (appState.tenants || []).find(x => x.id === tenantId);
  if (!t) return;
  const u = (appState.units || []).find(x => x.id === t.unitId) || {};
  const today = new Date().toISOString().slice(0, 10);

  showModal({
    title: `แจ้งย้ายออก & คำนวณคืนเงินประกัน: ${t.fullName} (${u.code || ''})`,
    bodyHtml: `
      <form id="moveout-form" class="form-grid">
        <div class="form-group">
          <label>วันที่ย้ายออก</label>
          <input type="date" class="form-control" id="mo-date" value="${today}" />
        </div>
        <div class="form-group">
          <label>เงินประกันที่วางไว้ (บาท)</label>
          <input type="number" class="form-control" id="mo-deposit" value="${t.depositAmount || 0}" oninput="recalcMoveOut()" />
        </div>
        <div class="form-group">
          <label>หักค่าน้ำ-ค่าไฟค้างชำระ (บาท)</label>
          <input type="number" class="form-control" id="mo-utility" value="0" oninput="recalcMoveOut()" />
        </div>
        <div class="form-group">
          <label>หักค่าทำความสะอาด / ค่าซ่อมแซมความเสียหาย (บาท)</label>
          <input type="number" class="form-control" id="mo-damage" value="0" oninput="recalcMoveOut()" />
        </div>
        <div class="form-group">
          <label>สถานะบ้าน/ห้องหลังย้ายออก</label>
          <select class="form-control" id="mo-unit-status">
            <option value="available">ว่างพร้อมเช่าทันที</option>
            <option value="maintenance">ปิดปรับปรุง/ทำความสะอาดก่อน</option>
          </select>
        </div>
        <div class="form-group">
          <label>สรุปยอดเงินประกันคืนสุทธิ (บาท)</label>
          <input type="text" class="form-control" id="mo-net-refund" value="${formatMoney(t.depositAmount || 0)}" readonly style="font-weight:800; color:#16a34a; background:#f0fdf4;" />
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-warning" onclick="confirmMoveOut('${t.id}')">✓ ยืนยันการย้ายออก</button>
    `
  });
}

function recalcMoveOut() {
  const dep = Number(document.getElementById('mo-deposit').value || 0);
  const util = Number(document.getElementById('mo-utility').value || 0);
  const dmg = Number(document.getElementById('mo-damage').value || 0);
  const net = dep - util - dmg;
  const el = document.getElementById('mo-net-refund');
  el.value = (net >= 0 ? 'คืนผู้เช่า ฿' : 'ผู้เช่าชำระเพิ่ม ฿') + formatMoney(Math.abs(net));
}

async function confirmMoveOut(tenantId) {
  const moveOutDate = document.getElementById('mo-date').value;
  const newUnitStatus = document.getElementById('mo-unit-status').value;
  const dep = Number(document.getElementById('mo-deposit').value || 0);
  const util = Number(document.getElementById('mo-utility').value || 0);
  const dmg = Number(document.getElementById('mo-damage').value || 0);

  await apiPost('/api/tenants/move-out', {
    tenantId,
    moveOutDate,
    newUnitStatus,
    moveOutSummary: { deposit: dep, utilityDeduct: util, damageDeduct: dmg, netRefund: dep - util - dmg }
  });
  closeModal();
  renderCurrentTab();
  showToast('บันทึกการย้ายออกและอัปเดตสถานะบ้าน/ห้องเรียบร้อยแล้ว');
}

async function confirmDeleteTenant(tenantId) {
  if (!confirm('ยืนยันการลบประวัติผู้เช่ารายนี้?')) return;
  await apiPost('/api/tenants/delete', { id: tenantId });
  renderCurrentTab();
  showToast('ลบข้อมูลผู้เช่าแล้ว');
}

// ----------------------------------------------------------------------------
// TAB 4: METER READING & MONTHLY BILL CALCULATION
// ----------------------------------------------------------------------------
function renderMeterTab(container) {
  const s = appState.settings || {};
  const occupiedUnits = filterByCategory(
    (appState.units || []).filter(u => u.status === 'occupied'),
    u => u.category
  ).filter(u => {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    return selectedZoneFilter === 'all' || zName === selectedZoneFilter;
  });

  const issueDateDefault = `${selectedBillingMonth}-01`;
  const dueDay = String(s.defaultDueDay || 5).padStart(2, '0');
  const dueDateDefault = `${selectedBillingMonth}-${dueDay}`;

  let rowsHtml = '';
  let lastZone = null;
  occupiedUnits.forEach((u, idx) => {
    const zName = u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า');
    if (zName !== lastZone) {
      lastZone = zName;
      const theme = getZoneTheme(zName);
      const zCount = occupiedUnits.filter(x => (x.zone || (x.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า')) === zName).length;
      rowsHtml += `
        <tr style="background:${theme.bg}; border-top:2px solid ${theme.border};">
          <td colspan="7" style="padding:9px 14px; font-weight:800; color:${theme.text}; font-size:13.5px;">
            🏢 อาคาร / โซน: ${escapeHtml(zName)} <span class="badge" style="background:${theme.border}; color:#fff; margin-left:6px;">${zCount} ห้องที่มีผู้เช่า</span>
          </td>
        </tr>
      `;
    }

    const tenant = (appState.tenants || []).find(t => t.unitId === u.id && t.status === 'active') || {};
    const existingInv = (appState.invoices || []).find(
      i => i.unitId === u.id && i.billingMonth === selectedBillingMonth
    );

    const rent = existingInv ? existingInv.rentAmount : (tenant.agreedRent || u.baseRent || 0);
    const wPrev = existingInv ? existingInv.waterPrevMeter : (u.lastWaterMeter || 0);

    // Check if water reading was explicitly entered in this month (or clear for new month)
    const hasExistingWater = existingInv && (
      existingInv.waterEntered === true ||
      (existingInv.waterCurrMeter !== undefined && existingInv.waterCurrMeter !== null && existingInv.waterCurrMeter !== existingInv.waterPrevMeter) ||
      Number(existingInv.waterAmount || 0) > 0
    );
    const wCurr = hasExistingWater ? existingInv.waterCurrMeter : '';
    const wRate = u.customWaterRate !== undefined && u.customWaterRate !== '' ? Number(u.customWaterRate) : Number(s.waterRate || 18);

    const ePrev = existingInv ? existingInv.electricPrevMeter : (u.lastElectricMeter || 0);

    // Check if electric reading was explicitly entered in this month (or clear for new month)
    const hasExistingElec = existingInv && (
      existingInv.electricEntered === true ||
      (existingInv.electricCurrMeter !== undefined && existingInv.electricCurrMeter !== null && existingInv.electricCurrMeter !== existingInv.electricPrevMeter) ||
      Number(existingInv.electricAmount || 0) > 0
    );
    const eCurr = hasExistingElec ? existingInv.electricCurrMeter : '';
    const eRate = u.customElectricRate !== undefined && u.customElectricRate !== '' ? Number(u.customElectricRate) : Number(s.electricRate || 8);

    const commonFee = existingInv ? existingInv.commonFee : Number(u.commonFee || 0);
    const otherFee = existingInv ? existingInv.otherFee : Number(u.otherFixedFee || 0);

    const isWaterActual = u.waterBillingType === 'actual_bill';
    const isElecActual = u.electricBillingType === 'actual_bill';
    const isWaterDirect = u.waterBillingType === 'direct';
    const isElecDirect = u.electricBillingType === 'direct';

    const wMin = Number(s.waterMinCharge || 0);
    const eMin = Number(s.electricMinCharge || 0);

    let defaultWAmt = 0;
    if (isWaterDirect) defaultWAmt = 0;
    else if (existingInv && hasExistingWater) defaultWAmt = existingInv.waterAmount;
    else if (u.waterBillingType === 'meter') {
      if (wCurr === '') {
        defaultWAmt = 0;
      } else {
        const raw = Math.max(0, (Number(wCurr) - wPrev) * wRate);
        defaultWAmt = (wMin > 0 && raw < wMin) ? wMin : raw;
      }
    } else if (u.waterBillingType === 'flat') defaultWAmt = wRate;

    let defaultEAmt = 0;
    if (isElecDirect) defaultEAmt = 0;
    else if (existingInv && hasExistingElec) defaultEAmt = existingInv.electricAmount;
    else if (u.electricBillingType === 'meter') {
      if (eCurr === '') {
        defaultEAmt = 0;
      } else {
        const raw = Math.max(0, (Number(eCurr) - ePrev) * eRate);
        defaultEAmt = (eMin > 0 && raw < eMin) ? eMin : raw;
      }
    } else if (u.electricBillingType === 'flat') defaultEAmt = eRate;

    rowsHtml += `
      <tr class="meter-row" data-unit-id="${u.id}" data-unit-code="${escapeHtml(u.code)}" data-water-type="${u.waterBillingType}" data-elec-type="${u.electricBillingType}" data-water-rate="${wRate}" data-elec-rate="${eRate}" data-w-rollover="${existingInv?.waterRollover ? '1' : '0'}" data-e-rollover="${existingInv?.electricRollover ? '1' : '0'}">
        <td>
          <div><strong>${escapeHtml(u.code)}</strong> ${u.category === 'house' ? '<span class="badge badge-house">บ้านเช่า</span>' : '<span class="badge badge-room">ห้องเช่า</span>'}</div>
          <div style="font-size:12px; color:var(--text-muted)">${escapeHtml(tenant.fullName || '-')}</div>
          ${existingInv ? `<div style="margin-top:2px;">${getInvoiceStatusBadge(existingInv.status)} ${existingInv.invoiceNo ? `<span style="font-size:10.5px; color:#64748b;">(${escapeHtml(existingInv.invoiceNo)})</span>` : ''}</div>` : ''}
        </td>
        <td class="text-right">
          <input type="number" class="form-control meter-input row-rent" value="${rent}" oninput="recalcMeterRow(this)" />
        </td>
        <td class="meter-cell-water">
          <div style="display:flex; align-items:center; gap:5px;">
            <div>
              <div class="meter-label-prev"><span class="meter-tag-prev">⏮️ ครั้งก่อน</span></div>
              <input type="number" class="form-control meter-input meter-box-prev row-w-prev" value="${wPrev}" ${isWaterDirect ? 'readonly' : ''} oninput="recalcMeterRow(this)" title="เลขมิเตอร์น้ำรอบก่อนหน้า" />
            </div>
            <div>
              <div class="meter-label-curr-water"><span class="meter-tag-curr-water">✏️ ครั้งนี้</span></div>
              <input type="number" class="form-control meter-input meter-box-curr-water row-w-curr" value="${wCurr}" placeholder="กรอกเลข" ${isWaterDirect ? 'readonly' : ''} oninput="recalcMeterRow(this)" onkeydown="handleMeterKeyDown(event, this)" onfocus="this.select()" title="กรอกเลขมิเตอร์น้ำรอบใหม่" />
            </div>
            <div>
              <div style="font-size:10.5px; color:#64748b; margin-bottom:2px;">${isWaterDirect ? 'จ่ายตรงประปา' : isWaterActual ? 'ยอดบิลประปา (฿)' : `รวมน้ำ (@${wRate}${wMin > 0 ? ` ขั้นต่ำ ฿${wMin}` : ''})`}</div>
              <input type="number" class="form-control meter-input row-w-amt" value="${defaultWAmt}" ${isWaterActual ? '' : 'readonly'} oninput="recalcMeterRowTotal(this)" style="background:${isWaterActual ? '#fff' : '#f8fafc'}; font-weight:800; color:#0369a1;" />
            </div>
          </div>
          <div class="row-w-diff" style="font-size:11px; margin-top:3px; font-weight:700; min-height:16px;"></div>
        </td>
        <td class="meter-cell-elec">
          <div style="display:flex; align-items:center; gap:5px;">
            <div>
              <div class="meter-label-prev"><span class="meter-tag-prev">⏮️ ครั้งก่อน</span></div>
              <input type="number" class="form-control meter-input meter-box-prev row-e-prev" value="${ePrev}" ${isElecDirect ? 'readonly' : ''} oninput="recalcMeterRow(this)" title="เลขมิเตอร์ไฟรอบก่อนหน้า" />
            </div>
            <div>
              <div class="meter-label-curr-elec"><span class="meter-tag-curr-elec">✏️ ครั้งนี้</span></div>
              <input type="number" class="form-control meter-input meter-box-curr-elec row-e-curr" value="${eCurr}" placeholder="กรอกเลข" ${isElecDirect ? 'readonly' : ''} oninput="recalcMeterRow(this)" onkeydown="handleMeterKeyDown(event, this)" onfocus="this.select()" title="กรอกเลขมิเตอร์ไฟรอบใหม่" />
            </div>
            <div>
              <div style="font-size:10.5px; color:#64748b; margin-bottom:2px;">${isElecDirect ? 'จ่ายตรงการไฟฟ้า' : isElecActual ? 'ยอดบิลไฟฟ้า (฿)' : `รวมไฟ (@${eRate}${eMin > 0 ? ` ขั้นต่ำ ฿${eMin}` : ''})`}</div>
              <input type="number" class="form-control meter-input row-e-amt" value="${defaultEAmt}" ${isElecActual ? '' : 'readonly'} oninput="recalcMeterRowTotal(this)" style="background:${isElecActual ? '#fff' : '#f8fafc'}; font-weight:800; color:#b45309;" />
            </div>
          </div>
          <div class="row-e-diff" style="font-size:11px; margin-top:3px; font-weight:700; min-height:16px;"></div>
        </td>
        <td class="text-right">
          <input type="number" class="form-control meter-input row-common" value="${commonFee + otherFee}" oninput="recalcMeterRow(this)" />
        </td>
        <td class="text-right">
          <strong class="row-total-display" style="font-size:15px; color:var(--primary)">฿0</strong>
        </td>
        <td class="text-right">
          <div style="display:flex; gap:5px; justify-content:flex-end;">
            <button class="btn btn-sm btn-outline" style="padding:4px 8px; font-size:12px; font-weight:600;" onclick="saveSingleMeterDraft(this)" title="บันทึกข้อมูลมิเตอร์ห้องนี้ไว้ก่อนโดยยังไม่ออกบิล">💾 บันทึก</button>
            <button class="btn btn-sm btn-primary" style="padding:4px 8px; font-size:12px;" onclick="saveSingleMeterRow(this)" title="บันทึกและดูใบแจ้งหนี้ A5 ทันที">📄 ออกบิล A5</button>
          </div>
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    ${renderZoneSelectorBar()}
    <div class="card">
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <div class="card-title">⚡ ตารางจดมิเตอร์ & คำนวณบิลประจำเดือน</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="font-size:13px; font-weight:600;">รอบเดือน:</label>
            <input type="month" class="form-control" value="${selectedBillingMonth}" onchange="if (hasUnsavedMeterChanges && !confirm('มีข้อมูลมิเตอร์ที่ยังไม่ได้บันทึก ต้องการเปลี่ยนเดือนโดยไม่บันทึกใช่หรือไม่?')) { this.value = selectedBillingMonth; return; } hasUnsavedMeterChanges = false; selectedBillingMonth=this.value; renderCurrentTab();" />
            <label style="font-size:13px; font-weight:600;">วันที่ออกบิล:</label>
            <input type="date" class="form-control" id="batch-issue-date" value="${issueDateDefault}" />
            <label style="font-size:13px; font-weight:600;">ครบกำหนดชำระ:</label>
            <input type="date" class="form-control" id="batch-due-date" value="${dueDateDefault}" />
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="exportMeterSheetExcel()" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:700;" title="ส่งออกตารางใบจดมิเตอร์ (มีเลขครั้งก่อน + ช่องว่างสำหรับกรอกเลขใหม่) เป็นไฟล์ Excel">📥 Export ใบจดมิเตอร์ (Excel)</button>
          <button class="btn btn-outline" onclick="printMeterSheetA4()" style="background:#f8fafc; border-color:#cbd5e1; color:#0f172a; font-weight:700;" title="พิมพ์ใบจดมิเตอร์ขนาด A4 ถือไปเดินจดหน้าห้อง">🖨️ พิมพ์ใบจดมิเตอร์ (A4)</button>
          <button class="btn btn-outline" onclick="triggerImportMeterSheet()" style="background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:700;" title="นำเข้าเลขมิเตอร์ที่กรอกในไฟล์ Excel (.xls / .csv) กลับเข้าตารางอัตโนมัติ">📤 นำเข้าจาก Excel/CSV</button>
          <input type="file" id="meter-sheet-import-input" accept=".xls,.xml,.csv,.txt" style="display:none" onchange="onMeterSheetFileSelected(this)" />
          <button class="btn btn-outline" onclick="clearCurrentMonthMeterInputs()" style="background:#ffffff; border-color:#cbd5e1; color:#dc2626; font-weight:700;" title="เคลียร์ตัวเลขในช่อง 'ครั้งนี้' ทั้งหมดเพื่อให้เริ่มลงมิเตอร์รอบใหม่ได้ทันที">🧹 เคลียร์ช่อง 'ครั้งนี้' (เริ่มลงใหม่)</button>
          <button class="btn btn-primary" onclick="saveMeterProgressDraft()" style="background:#2563eb; color:#fff; border-color:#1d4ed8; font-weight:700;">💾 บันทึกความคืบหน้า (ไว้มาลงต่อ)</button>
          <button class="btn btn-success" onclick="saveAllMeterRows()">🚀 บันทึกและสร้างใบแจ้งหนี้ A5 ทั้งหมด (${occupiedUnits.length} ยูนิต)</button>
        </div>
      </div>

      <!-- Meter Progress & Filter Bar -->
      <div id="meter-progress-bar-wrap" style="padding:10px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:240px;">
          <div id="meter-progress-text" style="font-size:13px; font-weight:700; color:#0f172a; white-space:nowrap;">📊 จดแล้ว 0 / ${occupiedUnits.length} ห้อง</div>
          <div style="flex:1; max-width:260px; height:9px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
            <div id="meter-progress-fill" style="height:100%; width:0%; background:#16a34a; transition:width 0.2s;"></div>
          </div>
          <span id="meter-unsaved-badge" style="display:none; font-size:11.5px; font-weight:700; color:#b45309; background:#fef3c7; padding:2px 8px; border-radius:999px;">● มีข้อมูลที่ยังไม่ได้บันทึก</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${meterProgressFilter === 'all' ? 'btn-primary' : 'btn-outline'}" id="btn-mf-all" onclick="setMeterProgressFilter('all')">ทั้งหมด (<span id="mf-cnt-all">${occupiedUnits.length}</span>)</button>
          <button type="button" class="btn btn-sm ${meterProgressFilter === 'pending' ? 'btn-primary' : 'btn-outline'}" id="btn-mf-pending" onclick="setMeterProgressFilter('pending')">⏳ ยังไม่ได้จด (<span id="mf-cnt-pending">0</span>)</button>
          <button type="button" class="btn btn-sm ${meterProgressFilter === 'done' ? 'btn-primary' : 'btn-outline'}" id="btn-mf-done" onclick="setMeterProgressFilter('done')">✅ จดแล้ว (<span id="mf-cnt-done">0</span>)</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>บ้านเช่า / ห้องเช่า & ผู้เช่า</th>
              <th class="text-right">ค่าเช่า (฿)</th>
              <th>💧 มิเตอร์น้ำประปา (ครั้งก่อน → ครั้งนี้ = บาท)</th>
              <th>⚡ มิเตอร์ไฟฟ้า (ครั้งก่อน → ครั้งนี้ = บาท)</th>
              <th class="text-right">ส่วนกลาง/อื่นๆ</th>
              <th class="text-right">ยอดรวมสุทธิ</th>
              <th class="text-right">บันทึกรายยูนิต</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="7" class="text-center" style="padding:32px; color:var(--text-muted)">ไม่มีบ้านเช่าหรือห้องเช่าที่มีผู้เช่าอยู่ในขณะนี้</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  hasUnsavedMeterChanges = false;
  document.querySelectorAll('.meter-row').forEach(tr => {
    const input = tr.querySelector('.row-rent');
    if (input) recalcMeterRow(input, true);
  });
  updateMeterProgressSummary();
}

function handleMeterKeyDown(event, inputEl) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const tr = inputEl.closest('.meter-row');
    if (!tr) return;
    if (inputEl.classList.contains('row-w-curr')) {
      const nextInput = tr.querySelector('.row-e-curr');
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    } else if (inputEl.classList.contains('row-e-curr')) {
      let curr = tr.nextElementSibling;
      while (curr) {
        if (curr.classList.contains('meter-row')) {
          const nextInput = curr.querySelector('.row-w-curr');
          if (nextInput) {
            nextInput.focus();
            nextInput.select();
            break;
          }
        }
        curr = curr.nextElementSibling;
      }
    }
  }
}

function clearCurrentMonthMeterInputs() {
  if (!confirm('ยืนยันเคลียร์ตัวเลขในช่อง "ครั้งนี้" ของทุกห้อง เพื่อเริ่มต้นจดมิเตอร์รอบใหม่ ใช่หรือไม่?')) {
    return;
  }
  document.querySelectorAll('.meter-row').forEach(tr => {
    tr.dataset.wRollover = '0';
    tr.dataset.eRollover = '0';
    const wCurr = tr.querySelector('.row-w-curr');
    const eCurr = tr.querySelector('.row-e-curr');
    if (wCurr && !wCurr.readOnly) wCurr.value = '';
    if (eCurr && !eCurr.readOnly) eCurr.value = '';
    const inputRent = tr.querySelector('.row-rent');
    if (inputRent) recalcMeterRow(inputRent, true);
  });
  hasUnsavedMeterChanges = true;
  updateMeterProgressSummary();
  showToast('🧹 เคลียร์ช่องมิเตอร์ "ครั้งนี้" เรียบร้อยแล้ว พร้อมลงข้อมูลรอบใหม่');
}

function getNextBillingMonthStr(ym) {
  const parts = String(ym || new Date().toISOString().slice(0, 7)).split('-').map(n => parseInt(n, 10));
  let y = parts[0] || new Date().getFullYear();
  let m = (parts[1] || 1) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getMeterSheetRowsData() {
  const rows = Array.from(document.querySelectorAll('.meter-row'));
  // Check if selectedBillingMonth already has finalized (non-draft) invoices
  const finalizedInMonth = rows.filter(tr => {
    const uid = tr.dataset.unitId;
    return (appState.invoices || []).some(i => i.unitId === uid && i.billingMonth === selectedBillingMonth && i.status !== 'draft');
  }).length;
  const isCompletedMonth = rows.length > 0 && finalizedInMonth >= Math.ceil(rows.length * 0.5);
  const sheetMonth = isCompletedMonth ? getNextBillingMonthStr(selectedBillingMonth) : selectedBillingMonth;

  const items = rows.map((tr, idx) => {
    const unitId = tr.dataset.unitId;
    const u = (appState.units || []).find(x => x.id === unitId) || {};
    const tenant = (appState.tenants || []).find(t => t.unitId === unitId && t.status === 'active') || {};
    const curWVal = (tr.querySelector('.row-w-curr')?.value || '').trim();
    const curEVal = (tr.querySelector('.row-e-curr')?.value || '').trim();

    // If current view is an already-billed month, carry its ending reading (or unit.lastWaterMeter) forward as "ครั้งก่อน" for next month
    const wPrev = isCompletedMonth
      ? (curWVal !== '' ? Number(curWVal) : Number(u.lastWaterMeter || tr.querySelector('.row-w-prev')?.value || 0))
      : Number(tr.querySelector('.row-w-prev')?.value || u.lastWaterMeter || 0);
    const ePrev = isCompletedMonth
      ? (curEVal !== '' ? Number(curEVal) : Number(u.lastElectricMeter || tr.querySelector('.row-e-prev')?.value || 0))
      : Number(tr.querySelector('.row-e-prev')?.value || u.lastElectricMeter || 0);

    return {
      index: idx + 1,
      zone: u.zone || (u.category === 'house' ? 'โซนบ้านเช่า' : 'อาคารห้องเช่า'),
      code: u.code || tr.dataset.unitCode || '',
      tenantName: tenant.fullName || '-',
      waterType: tr.dataset.waterType || 'meter',
      elecType: tr.dataset.elecType || 'meter',
      wPrev,
      wCurr: '', // Always blank on meter-reading sheet so reader can write/type new readings
      ePrev,
      eCurr: ''  // Always blank on meter-reading sheet so reader can write/type new readings
    };
  });

  return { items, sheetMonth, isCompletedMonth };
}

function sanitizeExcelSheetName(name, usedNames) {
  let clean = String(name || 'Sheet')
    .replace(/[:\\/?*\[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || 'ตึก';
  let candidate = clean;
  let n = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${clean.slice(0, 25)} ${n++}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function exportMeterSheetExcel() {
  const { items, sheetMonth } = getMeterSheetRowsData();
  if (items.length === 0) {
    showToast('ไม่มีรายการห้องเช่าสำหรับส่งออกใบจดมิเตอร์', 'error');
    return;
  }
  const s = appState.settings || {};
  const monthLabel = formatMonthThai(sheetMonth);

  // Group items by building / zone
  const zoneOrder = [];
  const zoneMap = {};
  for (const r of items) {
    if (!zoneMap[r.zone]) {
      zoneMap[r.zone] = [];
      zoneOrder.push(r.zone);
    }
    zoneMap[r.zone].push(r);
  }

  const colDefs = `
      <Column ss:Width="38"/>
      <Column ss:Width="135"/>
      <Column ss:Width="74"/>
      <Column ss:Width="130"/>
      <Column ss:Width="84"/>
      <Column ss:Width="108"/>
      <Column ss:Width="84"/>
      <Column ss:Width="108"/>
      <Column ss:Width="120"/>`;

  const tableHeaderRow = `
    <Row ss:Height="25">
      <Cell ss:StyleID="Header"><Data ss:Type="String">ลำดับ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">อาคาร / โซน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">เลขห้อง</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ชื่อผู้เช่า</Data></Cell>
      <Cell ss:StyleID="HeaderPrev"><Data ss:Type="String">น้ำครั้งก่อน</Data></Cell>
      <Cell ss:StyleID="HeaderWater"><Data ss:Type="String">น้ำครั้งนี้ (กรอกเลข)</Data></Cell>
      <Cell ss:StyleID="HeaderPrev"><Data ss:Type="String">ไฟครั้งก่อน</Data></Cell>
      <Cell ss:StyleID="HeaderElec"><Data ss:Type="String">ไฟครั้งนี้ (กรอกเลข)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หมายเหตุ</Data></Cell>
    </Row>`;

  const buildDataRowsXml = (list, resetIdx = false) => {
    let xml = '';
    list.forEach((r, i) => {
      const alt = i % 2 === 1;
      const stTxt = alt ? 'CellTextAlt' : 'CellText';
      const stCen = alt ? 'CellCenterAlt' : 'CellCenter';
      const stBld = alt ? 'CellBoldAlt' : 'CellBold';
      const stPrv = alt ? 'CellPrevAlt' : 'CellPrev';
      const wCurrCell = r.waterType === 'direct'
        ? `<Cell ss:StyleID="CellMuted"><Data ss:Type="String">จ่ายตรงประปา</Data></Cell>`
        : `<Cell ss:StyleID="CellInputWater"><Data ss:Type="String"></Data></Cell>`;
      const eCurrCell = r.elecType === 'direct'
        ? `<Cell ss:StyleID="CellMuted"><Data ss:Type="String">จ่ายตรงไฟฟ้า</Data></Cell>`
        : `<Cell ss:StyleID="CellInputElec"><Data ss:Type="String"></Data></Cell>`;
      xml += `
      <Row ss:Height="23">
        <Cell ss:StyleID="${stCen}"><Data ss:Type="Number">${resetIdx ? i + 1 : r.index}</Data></Cell>
        <Cell ss:StyleID="${stTxt}"><Data ss:Type="String">${xmlEscape(r.zone)}</Data></Cell>
        <Cell ss:StyleID="${stBld}"><Data ss:Type="String">${xmlEscape(r.code)}</Data></Cell>
        <Cell ss:StyleID="${stTxt}"><Data ss:Type="String">${xmlEscape(r.tenantName)}</Data></Cell>
        <Cell ss:StyleID="${stPrv}"><Data ss:Type="Number">${r.wPrev}</Data></Cell>
        ${wCurrCell}
        <Cell ss:StyleID="${stPrv}"><Data ss:Type="Number">${r.ePrev}</Data></Cell>
        ${eCurrCell}
        <Cell ss:StyleID="${stTxt}"><Data ss:Type="String"></Data></Cell>
      </Row>`;
    });
    return xml;
  };

  // Sheet 1: Combined sheet with crisp framed building sections
  let combinedRowsXml = `
    <Row ss:Height="28">
      <Cell ss:MergeAcross="8" ss:StyleID="Title"><Data ss:Type="String">ใบจดมิเตอร์น้ำ-ไฟ ประจำเดือน ${xmlEscape(monthLabel)} — ${xmlEscape(s.businessName || 'RentalPro')} (ทั้งหมด ${items.length} ยูนิต)</Data></Cell>
    </Row>
    <Row ss:Height="20">
      <Cell ss:MergeAcross="8" ss:StyleID="SubTitle"><Data ss:Type="String">คำแนะนำ: กรอกเลขมิเตอร์ใหม่ลงในช่อง "น้ำครั้งนี้" และ "ไฟครั้งนี้" (ห้ามแก้เลขห้อง) | สามารถเลือกแท็บด้านล่างเพื่อพิมพ์แยกทีละตึกได้</Data></Cell>
    </Row>
    ${tableHeaderRow}`;

  zoneOrder.forEach((zName, zIdx) => {
    const zList = zoneMap[zName];
    if (zIdx > 0) {
      combinedRowsXml += `<Row ss:Height="10"></Row>`;
    }
    combinedRowsXml += `
    <Row ss:Height="24">
      <Cell ss:MergeAcross="8" ss:StyleID="ZoneBanner"><Data ss:Type="String">🏢 อาคาร / โซน: ${xmlEscape(zName)} (${zList.length} ห้อง)</Data></Cell>
    </Row>
    ${buildDataRowsXml(zList, false)}`;
  });

  const wsOptionsXml = `
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <PageSetup>
        <Layout x:Orientation="Portrait"/>
        <PageMargins x:Bottom="0.4" x:Left="0.35" x:Right="0.35" x:Top="0.4"/>
      </PageSetup>
      <FitToPage/>
      <Print>
        <ValidPrinterInfo/>
        <PaperSizeIndex>9</PaperSizeIndex>
        <FitWidth>1</FitWidth>
        <FitHeight>0</FitHeight>
      </Print>
    </WorksheetOptions>`;

  const usedSheetNames = new Set(['รวมทุกตึก']);
  let extraSheetsXml = '';
  if (zoneOrder.length > 1) {
    for (const zName of zoneOrder) {
      const zList = zoneMap[zName];
      const safeName = sanitizeExcelSheetName(zName, usedSheetNames);
      const zRowsXml = `
    <Row ss:Height="28">
      <Cell ss:MergeAcross="8" ss:StyleID="Title"><Data ss:Type="String">ใบจดมิเตอร์น้ำ-ไฟ: ${xmlEscape(zName)} (${zList.length} ห้อง) — เดือน ${xmlEscape(monthLabel)}</Data></Cell>
    </Row>
    <Row ss:Height="20">
      <Cell ss:MergeAcross="8" ss:StyleID="SubTitle"><Data ss:Type="String">${xmlEscape(s.businessName || 'RentalPro')} | ผู้จดมิเตอร์: ________________________   วันที่จด: ____ / ____ / ________</Data></Cell>
    </Row>
    ${tableHeaderRow}
    ${buildDataRowsXml(zList, true)}`;
      extraSheetsXml += `
  <Worksheet ss:Name="${xmlEscape(safeName)}">
    <Table>${colDefs}
      ${zRowsXml}
    </Table>
    ${wsOptionsXml}
  </Worksheet>`;
    }
  }

  const bAll = `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#475569"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#475569"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#475569"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#475569"/></Borders>`;
  const bWater = `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0284C7"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0284C7"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0284C7"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0284C7"/></Borders>`;
  const bElec = `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D97706"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D97706"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#D97706"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#D97706"/></Borders>`;
  const bZone = `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1E3A8A"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1E3A8A"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1E3A8A"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1E3A8A"/></Borders>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Tahoma" ss:Size="10"/></Style>
    <Style ss:ID="Title"><Font ss:FontName="Tahoma" ss:Size="13" ss:Bold="1" ss:Color="#0F172A"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="SubTitle"><Font ss:FontName="Tahoma" ss:Size="9.5" ss:Color="#475569"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="ZoneBanner"><Font ss:FontName="Tahoma" ss:Size="10.5" ss:Bold="1" ss:Color="#1E3A8A"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${bZone}</Style>
    <Style ss:ID="Header"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1E293B" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="HeaderPrev"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#1E293B"/><Interior ss:Color="#CBD5E1" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="HeaderWater"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0284C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="HeaderElec"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#D97706" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellText"><Alignment ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellTextAlt"><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellBold"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellBoldAlt"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellCenter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellCenterAlt"><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
    <Style ss:ID="CellPrev"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#334155"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${bAll}</Style>
    <Style ss:ID="CellPrevAlt"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#334155"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${bAll}</Style>
    <Style ss:ID="CellInputWater"><Font ss:FontName="Tahoma" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${bWater}</Style>
    <Style ss:ID="CellInputElec"><Font ss:FontName="Tahoma" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${bElec}</Style>
    <Style ss:ID="CellMuted"><Font ss:FontName="Tahoma" ss:Size="9.5" ss:Color="#94A3B8"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bAll}</Style>
  </Styles>
  <Worksheet ss:Name="รวมทุกตึก">
    <Table>${colDefs}
      ${combinedRowsXml}
    </Table>
    ${wsOptionsXml}
  </Worksheet>
  ${extraSheetsXml}
</Workbook>`;

  const blob = new Blob(['\uFEFF' + workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ใบจดมิเตอร์-${sheetMonth}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📥 ส่งออกไฟล์ Excel ใบจดมิเตอร์เดือน ${monthLabel} แยกตึก + ตีกรอบเรียบร้อยแล้ว (${zoneOrder.length} ตึก, ${items.length} ห้อง)`);
}

function printMeterSheetA4() {
  const { items, sheetMonth } = getMeterSheetRowsData();
  if (items.length === 0) {
    showToast('ไม่มีรายการห้องเช่าสำหรับพิมพ์ใบจดมิเตอร์', 'error');
    return;
  }
  const s = appState.settings || {};
  const monthLabel = formatMonthThai(sheetMonth);

  // Group by building so each building gets its own clean framed table
  const zoneOrder = [];
  const zoneMap = {};
  for (const r of items) {
    if (!zoneMap[r.zone]) {
      zoneMap[r.zone] = [];
      zoneOrder.push(r.zone);
    }
    zoneMap[r.zone].push(r);
  }

  let buildingsHtml = '';
  zoneOrder.forEach((zName, zIdx) => {
    const zList = zoneMap[zName];
    const rowsHtml = zList.map((r, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="c">${i + 1}</td>
        <td class="c b">${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.tenantName)}</td>
        <td class="r prev">${r.waterType === 'direct' ? '-' : r.wPrev}</td>
        <td class="r curr-w">${r.waterType === 'direct' ? '<span class="muted">จ่ายตรง</span>' : ''}</td>
        <td class="r prev">${r.elecType === 'direct' ? '-' : r.ePrev}</td>
        <td class="r curr-e">${r.elecType === 'direct' ? '<span class="muted">จ่ายตรง</span>' : ''}</td>
        <td></td>
      </tr>
    `).join('');

    buildingsHtml += `
      <div class="building-box ${zIdx > 0 ? 'can-break' : ''}">
        <div class="building-title">
          <span>🏢 อาคาร / โซน: ${escapeHtml(zName)}</span>
          <span class="building-count">จำนวน ${zList.length} ห้อง</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:32px;">#</th>
              <th style="width:68px;">ห้อง</th>
              <th>ชื่อผู้เช่า</th>
              <th class="th-prev">น้ำครั้งก่อน</th>
              <th class="th-w">💧 น้ำครั้งนี้</th>
              <th class="th-prev">ไฟครั้งก่อน</th>
              <th class="th-e">⚡ ไฟครั้งนี้</th>
              <th style="width:100px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  });

  const win = window.open('', '_blank', 'width=940,height=1000');
  if (!win) {
    showToast('กรุณาอนุญาต Pop-up เพื่อพิมพ์ใบจดมิเตอร์', 'error');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>ใบจดมิเตอร์น้ำ-ไฟ ประจำเดือน ${escapeHtml(monthLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; font-family: Tahoma, "Sarabun", sans-serif; }
    body { margin: 0; color: #0f172a; font-size: 12px; }
    .no-print { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
    .no-print label { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; cursor: pointer; }
    .no-print button { padding: 7px 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .header h1 { margin: 0; font-size: 17px; }
    .header .sub { font-size: 12px; color: #475569; margin-top: 2px; }
    .meta { text-align: right; font-size: 11.5px; line-height: 1.7; }
    .building-box { border: 2px solid #0f172a; border-radius: 6px; overflow: hidden; margin-bottom: 14px; break-inside: avoid; page-break-inside: avoid; }
    .building-title { display: flex; justify-content: space-between; align-items: center; background: #dbeafe; color: #1e3a8a; font-weight: 800; font-size: 13px; padding: 6px 10px; border-bottom: 2px solid #0f172a; }
    .building-count { font-size: 11.5px; background: #1e3a8a; color: #fff; padding: 2px 8px; border-radius: 999px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #475569; padding: 5px 7px; }
    thead th { background: #1e293b; color: #fff; font-size: 11px; text-align: center; }
    thead th.th-prev { background: #cbd5e1; color: #0f172a; }
    thead th.th-w { background: #0284c7; color: #fff; }
    thead th.th-e { background: #d97706; color: #fff; }
    tr.alt td { background: #f8fafc; }
    td.c { text-align: center; }
    td.r { text-align: right; }
    td.b { font-weight: 800; font-size: 12.5px; }
    td.prev { background: #f1f5f9 !important; color: #334155; font-weight: 700; width: 76px; }
    td.curr-w { background: #ffffff !important; width: 98px; height: 27px; border-left: 2px solid #0284c7; border-right: 2px solid #0284c7; }
    td.curr-e { background: #ffffff !important; width: 98px; height: 27px; border-left: 2px solid #d97706; border-right: 2px solid #d97706; }
    .muted { color: #94a3b8; font-size: 10px; }
    body.one-per-page .building-box.can-break { break-before: page; page-break-before: always; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <label>
      <input type="checkbox" onchange="document.body.classList.toggle('one-per-page', this.checked)" />
      📄 ขึ้นหน้าใหม่ทุกตึก (1 ตึก ต่อ 1 แผ่น A4)
    </label>
    <button onclick="window.print()">🖨️ สั่งพิมพ์ใบจดมิเตอร์ (A4)</button>
  </div>
  <div class="header">
    <div>
      <h1>ใบจดมิเตอร์น้ำประปา - ไฟฟ้า ประจำเดือน ${escapeHtml(monthLabel)}</h1>
      <div class="sub">${escapeHtml(s.businessName || 'RentalPro')} (${zoneOrder.length} อาคาร • ทั้งหมด ${items.length} ยูนิต)</div>
    </div>
    <div class="meta">
      <div>ผู้จดมิเตอร์: ________________________</div>
      <div>วันที่จด: ______ / ______ / ________</div>
    </div>
  </div>
  ${buildingsHtml}
</body>
</html>`);
  win.document.close();
}

function triggerImportMeterSheet() {
  const input = document.getElementById('meter-sheet-import-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

function parseCsvLineSimple(line, sep = ',') {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function onMeterSheetFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = String(e.target.result || '');
    // Detect binary .xlsx (PK zip header) or old binary .xls
    if (text.startsWith('PK\x03\x04') || text.includes('\x00\x00\x00')) {
      alert('ไฟล์นี้ถูกบันทึกเป็นรูปแบบไบนารี (.xlsx)\n\nกรุณาเปิดไฟล์ใน Excel แล้วเลือก Save As (บันทึกเป็น) -> เลือกชนิดไฟล์เป็น "CSV UTF-8 (.csv)" หรือ "XML Spreadsheet 2003 (.xml)" แล้วนำเข้าอีกครั้งครับ');
      return;
    }

    const matrix = [];
    const trimmed = text.replace(/^\uFEFF/, '').trim();

    if (trimmed.startsWith('<') && (trimmed.includes('<Workbook') || trimmed.includes('<Row'))) {
      // Parse Excel SpreadsheetML XML (.xls / .xml)
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/xml');
      const xmlRows = Array.from(doc.getElementsByTagName('Row'));
      for (const xr of xmlRows) {
        const cells = Array.from(xr.getElementsByTagName('Cell'));
        const rowArr = [];
        let colIdx = 0;
        for (const c of cells) {
          const idxAttr = c.getAttribute('ss:Index') || c.getAttribute('Index');
          if (idxAttr) {
            const target = parseInt(idxAttr, 10) - 1;
            while (colIdx < target) {
              rowArr.push('');
              colIdx++;
            }
          }
          const dataEl = c.getElementsByTagName('Data')[0];
          rowArr.push(dataEl ? String(dataEl.textContent || '').trim() : '');
          colIdx++;
        }
        if (rowArr.some(v => v !== '')) matrix.push(rowArr);
      }
    } else {
      // Parse CSV / TSV
      const lines = trimmed.split(/\r?\n/).filter(l => l.trim() !== '');
      const sep = (lines[0] && lines[0].includes('\t') && !lines[0].includes(',')) ? '\t' : ',';
      for (const line of lines) {
        matrix.push(parseCsvLineSimple(line, sep));
      }
    }

    // Locate header row & column indices
    let headerIdx = -1;
    let colRoom = -1;
    let colWater = -1;
    let colElec = -1;

    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
      const row = matrix[i].map(v => String(v || '').toLowerCase());
      const rIdx = row.findIndex(v => v.includes('เลขห้อง') || v === 'ห้อง' || v.includes('room') || v === 'code');
      if (rIdx >= 0) {
        headerIdx = i;
        colRoom = rIdx;
        colWater = row.findIndex(v => v.includes('น้ำครั้งนี้') || v.includes('น้ำ (หลัง)') || v.includes('water_curr'));
        colElec = row.findIndex(v => v.includes('ไฟครั้งนี้') || v.includes('ไฟ (หลัง)') || v.includes('elec_curr'));
        break;
      }
    }

    if (headerIdx < 0 || colRoom < 0 || (colWater < 0 && colElec < 0)) {
      alert('ไม่พบหัวตารางที่รองรับ (ต้องมีคอลัมน์ "เลขห้อง", "น้ำครั้งนี้", "ไฟครั้งนี้")\nแนะนำให้ใช้ไฟล์ที่ส่งออกจากปุ่ม "📥 Export ใบจดมิเตอร์ (Excel)" ครับ');
      return;
    }

    const rowMap = new Map();
    document.querySelectorAll('.meter-row').forEach(tr => {
      const code = String(tr.dataset.unitCode || '').trim().toUpperCase();
      if (code) rowMap.set(code, tr);
    });

    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const row = matrix[i];
      const code = String(row[colRoom] || '').trim().toUpperCase();
      if (!code || !rowMap.has(code)) continue;

      const tr = rowMap.get(code);
      const rawW = colWater >= 0 ? String(row[colWater] || '').replace(/,/g, '').trim() : '';
      const rawE = colElec >= 0 ? String(row[colElec] || '').replace(/,/g, '').trim() : '';

      const wValid = rawW !== '' && !isNaN(Number(rawW));
      const eValid = rawE !== '' && !isNaN(Number(rawE));

      if (!wValid && !eValid) {
        skippedCount++;
        continue;
      }

      const wInput = tr.querySelector('.row-w-curr');
      const eInput = tr.querySelector('.row-e-curr');
      if (wValid && wInput && !wInput.readOnly) wInput.value = Number(rawW);
      if (eValid && eInput && !eInput.readOnly) eInput.value = Number(rawE);

      const rentInput = tr.querySelector('.row-rent');
      if (rentInput) recalcMeterRow(rentInput);
      updatedCount++;
    }

    if (updatedCount > 0) {
      hasUnsavedMeterChanges = true;
      updateMeterProgressSummary();
      showToast(`📤 นำเข้าเลขมิเตอร์สำเร็จ ${updatedCount} ห้อง (เว้นว่าง ${skippedCount} ห้อง) — ตรวจสอบแล้วกดบันทึกได้เลยครับ`);
    } else {
      showToast('ไม่พบตัวเลขมิเตอร์ใหม่ในไฟล์ที่เลือก (อาจยังไม่ได้กรอกเลขในช่องครั้งนี้)', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function toggleMeterRollover(btnEl, kind) {
  const tr = btnEl.closest('.meter-row');
  if (!tr) return;
  if (kind === 'w') {
    tr.dataset.wRollover = tr.dataset.wRollover === '1' ? '0' : '1';
  } else {
    tr.dataset.eRollover = tr.dataset.eRollover === '1' ? '0' : '1';
  }
  const inputRent = tr.querySelector('.row-rent');
  if (inputRent) recalcMeterRow(inputRent);
}

function setMeterProgressFilter(mode) {
  meterProgressFilter = mode;
  updateMeterProgressSummary();
}

function isMeterRowDone(tr) {
  const wType = tr.dataset.waterType;
  const eType = tr.dataset.elecType;
  const wNeed = wType === 'meter';
  const eNeed = eType === 'meter';
  const wVal = (tr.querySelector('.row-w-curr')?.value || '').trim();
  const eVal = (tr.querySelector('.row-e-curr')?.value || '').trim();
  if (!wNeed && !eNeed) return true;
  const wOk = !wNeed || wVal !== '';
  const eOk = !eNeed || eVal !== '';
  return wOk && eOk;
}

function hasMeterRowAnyInput(tr) {
  const wVal = (tr.querySelector('.row-w-curr')?.value || '').trim();
  const eVal = (tr.querySelector('.row-e-curr')?.value || '').trim();
  return wVal !== '' || eVal !== '';
}

function hasMeterRowError(tr) {
  const wType = tr.dataset.waterType;
  const eType = tr.dataset.elecType;
  const wPrev = Number(tr.querySelector('.row-w-prev')?.value || 0);
  const ePrev = Number(tr.querySelector('.row-e-prev')?.value || 0);
  const wVal = (tr.querySelector('.row-w-curr')?.value || '').trim();
  const eVal = (tr.querySelector('.row-e-curr')?.value || '').trim();
  if (wType === 'meter' && wVal !== '' && Number(wVal) < wPrev && tr.dataset.wRollover !== '1') return true;
  if (eType === 'meter' && eVal !== '' && Number(eVal) < ePrev && tr.dataset.eRollover !== '1') return true;
  return false;
}

function updateMeterProgressSummary() {
  const rows = Array.from(document.querySelectorAll('.meter-row'));
  const total = rows.length;
  let done = 0;
  for (const tr of rows) {
    const isDone = isMeterRowDone(tr);
    if (isDone) done++;
    if (meterProgressFilter === 'all') {
      tr.style.display = '';
    } else if (meterProgressFilter === 'done') {
      tr.style.display = isDone ? '' : 'none';
    } else if (meterProgressFilter === 'pending') {
      tr.style.display = isDone ? 'none' : '';
    }
  }
  const pending = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const textEl = document.getElementById('meter-progress-text');
  if (textEl) textEl.textContent = `📊 จดแล้ว ${done} / ${total} ห้อง (เหลือ ${pending} ห้อง)`;
  const fillEl = document.getElementById('meter-progress-fill');
  if (fillEl) fillEl.style.width = `${pct}%`;

  const cAll = document.getElementById('mf-cnt-all');
  const cPend = document.getElementById('mf-cnt-pending');
  const cDone = document.getElementById('mf-cnt-done');
  if (cAll) cAll.textContent = String(total);
  if (cPend) cPend.textContent = String(pending);
  if (cDone) cDone.textContent = String(done);

  ['all', 'pending', 'done'].forEach(m => {
    const btn = document.getElementById(`btn-mf-${m}`);
    if (btn) {
      btn.classList.toggle('btn-primary', meterProgressFilter === m);
      btn.classList.toggle('btn-outline', meterProgressFilter !== m);
    }
  });

  const unsavedEl = document.getElementById('meter-unsaved-badge');
  if (unsavedEl) {
    unsavedEl.style.display = hasUnsavedMeterChanges ? 'inline-block' : 'none';
  }
}

function recalcMeterRow(inputEl, isInit = false) {
  const tr = inputEl.closest('.meter-row');
  if (!tr) return;
  if (!isInit) {
    hasUnsavedMeterChanges = true;
  }
  const s = appState.settings || {};

  const wType = tr.dataset.waterType;
  const eType = tr.dataset.elecType;
  const wRate = Number(tr.dataset.waterRate || s.waterRate || 18);
  const eRate = Number(tr.dataset.elecRate || s.electricRate || 8);

  const wPrev = Number(tr.querySelector('.row-w-prev')?.value || 0);
  const wCurrInput = tr.querySelector('.row-w-curr');
  const wCurrVal = wCurrInput ? wCurrInput.value.trim() : '';
  const wDiffEl = tr.querySelector('.row-w-diff');

  if (wType === 'direct') {
    const amtEl = tr.querySelector('.row-w-amt');
    if (amtEl) amtEl.value = 0;
    if (wDiffEl) wDiffEl.innerHTML = '<span style="color:#64748b;">จ่ายตรงการประปา</span>';
  } else if (wType === 'actual_bill') {
    if (wDiffEl) wDiffEl.innerHTML = '<span style="color:#64748b;">ตามบิลจริง</span>';
  } else if (wType === 'flat') {
    const amtEl = tr.querySelector('.row-w-amt');
    if (amtEl) amtEl.value = wRate;
    if (wDiffEl) wDiffEl.innerHTML = `<span style="color:#64748b;">เหมาจ่าย ฿${formatMoney(wRate)}</span>`;
  } else if (wType === 'meter') {
    const amtEl = tr.querySelector('.row-w-amt');
    if (wCurrVal === '') {
      tr.dataset.wRollover = '0';
      if (amtEl) amtEl.value = 0;
      if (wDiffEl) wDiffEl.innerHTML = '<span style="color:#94a3b8; font-weight:500;">รอจดมิเตอร์</span>';
      if (wCurrInput) {
        wCurrInput.style.borderColor = '#0284c7';
        wCurrInput.style.background = '#ffffff';
      }
    } else {
      const wCurr = Number(wCurrVal);
      if (wCurr < wPrev) {
        if (tr.dataset.wRollover === '1') {
          const base = wPrev >= 10000 ? 100000 : 10000;
          const wUnits = (base - wPrev) + wCurr;
          let wAmt = wUnits * wRate;
          const wMin = Number(s.waterMinCharge || 0);
          let isMinApplied = false;
          if (wMin > 0 && wAmt < wMin) {
            wAmt = wMin;
            isMinApplied = true;
          }
          if (amtEl) amtEl.value = Math.round(wAmt * 100) / 100;
          if (wDiffEl) {
            wDiffEl.innerHTML = `<span style="color:#7c3aed; font-weight:700;">🔄 ครบรอบ ${base === 100000 ? '5' : '4'} หลัก • ใช้ ${wUnits} หน่วย ${isMinApplied ? '<small style="color:#e11d48;">(ขั้นต่ำ ฿' + wMin + ')</small>' : ''}</span> <button type="button" onclick="toggleMeterRollover(this, 'w')" style="border:none; background:none; color:#64748b; text-decoration:underline; cursor:pointer; font-size:10.5px;">ยกเลิก</button>`;
          }
          if (wCurrInput) {
            wCurrInput.style.borderColor = '#7c3aed';
            wCurrInput.style.background = '#f5f3ff';
          }
        } else {
          if (amtEl) amtEl.value = 0;
          if (wDiffEl) {
            wDiffEl.innerHTML = `<span style="color:#dc2626; font-weight:700;">⚠️ ต่ำกว่าครั้งก่อน (${wCurr} &lt; ${wPrev})</span> <button type="button" onclick="toggleMeterRollover(this, 'w')" style="border:1px solid #c4b5fd; background:#f5f3ff; color:#6d28d9; border-radius:4px; padding:1px 6px; cursor:pointer; font-size:10.5px; font-weight:700;">🔄 มิเตอร์ครบรอบ?</button>`;
          }
          if (wCurrInput) {
            wCurrInput.style.borderColor = '#ef4444';
            wCurrInput.style.background = '#fef2f2';
          }
        }
      } else {
        tr.dataset.wRollover = '0';
        const wUnits = wCurr - wPrev;
        let wAmt = wUnits * wRate;
        const wMin = Number(s.waterMinCharge || 0);
        let isMinApplied = false;
        if (wMin > 0 && wAmt < wMin) {
          wAmt = wMin;
          isMinApplied = true;
        }
        if (amtEl) amtEl.value = Math.round(wAmt * 100) / 100;
        if (wDiffEl) {
          wDiffEl.innerHTML = `<span style="color:#0284c7; font-weight:700;">💧 ใช้ ${wUnits} หน่วย ${isMinApplied ? '<small style="color:#e11d48;">(ขั้นต่ำ ฿' + wMin + ')</small>' : ''}</span>`;
        }
        if (wCurrInput) {
          wCurrInput.style.borderColor = '#0284c7';
          wCurrInput.style.background = '#ffffff';
        }
      }
    }
  }

  const ePrev = Number(tr.querySelector('.row-e-prev')?.value || 0);
  const eCurrInput = tr.querySelector('.row-e-curr');
  const eCurrVal = eCurrInput ? eCurrInput.value.trim() : '';
  const eDiffEl = tr.querySelector('.row-e-diff');

  if (eType === 'direct') {
    const amtEl = tr.querySelector('.row-e-amt');
    if (amtEl) amtEl.value = 0;
    if (eDiffEl) eDiffEl.innerHTML = '<span style="color:#64748b;">จ่ายตรงการไฟฟ้า</span>';
  } else if (eType === 'actual_bill') {
    if (eDiffEl) eDiffEl.innerHTML = '<span style="color:#64748b;">ตามบิลจริง</span>';
  } else if (eType === 'flat') {
    const amtEl = tr.querySelector('.row-e-amt');
    if (amtEl) amtEl.value = eRate;
    if (eDiffEl) eDiffEl.innerHTML = `<span style="color:#64748b;">เหมาจ่าย ฿${formatMoney(eRate)}</span>`;
  } else if (eType === 'meter') {
    const amtEl = tr.querySelector('.row-e-amt');
    if (eCurrVal === '') {
      tr.dataset.eRollover = '0';
      if (amtEl) amtEl.value = 0;
      if (eDiffEl) eDiffEl.innerHTML = '<span style="color:#94a3b8; font-weight:500;">รอจดมิเตอร์</span>';
      if (eCurrInput) {
        eCurrInput.style.borderColor = '#f59e0b';
        eCurrInput.style.background = '#ffffff';
      }
    } else {
      const eCurr = Number(eCurrVal);
      if (eCurr < ePrev) {
        if (tr.dataset.eRollover === '1') {
          const base = ePrev >= 10000 ? 100000 : 10000;
          const eUnits = (base - ePrev) + eCurr;
          let eAmt = eUnits * eRate;
          const eMin = Number(s.electricMinCharge || 0);
          let isMinApplied = false;
          if (eMin > 0 && eAmt < eMin) {
            eAmt = eMin;
            isMinApplied = true;
          }
          if (amtEl) amtEl.value = Math.round(eAmt * 100) / 100;
          if (eDiffEl) {
            eDiffEl.innerHTML = `<span style="color:#7c3aed; font-weight:700;">🔄 ครบรอบ ${base === 100000 ? '5' : '4'} หลัก • ใช้ ${eUnits} หน่วย ${isMinApplied ? '<small style="color:#e11d48;">(ขั้นต่ำ ฿' + eMin + ')</small>' : ''}</span> <button type="button" onclick="toggleMeterRollover(this, 'e')" style="border:none; background:none; color:#64748b; text-decoration:underline; cursor:pointer; font-size:10.5px;">ยกเลิก</button>`;
          }
          if (eCurrInput) {
            eCurrInput.style.borderColor = '#7c3aed';
            eCurrInput.style.background = '#f5f3ff';
          }
        } else {
          if (amtEl) amtEl.value = 0;
          if (eDiffEl) {
            eDiffEl.innerHTML = `<span style="color:#dc2626; font-weight:700;">⚠️ ต่ำกว่าครั้งก่อน (${eCurr} &lt; ${ePrev})</span> <button type="button" onclick="toggleMeterRollover(this, 'e')" style="border:1px solid #c4b5fd; background:#f5f3ff; color:#6d28d9; border-radius:4px; padding:1px 6px; cursor:pointer; font-size:10.5px; font-weight:700;">🔄 มิเตอร์ครบรอบ?</button>`;
          }
          if (eCurrInput) {
            eCurrInput.style.borderColor = '#ef4444';
            eCurrInput.style.background = '#fef2f2';
          }
        }
      } else {
        tr.dataset.eRollover = '0';
        const eUnits = eCurr - ePrev;
        let eAmt = eUnits * eRate;
        const eMin = Number(s.electricMinCharge || 0);
        let isMinApplied = false;
        if (eMin > 0 && eAmt < eMin) {
          eAmt = eMin;
          isMinApplied = true;
        }
        if (amtEl) amtEl.value = Math.round(eAmt * 100) / 100;
        if (eDiffEl) {
          eDiffEl.innerHTML = `<span style="color:#d97706; font-weight:700;">⚡ ใช้ ${eUnits} หน่วย ${isMinApplied ? '<small style="color:#e11d48;">(ขั้นต่ำ ฿' + eMin + ')</small>' : ''}</span>`;
        }
        if (eCurrInput) {
          eCurrInput.style.borderColor = '#f59e0b';
          eCurrInput.style.background = '#ffffff';
        }
      }
    }
  }

  recalcMeterRowTotal(inputEl);
  if (!isInit) {
    updateMeterProgressSummary();
  }
}

function recalcMeterRowTotal(inputEl) {
  const tr = inputEl.closest('.meter-row');
  if (!tr) return;
  const rent = Number(tr.querySelector('.row-rent')?.value || 0);
  const wAmt = Number(tr.querySelector('.row-w-amt')?.value || 0);
  const eAmt = Number(tr.querySelector('.row-e-amt')?.value || 0);
  const common = Number(tr.querySelector('.row-common')?.value || 0);
  const total = rent + wAmt + eAmt + common;
  tr.querySelector('.row-total-display').textContent = `฿${formatMoney(total)}`;
}

function extractInvoiceFromMeterRow(tr, forceMode = 'issue') {
  const unitId = tr.dataset.unitId;
  const u = (appState.units || []).find(x => x.id === unitId);
  const tenant = (appState.tenants || []).find(t => t.unitId === unitId && t.status === 'active') || {};
  const existingInv = (appState.invoices || []).find(
    i => i.unitId === unitId && i.billingMonth === selectedBillingMonth
  );

  const issueDate = document.getElementById('batch-issue-date')?.value || `${selectedBillingMonth}-01`;
  const dueDate = document.getElementById('batch-due-date')?.value || `${selectedBillingMonth}-05`;

  const rentAmount = Number(tr.querySelector('.row-rent')?.value || 0);
  const waterPrevMeter = Number(tr.querySelector('.row-w-prev')?.value || 0);
  const wCurrVal = tr.querySelector('.row-w-curr')?.value.trim() || '';
  const waterEntered = wCurrVal !== '';
  const waterCurrMeter = waterEntered ? Number(wCurrVal) : waterPrevMeter;
  const waterRollover = tr.dataset.wRollover === '1' && waterEntered && waterCurrMeter < waterPrevMeter;
  const wBase = waterPrevMeter >= 10000 ? 100000 : 10000;
  const waterUnits = waterRollover ? ((wBase - waterPrevMeter) + waterCurrMeter) : Math.max(0, waterCurrMeter - waterPrevMeter);
  const waterRate = Number(tr.dataset.waterRate || 0);
  const waterAmount = Number(tr.querySelector('.row-w-amt')?.value || 0);

  const electricPrevMeter = Number(tr.querySelector('.row-e-prev')?.value || 0);
  const eCurrVal = tr.querySelector('.row-e-curr')?.value.trim() || '';
  const electricEntered = eCurrVal !== '';
  const electricCurrMeter = electricEntered ? Number(eCurrVal) : electricPrevMeter;
  const electricRollover = tr.dataset.eRollover === '1' && electricEntered && electricCurrMeter < electricPrevMeter;
  const eBase = electricPrevMeter >= 10000 ? 100000 : 10000;
  const electricUnits = electricRollover ? ((eBase - electricPrevMeter) + electricCurrMeter) : Math.max(0, electricCurrMeter - electricPrevMeter);
  const electricRate = Number(tr.dataset.elecRate || 0);
  const electricAmount = Number(tr.querySelector('.row-e-amt')?.value || 0);

  const commonAndOther = Number(tr.querySelector('.row-common')?.value || 0);
  const baseCommon = Number(u.commonFee || 0);
  const otherFee = Math.max(0, commonAndOther - baseCommon);
  const commonFee = commonAndOther - otherFee;

  const lateFee = existingInv ? Number(existingInv.lateFee || 0) : 0;
  const discount = existingInv ? Number(existingInv.discount || 0) : 0;
  const totalAmount = Math.max(0, rentAmount + waterAmount + electricAmount + commonFee + otherFee + lateFee - discount);

  let nextStatus = existingInv ? existingInv.status : 'unpaid';
  if (forceMode === 'draft') {
    nextStatus = existingInv && existingInv.status !== 'draft' ? existingInv.status : 'draft';
  } else if (forceMode === 'issue' && nextStatus === 'draft') {
    nextStatus = 'unpaid';
  }

  return {
    id: existingInv ? existingInv.id : undefined,
    invoiceNo: existingInv ? existingInv.invoiceNo : undefined,
    billingMonth: selectedBillingMonth,
    issueDate,
    dueDate,
    unitId: u.id,
    unitCode: u.code,
    unitName: u.name,
    unitCategory: u.category,
    unitZone: u.zone,
    tenantId: tenant.id || '',
    tenantName: tenant.fullName || 'ผู้เช่า',
    tenantPhone: tenant.phone || '',
    rentAmount,
    waterBillingType: u.waterBillingType,
    waterPrevMeter,
    waterCurrMeter,
    waterUnits,
    waterRate,
    waterAmount,
    waterEntered,
    waterRollover,
    electricBillingType: u.electricBillingType,
    electricPrevMeter,
    electricCurrMeter,
    electricUnits,
    electricRate,
    electricAmount,
    electricEntered,
    electricRollover,
    commonFee,
    otherFee,
    otherFeeLabel: u.otherFixedFeeLabel || 'ค่าบริการอื่นๆ',
    lateFee,
    discount,
    totalAmount,
    status: nextStatus
  };
}

async function saveSingleMeterDraft(btn) {
  const tr = btn.closest('.meter-row');
  if (!tr) return;
  if (hasMeterRowError(tr)) {
    showToast('⚠️ เลขมิเตอร์ต่ำกว่าครั้งก่อน กรุณาแก้ไขหรือกดปุ่ม "มิเตอร์ครบรอบ?" ก่อนบันทึก', 'error');
    return;
  }
  const invPayload = extractInvoiceFromMeterRow(tr, 'draft');
  await apiPost('/api/invoices', invPayload);
  hasUnsavedMeterChanges = false;
  await fetchState();
  renderCurrentTab();
  showToast(`💾 บันทึกร่างมิเตอร์ห้อง ${invPayload.unitCode} เรียบร้อยแล้ว (ยังไม่นับเป็นบิลค้างชำระ)`);
}

async function saveSingleMeterRow(btn) {
  const tr = btn.closest('.meter-row');
  if (!tr) return;
  if (hasMeterRowError(tr)) {
    showToast('⚠️ เลขมิเตอร์ต่ำกว่าครั้งก่อน กรุณาแก้ไขหรือกดปุ่ม "มิเตอร์ครบรอบ?" ก่อนออกบิล', 'error');
    return;
  }
  const invPayload = extractInvoiceFromMeterRow(tr, 'issue');
  await apiPost('/api/invoices', invPayload);
  hasUnsavedMeterChanges = false;
  await fetchState();
  renderCurrentTab();
  const saved = (appState.invoices || []).find(
    i => i.unitId === invPayload.unitId && i.billingMonth === selectedBillingMonth
  );
  showToast(`ออกใบแจ้งหนี้ ${invPayload.unitCode} เรียบร้อยแล้ว`);
  if (saved) {
    openA5PreviewModal(saved.id);
  }
}

async function saveMeterProgressDraft() {
  const rows = Array.from(document.querySelectorAll('.meter-row'));
  if (rows.length === 0) {
    showToast('ไม่มีรายการห้องเช่าในตาราง', 'error');
    return;
  }
  const errorRows = rows.filter(tr => hasMeterRowError(tr));
  if (errorRows.length > 0) {
    const codes = errorRows.map(tr => tr.dataset.unitCode).join(', ');
    alert(`พบห้องที่เลขมิเตอร์ต่ำกว่าครั้งก่อน ${errorRows.length} ห้อง (${codes})\nกรุณาแก้ไขตัวเลข หรือกดปุ่ม "🔄 มิเตอร์ครบรอบ?" ในช่องนั้นก่อนบันทึกครับ`);
    return;
  }

  // Only save rows that have meter input entered OR already exist for this month
  const rowsToSave = rows.filter(tr => {
    const unitId = tr.dataset.unitId;
    const hasInv = (appState.invoices || []).some(i => i.unitId === unitId && i.billingMonth === selectedBillingMonth);
    return hasInv || hasMeterRowAnyInput(tr);
  });

  if (rowsToSave.length === 0) {
    showToast('ยังไม่ได้กรอกเลขมิเตอร์ในห้องใดเลยครับ', 'error');
    return;
  }

  const invoices = rowsToSave.map(tr => extractInvoiceFromMeterRow(tr, 'draft'));
  await apiPost('/api/invoices/batch', { invoices });
  hasUnsavedMeterChanges = false;
  await fetchState();
  renderCurrentTab();
  showToast(`💾 บันทึกความคืบหน้าไว้แล้ว ${invoices.length} ห้อง (ห้องที่ยังไม่ได้จดจะยังไม่ถูกสร้างเป็นบิลค้างชำระ)`);
}

async function saveAllMeterRows() {
  const rows = Array.from(document.querySelectorAll('.meter-row'));
  if (rows.length === 0) return;

  const errorRows = rows.filter(tr => hasMeterRowError(tr));
  if (errorRows.length > 0) {
    const codes = errorRows.map(tr => tr.dataset.unitCode).join(', ');
    alert(`พบห้องที่เลขมิเตอร์ต่ำกว่าครั้งก่อน ${errorRows.length} ห้อง (${codes})\nกรุณาแก้ไขตัวเลข หรือกดปุ่ม "🔄 มิเตอร์ครบรอบ?" ในช่องนั้นก่อนสร้างใบแจ้งหนี้ครับ`);
    return;
  }

  const doneRows = rows.filter(tr => isMeterRowDone(tr));
  const pendingRows = rows.filter(tr => !isMeterRowDone(tr));

  let rowsToIssue = rows;
  if (pendingRows.length > 0) {
    if (doneRows.length === 0) {
      alert('ยังไม่มีห้องใดที่กรอกเลขมิเตอร์ครบถ้วนเลย กรุณากรอกเลขมิเตอร์ก่อนสร้างใบแจ้งหนี้ครับ');
      return;
    }
    const samplePending = pendingRows.slice(0, 6).map(tr => tr.dataset.unitCode).join(', ');
    const moreText = pendingRows.length > 6 ? ` และอีก ${pendingRows.length - 6} ห้อง` : '';
    const ok = confirm(
      `พบห้องที่ยังไม่ได้จดมิเตอร์อีก ${pendingRows.length} ห้อง (${samplePending}${moreText})\n\nระบบจะสร้างใบแจ้งหนี้ A5 เฉพาะ ${doneRows.length} ห้องที่จดมิเตอร์ครบแล้วเท่านั้น (ส่วนห้องที่ยังไม่จดจะยังไม่ถูกออกบิล)\n\nต้องการดำเนินการต่อหรือไม่?`
    );
    if (!ok) return;
    rowsToIssue = doneRows;
  }

  const invoices = rowsToIssue.map(tr => extractInvoiceFromMeterRow(tr, 'issue'));
  await apiPost('/api/invoices/batch', { invoices });
  hasUnsavedMeterChanges = false;
  await fetchState();
  showToast(`สร้าง/อัปเดตใบแจ้งหนี้ขนาด A5 จำนวน ${invoices.length} รายการเรียบร้อยแล้ว`);
  switchTab('invoices');
}

// ----------------------------------------------------------------------------
// TAB 5: INVOICES & RECEIPTS (A5 STANDARD)
// ----------------------------------------------------------------------------
function renderInvoicesTab(container) {
  const invoices = filterByCategory(appState.invoices || [], i => i.unitCategory).filter(i => {
    if (selectedBillingMonth && i.billingMonth !== selectedBillingMonth) return false;
    if (invoiceStatusFilter === 'all' && i.status === 'draft') return false;
    if (invoiceStatusFilter !== 'all' && i.status !== invoiceStatusFilter) return false;
    if (selectedZoneFilter !== 'all' && (i.unitZone || '') !== selectedZoneFilter) return false;
    return true;
  });

  const totalSum = invoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
  const paidSum = invoices
    .filter(i => i.status === 'paid' || i.status === 'partial')
    .reduce((s, i) => s + Number(i.paidAmount ?? (i.status === 'paid' ? i.totalAmount : 0)), 0);
  const unpaidSum = Math.max(0, totalSum - paidSum);
  const rentSum = invoices.reduce((s, i) => s + Number(i.rentAmount || 0), 0);
  const waterSum = invoices.reduce((s, i) => s + Number(i.waterAmount || 0), 0);
  const waterUnitsSum = invoices.reduce((s, i) => s + Number(i.waterUnits || 0), 0);
  const elecSum = invoices.reduce((s, i) => s + Number(i.electricAmount || 0), 0);
  const elecUnitsSum = invoices.reduce((s, i) => s + Number(i.electricUnits || 0), 0);
  const feeSum = invoices.reduce((s, i) => s + Number(i.commonFee || 0) + Number(i.otherFee || 0) + Number(i.lateFee || 0) - Number(i.discount || 0), 0);
  const paidCount = invoices.filter(i => i.status === 'paid').length;
  const unpaidCount = invoices.length - paidCount;

  let rowsHtml = '';
  let lastZone = null;
  for (const inv of invoices) {
    const zName = inv.unitZone || 'ไม่ระบุอาคาร';
    if (zName !== lastZone) {
      lastZone = zName;
      const theme = getZoneTheme(zName);
      const zInvs = invoices.filter(x => (x.unitZone || 'ไม่ระบุอาคาร') === zName);
      const zTotal = zInvs.reduce((s, x) => s + Number(x.totalAmount || 0), 0);
      rowsHtml += `
        <tr style="background:${theme.bg}; border-top:2px solid ${theme.border};">
          <td colspan="10" style="padding:9px 14px; font-weight:800; color:${theme.text}; font-size:13.5px;">
            🏢 อาคาร / โซน: ${escapeHtml(zName)}
            <span class="badge" style="background:${theme.border}; color:#fff; margin-left:6px;">${zInvs.length} ใบแจ้งหนี้</span>
            <span style="float:right; font-size:12.5px;">ยอดรวมตึกนี้: ฿${formatMoney(zTotal)}</span>
          </td>
        </tr>
      `;
    }
    rowsHtml += `
      <tr>
        <td>
          <strong>${escapeHtml(inv.invoiceNo)}</strong>
          ${inv.receiptNo ? `<div style="font-size:11.5px; color:#16a34a;">ใบเสร็จ: ${escapeHtml(inv.receiptNo)}</div>` : ''}
        </td>
        <td>
          <strong>${escapeHtml(inv.unitCode)}</strong>
          <div>${getCategoryBadge(inv.unitCategory)}</div>
        </td>
        <td>
          <div>${escapeHtml(inv.tenantName)}</div>
          <div style="font-size:12px; color:var(--text-muted)">${escapeHtml(inv.tenantPhone || '')}</div>
        </td>
        <td class="text-right">฿${formatMoney(inv.rentAmount)}</td>
        <td class="text-right">
          ฿${formatMoney(inv.waterAmount)}
          <div style="font-size:11px; color:var(--text-muted)">(${inv.waterPrevMeter}→${inv.waterCurrMeter})</div>
        </td>
        <td class="text-right">
          ฿${formatMoney(inv.electricAmount)}
          <div style="font-size:11px; color:var(--text-muted)">(${inv.electricPrevMeter}→${inv.electricCurrMeter})</div>
        </td>
        <td class="text-right">
          ฿${formatMoney(Number(inv.commonFee || 0) + Number(inv.otherFee || 0) + Number(inv.lateFee || 0) - Number(inv.discount || 0))}
          ${Number(inv.lateFee || 0) > 0 ? `<div style="font-size:10.5px; color:#dc2626;">(รวมค่าปรับ ฿${formatMoney(inv.lateFee)})</div>` : ''}
        </td>
        <td class="text-right">
          <strong style="font-size:14.5px;">฿${formatMoney(inv.totalAmount)}</strong>
          ${inv.status === 'partial' ? `<div style="font-size:11px; color:#b45309; font-weight:700;">จ่ายแล้ว ฿${formatMoney(inv.paidAmount || 0)}<br/>ค้าง ฿${formatMoney(Math.max(0, Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)))}</div>` : ''}
        </td>
        <td>${getInvoiceStatusBadge(inv.status)}</td>
        <td class="text-right">
          <div style="display:flex; gap:5px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="openA5PreviewModal('${inv.id}', 'invoice')">🖨️ ใบแจ้งหนี้ A5</button>
            ${inv.status === 'paid' ? `
              <button class="btn btn-sm btn-success" onclick="openA5PreviewModal('${inv.id}', 'receipt')">🧾 ใบเสร็จ A5</button>
              <button class="btn btn-sm btn-outline" style="color:#b45309;" onclick="revertInvoicePayment('${inv.id}')" title="ยกเลิกการรับชำระและย้อนกลับเป็นรอชำระ">↩️ ย้อนชำระ</button>
            ` : `
              <button class="btn btn-sm btn-success" onclick="openPaymentModal('${inv.id}')">💵 ${inv.status === 'partial' ? 'รับชำระเพิ่ม' : 'รับชำระ'}</button>
            `}
            <button class="btn btn-sm btn-outline" onclick="openQuickBillModal('${inv.unitId}', '${inv.id}')">แก้ไข</button>
            <button class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="confirmDeleteInvoice('${inv.id}')">ลบ</button>
          </div>
        </td>
      </tr>
    `;
  }

  container.innerHTML = `
    ${renderZoneSelectorBar()}
    <div class="card">
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div class="card-title">🧾 รายการใบแจ้งหนี้ & ใบเสร็จรับเงิน (ขนาด A5)</div>
          <input type="month" class="form-control" value="${selectedBillingMonth}" onchange="selectedBillingMonth=this.value; renderCurrentTab();" style="width:165px;" />
          <select class="form-control" onchange="invoiceStatusFilter=this.value; renderCurrentTab();" style="width:170px;">
            <option value="all" ${invoiceStatusFilter === 'all' ? 'selected' : ''}>สถานะ: บิลจริงทั้งหมด</option>
            <option value="unpaid" ${invoiceStatusFilter === 'unpaid' ? 'selected' : ''}>⏳ รอชำระ</option>
            <option value="partial" ${invoiceStatusFilter === 'partial' ? 'selected' : ''}>🌓 ชำระบางส่วน</option>
            <option value="overdue" ${invoiceStatusFilter === 'overdue' ? 'selected' : ''}>⚠️ เกินกำหนด</option>
            <option value="paid" ${invoiceStatusFilter === 'paid' ? 'selected' : ''}>✓ ชำระแล้ว</option>
            <option value="draft" ${invoiceStatusFilter === 'draft' ? 'selected' : ''}>📝 บันทึกร่าง (รอออกบิล)</option>
          </select>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="switchTab('accounting')">📊 ดูสรุปรายเดือนแยกตามตึก</button>
          <button class="btn btn-success" onclick="exportMonthlyExcel('${selectedBillingMonth}')">📥 Export Excel (.xls)</button>
          <button class="btn btn-outline" onclick="exportMonthlyCsv('${selectedBillingMonth}')">📄 CSV</button>
          <button class="btn btn-primary" onclick="openBatchA5PreviewModal()">🖨️ พิมพ์ใบแจ้งหนี้ A5 ทั้งเดือน (${invoices.length} ใบ)</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:10px; padding:14px 20px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
        <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:11.5px; color:var(--text-muted);">ค่าเช่าห้องรวม (${invoices.length} บิล)</div>
          <div style="font-size:15.5px; font-weight:800; color:#0f172a;">฿${formatMoney(rentSum)}</div>
        </div>
        <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:11.5px; color:var(--text-muted);">ค่าน้ำรวม (${waterUnitsSum} หน่วย)</div>
          <div style="font-size:15.5px; font-weight:800; color:#0284c7;">฿${formatMoney(waterSum)}</div>
        </div>
        <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:11.5px; color:var(--text-muted);">ค่าไฟรวม (${elecUnitsSum} หน่วย)</div>
          <div style="font-size:15.5px; font-weight:800; color:#d97706;">฿${formatMoney(elecSum)}</div>
        </div>
        <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:11.5px; color:var(--text-muted);">ขยะ/จอดรถ/อื่นๆ</div>
          <div style="font-size:15.5px; font-weight:800; color:#475569;">฿${formatMoney(feeSum)}</div>
        </div>
        <div style="background:#eff6ff; padding:10px 12px; border-radius:8px; border:1px solid #bfdbfe;">
          <div style="font-size:11.5px; color:#1e40af; font-weight:700;">ยอดเรียกเก็บรวมสุทธิ</div>
          <div style="font-size:16px; font-weight:800; color:#1d4ed8;">฿${formatMoney(totalSum)}</div>
        </div>
        <div style="background:#f0fdf4; padding:10px 12px; border-radius:8px; border:1px solid #bbf7d0;">
          <div style="font-size:11.5px; color:#166534; font-weight:700;">รับชำระแล้ว (${paidCount} ห้อง)</div>
          <div style="font-size:16px; font-weight:800; color:#16a34a;">฿${formatMoney(paidSum)}</div>
        </div>
        <div style="background:#fef2f2; padding:10px 12px; border-radius:8px; border:1px solid #fecaca;">
          <div style="font-size:11.5px; color:#991b1b; font-weight:700;">ค้างชำระ (${unpaidCount} ห้อง)</div>
          <div style="font-size:16px; font-weight:800; color:#dc2626;">฿${formatMoney(unpaidSum)}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>เลขที่เอกสาร</th>
              <th>บ้าน / ห้อง</th>
              <th>ชื่อผู้เช่า</th>
              <th class="text-right">ค่าเช่า</th>
              <th class="text-right">ค่าน้ำ</th>
              <th class="text-right">ค่าไฟ</th>
              <th class="text-right">ส่วนกลาง/อื่นๆ</th>
              <th class="text-right">ยอดสุทธิ</th>
              <th>สถานะ</th>
              <th class="text-right">พิมพ์ A5 / จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="10" class="text-center" style="padding:36px; color:var(--text-muted)">ยังไม่มีใบแจ้งหนี้ในรอบเดือนนี้ กดปุ่ม "⚡ จดมิเตอร์ออกบิล" ด้านบนเพื่อสร้างบิลได้ทันที</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openQuickBillModal(unitId, invoiceId = null) {
  const s = appState.settings || {};
  const u = (appState.units || []).find(x => x.id === unitId) || {};
  const tenant = (appState.tenants || []).find(t => t.unitId === unitId && t.status === 'active') || {};
  const existing = invoiceId
    ? (appState.invoices || []).find(i => i.id === invoiceId)
    : (appState.invoices || []).find(i => i.unitId === unitId && i.billingMonth === selectedBillingMonth);

  const wRate = u.customWaterRate !== undefined && u.customWaterRate !== '' ? Number(u.customWaterRate) : Number(s.waterRate || 18);
  const eRate = u.customElectricRate !== undefined && u.customElectricRate !== '' ? Number(u.customElectricRate) : Number(s.electricRate || 8);

  const inv = existing || {
    id: '',
    billingMonth: selectedBillingMonth,
    issueDate: `${selectedBillingMonth}-01`,
    dueDate: `${selectedBillingMonth}-${String(s.defaultDueDay || 5).padStart(2, '0')}`,
    unitId: u.id,
    unitCode: u.code,
    unitName: u.name,
    unitCategory: u.category,
    unitZone: u.zone,
    tenantId: tenant.id || '',
    tenantName: tenant.fullName || '',
    tenantPhone: tenant.phone || '',
    rentAmount: tenant.agreedRent || u.baseRent || 0,
    waterBillingType: u.waterBillingType || 'meter',
    waterPrevMeter: u.lastWaterMeter || 0,
    waterCurrMeter: u.lastWaterMeter || 0,
    waterUnits: 0,
    waterRate: wRate,
    waterAmount: 0,
    electricBillingType: u.electricBillingType || 'meter',
    electricPrevMeter: u.lastElectricMeter || 0,
    electricCurrMeter: u.lastElectricMeter || 0,
    electricUnits: 0,
    electricRate: eRate,
    electricAmount: 0,
    commonFee: u.commonFee || 0,
    otherFee: u.otherFixedFee || 0,
    otherFeeLabel: u.otherFixedFeeLabel || 'ค่าบริการอื่นๆ',
    discount: 0,
    totalAmount: (tenant.agreedRent || u.baseRent || 0) + Number(u.commonFee || 0) + Number(u.otherFixedFee || 0),
    status: 'unpaid',
    note: ''
  };

  showModal({
    title: `ออกใบแจ้งหนี้ / แก้ไขบิล (${u.code} - ${inv.tenantName || 'ผู้เช่า'})`,
    bodyHtml: `
      <form id="quick-bill-form" class="form-grid">
        <div class="form-group">
          <label>รอบเดือน</label>
          <input type="month" class="form-control" id="qb-month" value="${inv.billingMonth}" />
        </div>
        <div class="form-group">
          <label>วันที่ออกใบแจ้งหนี้</label>
          <input type="date" class="form-control" id="qb-issueDate" value="${inv.issueDate}" />
        </div>
        <div class="form-group">
          <label>วันครบกำหนดชำระ</label>
          <input type="date" class="form-control" id="qb-dueDate" value="${inv.dueDate}" />
        </div>

        <div class="form-group">
          <label>ชื่อผู้เช่าในบิล</label>
          <input type="text" class="form-control" id="qb-tenantName" value="${escapeHtml(inv.tenantName)}" />
        </div>
        <div class="form-group">
          <label>ค่าเช่าประจำเดือน (บาท)</label>
          <input type="number" class="form-control" id="qb-rent" value="${inv.rentAmount}" oninput="recalcQuickBill()" />
        </div>
        <div class="form-group">
          <label>สถานะการชำระ</label>
          <select class="form-control" id="qb-status">
            <option value="unpaid" ${inv.status === 'unpaid' ? 'selected' : ''}>รอชำระ</option>
            <option value="overdue" ${inv.status === 'overdue' ? 'selected' : ''}>เกินกำหนด</option>
            <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>ชำระแล้ว</option>
          </select>
        </div>

        <div class="form-group">
          <label>💧 มิเตอร์น้ำครั้งก่อน</label>
          <input type="number" class="form-control" id="qb-wPrev" value="${inv.waterPrevMeter}" oninput="recalcQuickBill()" />
        </div>
        <div class="form-group">
          <label>💧 มิเตอร์น้ำครั้งนี้</label>
          <input type="number" class="form-control" id="qb-wCurr" value="${inv.waterCurrMeter}" oninput="recalcQuickBill()" />
        </div>
        <div class="form-group">
          <label>💧 รวมค่าน้ำประปา (บาท) [@${inv.waterRate} บ.]</label>
          <input type="number" class="form-control" id="qb-wAmt" value="${inv.waterAmount}" oninput="recalcQuickBill(true)" />
        </div>

        <div class="form-group">
          <label>⚡ มิเตอร์ไฟครั้งก่อน</label>
          <input type="number" class="form-control" id="qb-ePrev" value="${inv.electricPrevMeter}" oninput="recalcQuickBill()" />
        </div>
        <div class="form-group">
          <label>⚡ มิเตอร์ไฟครั้งนี้</label>
          <input type="number" class="form-control" id="qb-eCurr" value="${inv.electricCurrMeter}" oninput="recalcQuickBill()" />
        </div>
        <div class="form-group">
          <label>⚡ รวมค่าไฟฟ้า (บาท) [@${inv.electricRate} บ.]</label>
          <input type="number" class="form-control" id="qb-eAmt" value="${inv.electricAmount}" oninput="recalcQuickBill(true)" />
        </div>

        <div class="form-group">
          <label>ค่าส่วนกลาง / ค่าขยะ (บาท)</label>
          <input type="number" class="form-control" id="qb-common" value="${inv.commonFee}" oninput="recalcQuickBill(true)" />
        </div>
        <div class="form-group">
          <label>ค่าบริการอื่นๆ (บาท)</label>
          <input type="number" class="form-control" id="qb-other" value="${inv.otherFee}" oninput="recalcQuickBill(true)" />
        </div>
        <div class="form-group">
          <label>รายละเอียดค่าบริการอื่นๆ</label>
          <input type="text" class="form-control" id="qb-otherLabel" value="${escapeHtml(inv.otherFeeLabel || '')}" />
        </div>

        <div class="form-group">
          <label>ส่วนลด (บาท)</label>
          <input type="number" class="form-control" id="qb-discount" value="${inv.discount || 0}" oninput="recalcQuickBill(true)" />
        </div>
        <div class="form-group" style="grid-column: span 2;">
          <label>ยอดรวมสุทธิ (บาท)</label>
          <input type="number" class="form-control" id="qb-total" value="${inv.totalAmount}" readonly style="font-weight:800; font-size:16px; color:var(--primary); background:#eff6ff;" />
        </div>

        <div class="form-group full-width">
          <label>หมายเหตุเพิ่มเติมในใบแจ้งหนี้</label>
          <input type="text" class="form-control" id="qb-note" value="${escapeHtml(inv.note || '')}" />
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveQuickBill('${u.id}', '${inv.id || ''}', ${inv.waterRate}, ${inv.electricRate})">💾 บันทึกและดูใบแจ้งหนี้ A5</button>
    `
  });

  window.__qbRates = {
    wType: inv.waterBillingType,
    wRate: Number(inv.waterRate || 0),
    eType: inv.electricBillingType,
    eRate: Number(inv.electricRate || 0)
  };
}

function recalcQuickBill(manualAmountOnly = false) {
  const r = window.__qbRates || {};
  const s = appState.settings || {};
  const wPrev = Number(document.getElementById('qb-wPrev').value || 0);
  const wCurr = Number(document.getElementById('qb-wCurr').value || 0);
  const ePrev = Number(document.getElementById('qb-ePrev').value || 0);
  const eCurr = Number(document.getElementById('qb-eCurr').value || 0);

  if (!manualAmountOnly) {
    if (r.wType === 'meter') {
      const units = Math.max(0, wCurr - wPrev);
      let amt = units * r.wRate;
      const minW = Number(s.waterMinCharge || 0);
      if (minW > 0 && amt < minW) amt = minW;
      document.getElementById('qb-wAmt').value = Math.round(amt * 100) / 100;
    }
    if (r.eType === 'meter') {
      const units = Math.max(0, eCurr - ePrev);
      let amt = units * r.eRate;
      const minE = Number(s.electricMinCharge || 0);
      if (minE > 0 && amt < minE) amt = minE;
      document.getElementById('qb-eAmt').value = Math.round(amt * 100) / 100;
    }
  }

  const rent = Number(document.getElementById('qb-rent').value || 0);
  const wAmt = Number(document.getElementById('qb-wAmt').value || 0);
  const eAmt = Number(document.getElementById('qb-eAmt').value || 0);
  const common = Number(document.getElementById('qb-common').value || 0);
  const other = Number(document.getElementById('qb-other').value || 0);
  const discount = Number(document.getElementById('qb-discount').value || 0);
  document.getElementById('qb-total').value = Math.max(0, rent + wAmt + eAmt + common + other - discount);
}

async function saveQuickBill(unitId, existingId, wRate, eRate) {
  const u = (appState.units || []).find(x => x.id === unitId) || {};
  const tenant = (appState.tenants || []).find(t => t.unitId === unitId && t.status === 'active') || {};
  const existing = existingId ? (appState.invoices || []).find(i => i.id === existingId) : null;

  const wPrev = Number(document.getElementById('qb-wPrev').value || 0);
  const wCurr = Number(document.getElementById('qb-wCurr').value || 0);
  const ePrev = Number(document.getElementById('qb-ePrev').value || 0);
  const eCurr = Number(document.getElementById('qb-eCurr').value || 0);

  const payload = {
    ...(existing || {}),
    id: existingId || undefined,
    billingMonth: document.getElementById('qb-month').value,
    issueDate: document.getElementById('qb-issueDate').value,
    dueDate: document.getElementById('qb-dueDate').value,
    unitId: u.id,
    unitCode: u.code,
    unitName: u.name,
    unitCategory: u.category,
    unitZone: u.zone,
    tenantId: tenant.id || '',
    tenantName: document.getElementById('qb-tenantName').value,
    tenantPhone: tenant.phone || '',
    rentAmount: Number(document.getElementById('qb-rent').value || 0),
    waterBillingType: u.waterBillingType || 'meter',
    waterPrevMeter: wPrev,
    waterCurrMeter: wCurr,
    waterUnits: Math.max(0, wCurr - wPrev),
    waterRate: Number(wRate || 0),
    waterAmount: Number(document.getElementById('qb-wAmt').value || 0),
    electricBillingType: u.electricBillingType || 'meter',
    electricPrevMeter: ePrev,
    electricCurrMeter: eCurr,
    electricUnits: Math.max(0, eCurr - ePrev),
    electricRate: Number(eRate || 0),
    electricAmount: Number(document.getElementById('qb-eAmt').value || 0),
    commonFee: Number(document.getElementById('qb-common').value || 0),
    otherFee: Number(document.getElementById('qb-other').value || 0),
    otherFeeLabel: document.getElementById('qb-otherLabel').value,
    discount: Number(document.getElementById('qb-discount').value || 0),
    totalAmount: Number(document.getElementById('qb-total').value || 0),
    status: document.getElementById('qb-status').value,
    note: document.getElementById('qb-note').value
  };

  if (payload.status === 'paid' && !payload.paidDate) {
    payload.paidDate = new Date().toISOString().slice(0, 10);
    payload.paidAmount = payload.totalAmount;
  }

  await apiPost('/api/invoices', payload);
  closeModal();
  renderCurrentTab();

  const saved = (appState.invoices || []).find(
    i => i.unitId === u.id && i.billingMonth === payload.billingMonth
  );
  if (saved) {
    openA5PreviewModal(saved.id, saved.status === 'paid' ? 'receipt' : 'invoice');
  }
}

function openPaymentModal(invoiceId) {
  const inv = (appState.invoices || []).find(i => i.id === invoiceId);
  if (!inv) return;
  const today = new Date().toISOString().slice(0, 10);
  const existingLateFee = Number(inv.lateFee || 0);
  const baseWithoutLate = Math.max(0, Number(inv.totalAmount || 0) - existingLateFee);
  const alreadyPaid = inv.status === 'partial' ? Number(inv.paidAmount || 0) : 0;
  const remaining = Math.max(0, Number(inv.totalAmount || 0) - alreadyPaid);

  showModal({
    title: `บันทึกการรับชำระเงิน: ${inv.unitCode} (${inv.invoiceNo || 'ร่าง'})`,
    bodyHtml: `
      <form class="form-grid">
        <div class="form-group">
          <label>ผู้เช่า</label>
          <input type="text" class="form-control" value="${escapeHtml(inv.tenantName)}" readonly />
        </div>
        <div class="form-group">
          <label>ยอดบิลเดิม (บาท)</label>
          <input type="text" class="form-control" value="฿${formatMoney(baseWithoutLate)}" readonly style="font-weight:700;" />
        </div>
        <div class="form-group">
          <label>ค่าปรับชำระล่าช้า (บาท)</label>
          <input type="number" class="form-control" id="pay-late-fee" value="${existingLateFee}" min="0" oninput="recalcPaymentModalPreview(${baseWithoutLate}, ${alreadyPaid})" />
        </div>
        <div class="form-group">
          <label>ยอดสุทธิที่ต้องชำระรวม${alreadyPaid > 0 ? ` (จ่ายมาแล้ว ฿${formatMoney(alreadyPaid)})` : ''}</label>
          <input type="text" class="form-control" id="pay-net-due" value="฿${formatMoney(remaining)}" readonly style="font-weight:800; color:#1d4ed8; background:#eff6ff;" />
        </div>
        <div class="form-group">
          <label>วันที่รับชำระเงิน</label>
          <input type="date" class="form-control" id="pay-date" value="${today}" />
        </div>
        <div class="form-group">
          <label>ยอดเงินที่รับชำระครั้งนี้ (บาท) <small style="color:#64748b;">(ใส่ต่ำกว่ายอดเพื่อชำระบางส่วน)</small></label>
          <input type="number" class="form-control" id="pay-amount" value="${remaining}" min="0" oninput="recalcPaymentModalPreview(${baseWithoutLate}, ${alreadyPaid}, true)" style="font-weight:800; border-color:#16a34a;" />
        </div>
        <div class="form-group" style="grid-column: 1 / -1;">
          <div id="pay-status-preview" style="padding:8px 12px; border-radius:8px; font-size:13px; font-weight:700; background:#dcfce7; color:#166534;">
            ✓ ชำระครบเต็มจำนวน (เปลี่ยนสถานะเป็น "ชำระแล้ว" และออกใบเสร็จ A5)
          </div>
        </div>
        <div class="form-group">
          <label>ช่องทางการชำระเงิน</label>
          <select class="form-control" id="pay-method">
            <option value="transfer">โอนเงินธนาคาร / สแกน QR พร้อมเพย์</option>
            <option value="cash">เงินสด</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div class="form-group">
          <label>หมายเหตุการรับเงิน (เช่น เวลาโอน / เลขสลิป)</label>
          <input type="text" class="form-control" id="pay-note" value="${escapeHtml(inv.paymentNote || '')}" placeholder="เช่น โอนเข้ากสิกรไทย 14:20 น." />
        </div>
      </form>
    `,
    footerHtml: `
      ${alreadyPaid > 0 ? `<button class="btn btn-outline" style="color:#dc2626; margin-right:auto;" onclick="revertInvoicePayment('${inv.id}', true)">↩️ ยกเลิกการชำระก่อนหน้า</button>` : ''}
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-success" onclick="confirmPayment('${inv.id}')">✓ ยืนยันรับชำระเงิน</button>
    `
  });
}

function recalcPaymentModalPreview(baseWithoutLate, alreadyPaid, fromAmount = false) {
  const lateFee = Math.max(0, Number(document.getElementById('pay-late-fee')?.value || 0));
  const totalWithLate = baseWithoutLate + lateFee;
  const remaining = Math.max(0, totalWithLate - alreadyPaid);
  const netEl = document.getElementById('pay-net-due');
  if (netEl) netEl.value = `฿${formatMoney(remaining)}`;

  const amtEl = document.getElementById('pay-amount');
  if (!fromAmount && amtEl) {
    amtEl.value = remaining;
  }
  const payNow = Math.max(0, Number(amtEl?.value || 0));
  const afterRemaining = Math.max(0, remaining - payNow);
  const previewEl = document.getElementById('pay-status-preview');
  if (!previewEl) return;

  if (payNow <= 0) {
    previewEl.style.background = '#fee2e2';
    previewEl.style.color = '#991b1b';
    previewEl.textContent = '⚠️ กรุณาระบุยอดเงินที่รับชำระมากกว่า 0 บาท';
  } else if (afterRemaining > 0) {
    previewEl.style.background = '#fef3c7';
    previewEl.style.color = '#92400e';
    previewEl.textContent = `🌓 ชำระบางส่วน (Partial): รับครั้งนี้ ฿${formatMoney(payNow)} • รวมจ่ายแล้ว ฿${formatMoney(alreadyPaid + payNow)} • คงเหลือค้างชำระ ฿${formatMoney(afterRemaining)}`;
  } else {
    previewEl.style.background = '#dcfce7';
    previewEl.style.color = '#166534';
    previewEl.textContent = '✓ ชำระครบเต็มจำนวน (เปลี่ยนสถานะเป็น "ชำระแล้ว" และออกใบเสร็จ A5)';
  }
}

async function confirmPayment(invoiceId) {
  const inv = (appState.invoices || []).find(i => i.id === invoiceId);
  if (!inv) return;
  const paidDate = document.getElementById('pay-date').value;
  const lateFee = Math.max(0, Number(document.getElementById('pay-late-fee')?.value || 0));
  const payNow = Math.max(0, Number(document.getElementById('pay-amount').value || 0));
  if (payNow <= 0) {
    showToast('กรุณาระบุยอดเงินที่รับชำระมากกว่า 0 บาท', 'error');
    return;
  }
  const paymentMethod = document.getElementById('pay-method').value;
  const paymentNote = document.getElementById('pay-note').value;

  const prevLateFee = Number(inv.lateFee || 0);
  const baseWithoutLate = Math.max(0, Number(inv.totalAmount || 0) - prevLateFee);
  const newTotalAmount = baseWithoutLate + lateFee;
  const prevPaid = inv.status === 'partial' ? Number(inv.paidAmount || 0) : 0;
  const cumulativePaid = prevPaid + payNow;
  const newStatus = cumulativePaid >= newTotalAmount ? 'paid' : 'partial';

  await apiPost('/api/invoices', {
    ...inv,
    lateFee,
    totalAmount: newTotalAmount,
    status: newStatus,
    paidDate,
    paidAmount: cumulativePaid,
    paymentMethod,
    paymentNote
  });
  closeModal();
  await fetchState();
  renderCurrentTab();
  if (newStatus === 'paid') {
    showToast('บันทึกรับชำระเงินครบถ้วนและสร้างใบเสร็จรับเงินขนาด A5 เรียบร้อยแล้ว');
    openA5PreviewModal(invoiceId, 'receipt');
  } else {
    const left = Math.max(0, newTotalAmount - cumulativePaid);
    showToast(`🌓 บันทึกรับชำระบางส่วน ฿${formatMoney(payNow)} เรียบร้อยแล้ว (คงเหลือค้างชำระ ฿${formatMoney(left)})`);
  }
}

async function revertInvoicePayment(invoiceId, fromModal = false) {
  const inv = (appState.invoices || []).find(i => i.id === invoiceId);
  if (!inv) return;
  if (!confirm(`ยืนยันยกเลิกการรับชำระเงินของห้อง ${inv.unitCode} (${inv.invoiceNo || ''}) และย้อนกลับเป็นสถานะ "รอชำระ" ใช่หรือไม่?\n(รายการรายรับในบัญชีของบิลนี้จะถูกลบออกอัตโนมัติ)`)) {
    return;
  }
  await apiPost('/api/invoices', {
    ...inv,
    status: 'unpaid',
    paidDate: '',
    paidAmount: 0,
    receiptNo: ''
  });
  if (fromModal) closeModal();
  await fetchState();
  renderCurrentTab();
  showToast(`↩️ ยกเลิกการรับชำระห้อง ${inv.unitCode} และอัปเดตยอดบัญชีเรียบร้อยแล้ว`);
}

async function confirmDeleteInvoice(invoiceId) {
  if (!confirm('ยืนยันการลบใบแจ้งหนี้นี้?')) return;
  await apiPost('/api/invoices/delete', { id: invoiceId });
  renderCurrentTab();
  showToast('ลบใบแจ้งหนี้แล้ว');
}

// ============================================================================
// A5 INVOICE & RECEIPT STUDIO (EXACT 148x210mm / 210x148mm / 2-UP A4)
// ============================================================================
let activeA5PreviewState = {
  invoiceIds: [],
  docMode: 'invoice', // 'invoice' | 'receipt'
  layoutMode: 'portrait' // 'portrait' (148x210mm) | 'landscape' (210x148mm) | '2up-a4' (Original + Copy on A4)
};

// ============================================================================
// REAL THAI PROMPTPAY EMVCo + ISO/IEC 18004 QR CODE GENERATOR (100% OFFLINE)
// ============================================================================
const QR_GF_EXP = new Uint8Array(512);
const QR_GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_GF_EXP[i] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    QR_GF_EXP[i] = QR_GF_EXP[i - 255];
  }
})();

function qrGfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
}

function qrRsEncode(dataBytes, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const root = QR_GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= qrGfMul(gen[j], root);
    }
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= qrGfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

// ISO/IEC 18004 Level L capacities & block structure (Versions 1 to 8)
const QR_VER_L = [
  null,
  { ecPerBlock: 7, blocks: [19], align: [] },
  { ecPerBlock: 10, blocks: [34], align: [6, 18] },
  { ecPerBlock: 15, blocks: [55], align: [6, 22] },
  { ecPerBlock: 20, blocks: [80], align: [6, 26] },
  { ecPerBlock: 26, blocks: [108], align: [6, 30] },
  { ecPerBlock: 18, blocks: [68, 68], align: [6, 34] },
  { ecPerBlock: 20, blocks: [78, 78], align: [6, 22, 38] },
  { ecPerBlock: 24, blocks: [97, 97], align: [6, 24, 42] }
];

function crc16PromptPay(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xff) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, val) {
  const s = String(val);
  return id + String(s.length).padStart(2, '0') + s;
}

function buildPromptPayEmvPayload(rawId, amount) {
  const digits = String(rawId || '').replace(/[^0-9]/g, '');
  if (!digits) return '';

  let targetSubTag = '';
  if (digits.length >= 15) {
    targetSubTag = emvField('03', digits.slice(0, 15));
  } else if (digits.length === 13) {
    targetSubTag = emvField('02', digits);
  } else {
    const phone9 = digits.startsWith('0') ? digits.slice(1) : digits;
    targetSubTag = emvField('01', '0066' + phone9);
  }

  const merchantInfo = emvField('00', 'A000000677010111') + targetSubTag;
  const numAmount = Number(amount || 0);
  const hasAmount = numAmount > 0;

  let payload =
    emvField('00', '01') +
    emvField('01', hasAmount ? '12' : '11') +
    emvField('29', merchantInfo) +
    emvField('58', 'TH') +
    emvField('53', '764');

  if (hasAmount) {
    payload += emvField('54', numAmount.toFixed(2));
  }

  payload += '6304';
  payload += crc16PromptPay(payload);
  return payload;
}

function qrMaskCond(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function qrFormatBits(ecLevelBits, mask) {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function generatePromptPaySvg(promptPayId, amount) {
  const payload = buildPromptPayEmvPayload(promptPayId || '0000000000', amount);
  const utf8Bytes = [];
  for (let i = 0; i < payload.length; i++) {
    utf8Bytes.push(payload.charCodeAt(i) & 0xff);
  }

  let version = 1;
  while (version < 8) {
    const cap = QR_VER_L[version].blocks.reduce((a, b) => a + b, 0);
    if (utf8Bytes.length + 2 <= cap) break;
    version++;
  }

  const vInfo = QR_VER_L[version];
  const totalDataCodewords = vInfo.blocks.reduce((a, b) => a + b, 0);

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(utf8Bytes.length, 8);
  for (const b of utf8Bytes) pushBits(b, 8);

  const maxBits = totalDataCodewords * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }

  let padToggle = true;
  while (dataCodewords.length < totalDataCodewords) {
    dataCodewords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const bLen of vInfo.blocks) {
    const block = dataCodewords.slice(offset, offset + bLen);
    offset += bLen;
    dataBlocks.push(block);
    ecBlocks.push(qrRsEncode(block, vInfo.ecPerBlock));
  }

  const finalCodewords = [];
  const maxDataLen = Math.max(...vInfo.blocks);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < vInfo.ecPerBlock; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFn = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  const drawFinder = (topR, leftC) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(r, c, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (const ar of vInfo.align) {
    for (const ac of vInfo.align) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(ar + dr, ac + dc, dist === 2 || dist === 0);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFn(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFn(i, 6, i % 2 === 0);
  }

  setFn(4 * version + 9, 8, true);
  for (let i = 0; i <= 8; i++) {
    reserved[8][i] = 1;
    reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  const allBits = [];
  for (const cw of finalCodewords) {
    for (let b = 7; b >= 0; b--) allBits.push((cw >>> b) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!reserved[r][c]) {
          grid[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  const applyFormat = (targetGrid, mask) => {
    const fBits = qrFormatBits(0b01, mask); // 0b01 = Level L
    const tlCoords = [
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
      [7, 8], [8, 8], [8, 7],
      [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]
    ];
    for (let i = 0; i < 15; i++) {
      const [r, c] = tlCoords[i];
      targetGrid[r][c] = (fBits >>> i) & 1;
    }
    for (let i = 0; i < 8; i++) {
      targetGrid[8][size - 1 - i] = (fBits >>> i) & 1;
    }
    for (let i = 8; i < 15; i++) {
      targetGrid[size - 15 + i][8] = (fBits >>> i) & 1;
    }
  };

  let bestScore = Infinity;
  let bestGrid = null;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map(row => new Uint8Array(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && qrMaskCond(mask, r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    applyFormat(candidate, mask);

    let penalty = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (candidate[r][c] === candidate[r][c - 1]) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else {
          run = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (candidate[r][c] === candidate[r - 1][c]) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else {
          run = 1;
        }
      }
    }
    if (penalty < bestScore) {
      bestScore = penalty;
      bestGrid = candidate;
    }
  }

  const quiet = 3;
  const fullSize = size + quiet * 2;
  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bestGrid[r][c]) {
        pathData += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }

  return `<svg viewBox="0 0 ${fullSize} ${fullSize}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${fullSize}" height="${fullSize}" fill="#ffffff"/><path d="${pathData}" fill="#000000"/></svg>`;
}

function buildSingleA5InnerHtml(inv, docMode = 'invoice', copyLabel = 'ต้นฉบับ / Original') {
  const s = appState.settings || {};
  const isReceipt = docMode === 'receipt';
  const docTitle = isReceipt ? 'ใบเสร็จรับเงิน / RECEIPT' : 'ใบแจ้งหนี้ / INVOICE';
  const docNo = isReceipt ? (inv.receiptNo || inv.invoiceNo) : inv.invoiceNo;
  const docDate = isReceipt ? formatDateThai(inv.paidDate || inv.issueDate) : formatDateThai(inv.issueDate);
  const unitTypeLabel = inv.unitCategory === 'house' ? 'บ้านเช่าเป็นหลัง' : 'ห้องเช่า/อพาร์ตเมนต์';

  const isWaterMinApplied = inv.waterBillingType === 'meter' && Number(inv.waterAmount) > ((Number(inv.waterUnits) || 0) * (Number(inv.waterRate) || 0));
  const isElecMinApplied = inv.electricBillingType === 'meter' && Number(inv.electricAmount) > ((Number(inv.electricUnits) || 0) * (Number(inv.electricRate) || 0));

  const waterDetail = inv.waterBillingType === 'direct'
    ? `ค่าน้ำประปา (ผู้เช่าจ่ายตรงกับหน่วยงาน ไม่คิดเพิ่ม)`
    : inv.waterBillingType === 'actual_bill'
    ? `ค่าน้ำประปา (ตามบิลการประปา มิเตอร์ ${inv.waterPrevMeter} → ${inv.waterCurrMeter})`
    : inv.waterBillingType === 'flat'
    ? `ค่าน้ำประปา (เหมาจ่ายรายเดือน)`
    : isWaterMinApplied
    ? `ค่าน้ำประปา (มิเตอร์ ${inv.waterPrevMeter} → ${inv.waterCurrMeter} = ${inv.waterUnits} หน่วย • อัตราขั้นต่ำ ${formatMoney(inv.waterAmount)} บ.)`
    : `ค่าน้ำประปา (มิเตอร์ ${inv.waterPrevMeter} → ${inv.waterCurrMeter} = ${inv.waterUnits} หน่วย × ${inv.waterRate} บ.)`;

  const elecDetail = inv.electricBillingType === 'direct'
    ? `ค่าไฟฟ้า (ผู้เช่าจ่ายตรงกับหน่วยงาน ไม่คิดเพิ่ม)`
    : inv.electricBillingType === 'actual_bill'
    ? `ค่าไฟฟ้า (ตามบิลการไฟฟ้า มิเตอร์ ${inv.electricPrevMeter} → ${inv.electricCurrMeter})`
    : inv.electricBillingType === 'flat'
    ? `ค่าไฟฟ้า (เหมาจ่ายรายเดือน)`
    : isElecMinApplied
    ? `ค่าไฟฟ้า (มิเตอร์ ${inv.electricPrevMeter} → ${inv.electricCurrMeter} = ${inv.electricUnits} หน่วย • อัตราขั้นต่ำ ${formatMoney(inv.electricAmount)} บ.)`
    : `ค่าไฟฟ้า (มิเตอร์ ${inv.electricPrevMeter} → ${inv.electricCurrMeter} = ${inv.electricUnits} หน่วย × ${inv.electricRate} บ.)`;

  let itemRows = `
    <tr>
      <td class="text-center">1</td>
      <td>ค่าเช่า${inv.unitCategory === 'house' ? 'บ้าน' : 'ห้องพัก'}ประจำเดือน ${formatMonthThai(inv.billingMonth)} (${escapeHtml(inv.unitCode)})</td>
      <td class="text-center">1 เดือน</td>
      <td class="text-right">${formatMoney(inv.rentAmount)}</td>
      <td class="text-right"><strong>${formatMoney(inv.rentAmount)}</strong></td>
    </tr>
    <tr>
      <td class="text-center">2</td>
      <td>${escapeHtml(waterDetail)}</td>
      <td class="text-center">${inv.waterBillingType === 'direct' ? '-' : `${inv.waterUnits || 1} หน่วย`}</td>
      <td class="text-right">${inv.waterBillingType === 'direct' ? '-' : (inv.waterRate ? formatMoney(inv.waterRate) : '-')}</td>
      <td class="text-right"><strong>${formatMoney(inv.waterAmount)}</strong></td>
    </tr>
    <tr>
      <td class="text-center">3</td>
      <td>${escapeHtml(elecDetail)}</td>
      <td class="text-center">${inv.electricBillingType === 'direct' ? '-' : `${inv.electricUnits || 1} หน่วย`}</td>
      <td class="text-right">${inv.electricBillingType === 'direct' ? '-' : (inv.electricRate ? formatMoney(inv.electricRate) : '-')}</td>
      <td class="text-right"><strong>${formatMoney(inv.electricAmount)}</strong></td>
    </tr>
  `;

  let nextIdx = 4;
  if (Number(inv.commonFee || 0) > 0) {
    itemRows += `
      <tr>
        <td class="text-center">${nextIdx++}</td>
        <td>ค่าส่วนกลาง / ค่าขยะประจำเดือน</td>
        <td class="text-center">1 รายการ</td>
        <td class="text-right">${formatMoney(inv.commonFee)}</td>
        <td class="text-right"><strong>${formatMoney(inv.commonFee)}</strong></td>
      </tr>
    `;
  }
  if (Number(inv.otherFee || 0) > 0) {
    itemRows += `
      <tr>
        <td class="text-center">${nextIdx++}</td>
        <td>${escapeHtml(inv.otherFeeLabel || 'ค่าบริการอื่นๆ')}</td>
        <td class="text-center">1 รายการ</td>
        <td class="text-right">${formatMoney(inv.otherFee)}</td>
        <td class="text-right"><strong>${formatMoney(inv.otherFee)}</strong></td>
      </tr>
    `;
  }
  if (Number(inv.discount || 0) > 0) {
    itemRows += `
      <tr>
        <td class="text-center">${nextIdx++}</td>
        <td>หักส่วนลดพิเศษ</td>
        <td class="text-center">-</td>
        <td class="text-right">-${formatMoney(inv.discount)}</td>
        <td class="text-right"><strong>-${formatMoney(inv.discount)}</strong></td>
      </tr>
    `;
  }

  const footerNote = isReceipt
    ? (s.receiptNote || 'ได้รับชำระเงินเรียบร้อยแล้ว ขอบคุณที่ใช้บริการ')
    : (s.invoiceNote || 'กรุณาชำระเงินภายในกำหนด');

  return `
    <div>
      <div class="doc-header">
        <div style="display:flex; align-items:center; gap:10px;">
          ${s.logoDataUrl ? `<img src="${s.logoDataUrl}" alt="Logo" style="width:42px; height:42px; object-fit:contain; border-radius:6px; flex-shrink:0;" />` : ''}
          <div>
            <div class="doc-biz-name">${escapeHtml(s.businessName || 'กิจการบ้านเช่าและห้องเช่า')}</div>
            <div class="doc-biz-info">${escapeHtml(s.address || '')}</div>
            <div class="doc-biz-info">โทร: ${escapeHtml(s.phone || '-')} ${s.taxId ? `| เลขประจำตัวผู้เสียภาษี: ${escapeHtml(s.taxId)}` : ''}</div>
          </div>
        </div>
        <div class="doc-title-box">
          <div class="doc-type-badge" style="background:${isReceipt ? '#15803d' : '#0f172a'}">${docTitle}</div>
          <div class="doc-copy-tag">${escapeHtml(copyLabel)} • ขนาด A5</div>
        </div>
      </div>

      <div class="doc-meta-grid">
        <div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">${inv.unitCategory === 'house' ? 'บ้านเลขที่:' : 'เลขห้อง:'}</span>
            <strong style="font-size:12.5px;">${escapeHtml(inv.unitCode)} (${unitTypeLabel})</strong>
          </div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">ชื่อผู้เช่า:</span>
            <span>${escapeHtml(inv.tenantName || '-')} ${inv.tenantPhone ? `(${escapeHtml(inv.tenantPhone)})` : ''}</span>
          </div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">โครงการ/โซน:</span>
            <span>${escapeHtml(inv.unitZone || '-')}</span>
          </div>
        </div>
        <div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">เลขที่เอกสาร:</span>
            <strong>${escapeHtml(docNo)}</strong>
          </div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">${isReceipt ? 'วันที่รับเงิน:' : 'วันที่ออกบิล:'}</span>
            <span>${docDate}</span>
          </div>
          <div class="doc-meta-row">
            <span class="doc-meta-label">${isReceipt ? 'วิธีชำระเงิน:' : 'ครบกำหนดชำระ:'}</span>
            <strong>${isReceipt ? (inv.paymentMethod === 'cash' ? 'เงินสด' : 'โอนเงิน/พร้อมเพย์') : formatDateThai(inv.dueDate)}</strong>
          </div>
        </div>
      </div>

      <table class="doc-table">
        <thead>
          <tr>
            <th class="text-center" style="width:32px;">ลำดับ</th>
            <th>รายการ (Description)</th>
            <th class="text-center" style="width:68px;">จำนวน</th>
            <th class="text-right" style="width:68px;">ราคา/หน่วย</th>
            <th class="text-right" style="width:82px;">จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr class="doc-summary-row">
            <td colspan="3" class="doc-baht-text">ตัวอักษร: (${thaiBahtText(inv.totalAmount)})</td>
            <td class="text-right">ยอดรวมสุทธิ</td>
            <td class="text-right">฿${formatMoney(inv.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      ${inv.note ? `<div style="font-size:10.5px; margin-bottom:5px; color:#334155;"><strong>หมายเหตุบิล:</strong> ${escapeHtml(inv.note)}</div>` : ''}
    </div>

    <div>
      <div class="doc-bottom-section">
        <div class="doc-payment-box">
          ${s.showPromptPayQr !== false && s.promptPayId ? `
            <div class="doc-qr-box">
              ${generatePromptPaySvg(s.promptPayId, inv.totalAmount)}
            </div>
          ` : ''}
          <div style="font-size:10px; line-height:1.35;">
            <div style="font-weight:800; color:#0f172a;">ช่องทางชำระเงิน / โอนเงินธนาคาร:</div>
            <div><strong>${escapeHtml(s.bankName || '-')}</strong> เลขบัญชี: <strong>${escapeHtml(s.bankAccountNo || '-')}</strong></div>
            <div>ชื่อบัญชี: ${escapeHtml(s.bankAccountName || '-')} ${s.promptPayId ? `| พร้อมเพย์: <strong>${escapeHtml(s.promptPayId)}</strong>` : ''}</div>
            <div style="color:#475569; margin-top:2px;">${escapeHtml(footerNote)}</div>
          </div>
        </div>

        <div class="doc-signatures">
          <div>
            <div class="sig-line"></div>
            <div>ผู้แจ้งหนี้ / ผู้รับเงิน</div>
            <div>วันที่ ....../....../......</div>
          </div>
          <div>
            <div class="sig-line"></div>
            <div>ผู้เช่า / ผู้ชำระเงิน</div>
            <div>วันที่ ....../....../......</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderA5SheetsHtml(invoiceIds, docMode, layoutMode) {
  const invoices = invoiceIds
    .map(id => (appState.invoices || []).find(i => i.id === id))
    .filter(Boolean);

  if (invoices.length === 0) return '<p style="color:#fff">ไม่พบข้อมูลใบแจ้งหนี้</p>';

  // Update dynamic @page size rule for printer
  const styleEl = document.getElementById('dynamic-print-page-style');
  if (styleEl) {
    if (layoutMode === 'landscape') {
      styleEl.innerHTML = `@page { size: 210mm 148mm; margin: 0mm; }`;
    } else if (layoutMode === '2up-a4') {
      styleEl.innerHTML = `@page { size: 210mm 297mm; margin: 0mm; }`;
    } else {
      styleEl.innerHTML = `@page { size: 148mm 210mm; margin: 0mm; }`;
    }
  }

  return invoices.map(inv => {
    if (layoutMode === '2up-a4') {
      return `
        <div class="a4-2up-sheet">
          <div class="a4-2up-half">
            ${buildSingleA5InnerHtml(inv, docMode, 'ต้นฉบับ (สำหรับผู้เช่า)')}
          </div>
          <div class="a4-cut-line"><span>✂ เส้นตัดครึ่งกระดาษ A4 (ได้ขนาด A5 จำนวน 2 ใบ)</span></div>
          <div class="a4-2up-half">
            ${buildSingleA5InnerHtml(inv, docMode, 'สำเนา (สำหรับผู้ให้เช่า)')}
          </div>
        </div>
      `;
    }

    const orientationClass = layoutMode === 'landscape' ? 'a5-landscape' : '';
    return `
      <div class="a5-sheet ${orientationClass}">
        ${buildSingleA5InnerHtml(inv, docMode, 'ต้นฉบับ / Original')}
      </div>
    `;
  }).join('');
}

function openA5PreviewModal(invoiceId, defaultDocMode = 'invoice') {
  const s = appState.settings || {};
  activeA5PreviewState = {
    invoiceIds: [invoiceId],
    docMode: defaultDocMode,
    layoutMode: s.a5Orientation || 'portrait'
  };
  renderA5PreviewModalContent();
}

function openBatchA5PreviewModal() {
  const invoices = filterByCategory(appState.invoices || [], i => i.unitCategory).filter(i => {
    if (selectedBillingMonth && i.billingMonth !== selectedBillingMonth) return false;
    if (invoiceStatusFilter !== 'all' && i.status !== invoiceStatusFilter) return false;
    if (selectedZoneFilter !== 'all' && (i.unitZone || '') !== selectedZoneFilter) return false;
    return true;
  });
  if (invoices.length === 0) {
    showToast('ไม่มีใบแจ้งหนี้ในเงื่อนไขที่เลือก', 'error');
    return;
  }
  const s = appState.settings || {};
  activeA5PreviewState = {
    invoiceIds: invoices.map(i => i.id),
    docMode: 'invoice',
    layoutMode: s.a5Orientation || 'portrait'
  };
  renderA5PreviewModalContent();
}

function renderA5PreviewModalContent() {
  const { invoiceIds, docMode, layoutMode } = activeA5PreviewState;
  const sheetsHtml = renderA5SheetsHtml(invoiceIds, docMode, layoutMode);

  showModal({
    title: `🖨️ ตัวอย่างก่อนพิมพ์ขนาด A5 (${invoiceIds.length} รายการ)`,
    xl: true,
    bodyHtml: `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; flex-wrap:wrap; background:#f8fafc; padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <label style="font-weight:700; font-size:13px;">ประเภทเอกสาร:</label>
          <select class="form-control" style="width:190px;" onchange="activeA5PreviewState.docMode=this.value; renderA5PreviewModalContent();">
            <option value="invoice" ${docMode === 'invoice' ? 'selected' : ''}>ใบแจ้งหนี้ (Invoice A5)</option>
            <option value="receipt" ${docMode === 'receipt' ? 'selected' : ''}>ใบเสร็จรับเงิน (Receipt A5)</option>
          </select>

          <label style="font-weight:700; font-size:13px; margin-left:8px;">รูปแบบกระดาษ A5:</label>
          <select class="form-control" style="width:275px;" onchange="activeA5PreviewState.layoutMode=this.value; renderA5PreviewModalContent();">
            <option value="portrait" ${layoutMode === 'portrait' ? 'selected' : ''}>📄 A5 แนวตั้ง (148 × 210 มม.)</option>
            <option value="landscape" ${layoutMode === 'landscape' ? 'selected' : ''}>📄 A5 แนวนอน (210 × 148 มม.)</option>
            <option value="2up-a4" ${layoutMode === '2up-a4' ? 'selected' : ''}>✂️ A5 คู่ บนกระดาษ A4 (ต้นฉบับ+สำเนา)</option>
          </select>
        </div>

        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline" onclick="exportA5Pdf()">📥 บันทึกเป็นไฟล์ PDF (ขนาด A5)</button>
          <button class="btn btn-primary" onclick="triggerPrintA5()">🖨️ สั่งพิมพ์ออกเครื่องปริ้นท์ (Print A5)</button>
        </div>
      </div>

      <div class="a5-preview-stage" id="a5-stage-container">
        ${sheetsHtml}
      </div>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ปิดหน้าต่าง</button>
      <button class="btn btn-primary" onclick="triggerPrintA5()">🖨️ พิมพ์ทันที</button>
    `
  });
}

function triggerPrintA5() {
  const { invoiceIds, docMode, layoutMode } = activeA5PreviewState;
  const printMount = document.getElementById('print-mount');
  printMount.innerHTML = renderA5SheetsHtml(invoiceIds, docMode, layoutMode);
  window.print();
}

async function exportA5Pdf() {
  const { invoiceIds, docMode, layoutMode } = activeA5PreviewState;
  const printMount = document.getElementById('print-mount');
  printMount.innerHTML = renderA5SheetsHtml(invoiceIds, docMode, layoutMode);

  if (window.electronAPI && window.electronAPI.exportPdf) {
    const firstInv = (appState.invoices || []).find(i => i.id === invoiceIds[0]);
    const prefix = docMode === 'receipt' ? 'ใบเสร็จรับเงิน-A5' : 'ใบแจ้งหนี้-A5';
    const filename = firstInv && invoiceIds.length === 1
      ? `${prefix}-${firstInv.unitCode}-${firstInv.billingMonth}.pdf`
      : `${prefix}-รวม-${selectedBillingMonth}.pdf`;

    // Temporarily show print mount for PDF capture
    document.body.classList.add('printing-pdf');
    printMount.style.display = 'block';
    document.querySelector('.app-layout').style.display = 'none';
    document.getElementById('app-modal').style.display = 'none';

    try {
      const res = await window.electronAPI.exportPdf({ filename, layoutMode });
      if (res && res.ok) {
        showToast(`บันทึกไฟล์ PDF ขนาด A5 เรียบร้อยแล้ว`);
      }
    } finally {
      printMount.style.display = '';
      document.querySelector('.app-layout').style.display = '';
      document.getElementById('app-modal').style.display = '';
      document.body.classList.remove('printing-pdf');
    }
  } else {
    // In browser fallback, trigger native Save as PDF via print dialog
    window.print();
  }
}

// ----------------------------------------------------------------------------
// RENTAL CONTRACT PREVIEW, LIVE ON-PAPER EDITOR & TEMPLATE SETTINGS
// ----------------------------------------------------------------------------
function getDefaultContractTermsText() {
  return `5.1 ผู้เช่าตกลงจะดูแลรักษาห้องพักและทรัพย์สินให้อยู่ในสภาพดี ห้ามต่อเติม ดัดแปลง หรือตอกตะปูบนผนังโดยไม่ได้รับอนุญาตจากผู้ให้เช่า
5.2 ห้ามส่งเสียงดังรบกวนผู้พักอาศัยห้องข้างเคียง และห้ามนำสิ่งผิดกฎหมายหรือวัตถุอันตรายเข้ามาในบริเวณอาคารโดยเด็ดขาด
5.3 กรณีผู้เช่าประสงค์จะย้ายออก ต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าอย่างน้อย 30 วัน`;
}

function buildDefaultContractInnerHtml(t, u, s, paperSize = 'a4') {
  const propLabel = u.category === 'house' ? 'บ้านเช่า' : 'ห้องเช่า';
  const titleText = s.contractTitle || `หนังสือสัญญาเช่า${propLabel}`;
  const placeText = s.contractPlace || s.businessName || 'หอพัก "หาญยิ่ง"';
  const landlordText = s.contractLandlordName || s.bankAccountName || s.businessName || 'ผู้ให้เช่า';
  const witnessText = s.contractWitnessName || '.................................................';
  const today = new Date().toISOString().slice(0, 10);

  const startDateStr = t.contractStartDate ? formatDateThai(t.contractStartDate) : formatDateThai(today);
  const endDateStr = t.contractEndDate ? formatDateThai(t.contractEndDate) : '......................................';
  const tenantNameStr = t.fullName ? escapeHtml(t.fullName) : '....................................................................';
  const idCardStr = t.idCard ? escapeHtml(t.idCard) : '................................................';
  const phoneStr = t.phone ? escapeHtml(t.phone) : '....................................';
  const addrStr = t.permanentAddress ? escapeHtml(t.permanentAddress) : '....................................................................................................................';

  const rentAmt = Number(t.agreedRent ?? u.baseRent ?? 0);
  const depAmt = Number(t.depositAmount ?? u.defaultDeposit ?? 0);
  const commonAmt = Number(u.commonFee ?? 0);
  const wRate = u.customWaterRate !== undefined && u.customWaterRate !== '' ? u.customWaterRate : (s.waterRate ?? 50);
  const eRate = u.customElectricRate !== undefined && u.customElectricRate !== '' ? u.customElectricRate : (s.electricRate ?? 7);
  const initW = t.initialWaterMeter !== undefined && t.initialWaterMeter !== '' ? t.initialWaterMeter : (u.lastWaterMeter ?? 0);
  const initE = t.initialElectricMeter !== undefined && t.initialElectricMeter !== '' ? t.initialElectricMeter : (u.lastElectricMeter ?? 0);

  const rawTerms = (s.contractTermsText !== undefined && s.contractTermsText !== null && String(s.contractTermsText).trim() !== '')
    ? String(s.contractTermsText)
    : getDefaultContractTermsText();
  const termsHtml = rawTerms
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<div style="margin-left:14px; margin-bottom:3px;">${escapeHtml(line)}</div>`)
    .join('');

  const extraNotes = (t.notes || u.notes || '').trim();
  const isA4 = paperSize === 'a4';

  return `
    <div>
      <div style="text-align:center; border-bottom:2px solid #0f172a; padding-bottom:${isA4 ? '10px' : '6px'}; margin-bottom:${isA4 ? '14px' : '8px'};">
        <div style="font-size:${isA4 ? '20px' : '16px'}; font-weight:800; color:#0f172a;">${escapeHtml(titleText)}</div>
        <div style="font-size:${isA4 ? '13.5px' : '11.5px'}; font-weight:600; color:#334155; margin-top:2px;">
          ${escapeHtml(s.businessName || '')}${s.address ? ` • ${escapeHtml(s.address)}` : ''}
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-bottom:${isA4 ? '12px' : '8px'};">
        <div style="text-align:right; font-size:${isA4 ? '13px' : '11px'};">
          <div><strong>ทำที่:</strong> ${escapeHtml(placeText)}</div>
          <div><strong>วันที่ทำสัญญา:</strong> ${startDateStr}</div>
        </div>
      </div>

      <p style="margin-bottom:${isA4 ? '10px' : '6px'}; text-indent:24px; text-align:justify;">
        สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>${escapeHtml(landlordText)}</strong> โทรศัพท์ <strong>${escapeHtml(s.phone || '-')}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า <strong>"ผู้ให้เช่า"</strong> ฝ่ายหนึ่ง กับ <strong>${tenantNameStr}</strong> เลขประจำตัวประชาชน <strong>${idCardStr}</strong> โทรศัพท์ <strong>${phoneStr}</strong> ที่อยู่ตามทะเบียนบ้าน/บัตรประชาชน <strong>${addrStr}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า <strong>"ผู้เช่า"</strong> อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงทำสัญญากันไว้เป็นหลักฐานดังต่อไปนี้:
      </p>

      <p style="margin-bottom:${isA4 ? '8px' : '5px'};">
        <strong>ข้อ 1. ทรัพย์สินที่เช่า:</strong> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่า${propLabel}เลขที่ <strong>${escapeHtml(u.code || '..........')}</strong> (${escapeHtml(getUnitSubtitle(u, u.zone))}) อาคาร/โซน <strong>${escapeHtml(u.zone || '-')}</strong> เพื่อใช้เป็นที่พักอาศัย จำนวนผู้พักอาศัย <strong>${t.occupantCount || 1}</strong> คน
      </p>

      <p style="margin-bottom:${isA4 ? '8px' : '5px'};">
        <strong>ข้อ 2. ระยะเวลาการเช่าและอัตราค่าเช่า:</strong> ตกลงเช่าตั้งแต่วันที่ <strong>${startDateStr}</strong> ถึงวันที่ <strong>${endDateStr}</strong> ในอัตราค่าเช่าเดือนละ <strong>${formatMoney(rentAmt)} บาท (${thaiBahtText(rentAmt)})</strong> โดยผู้เช่าตกลงชำระค่าเช่าและค่าบริการภายในวันที่ <strong>${s.defaultDueDay || 5}</strong> ของทุกเดือน
      </p>

      <p style="margin-bottom:${isA4 ? '8px' : '5px'};">
        <strong>ข้อ 3. เงินประกันการเช่า:</strong> ในวันทำสัญญานี้ ผู้เช่าได้วางเงินประกันการเช่าจำนวน <strong>${formatMoney(depAmt)} บาท (${thaiBahtText(depAmt)})</strong> เงินประกันนี้ไม่สามารถนำมาหักเป็นค่าเช่ารายเดือนได้ โดยผู้ให้เช่าจะคืนให้เมื่อสิ้นสุดสัญญาและหักภาระหนี้สินค้างชำระหรือค่าเสียหายของทรัพย์สิน (ถ้ามี) เรียบร้อยแล้ว
      </p>

      <p style="margin-bottom:${isA4 ? '8px' : '5px'};">
        <strong>ข้อ 4. อัตราค่าน้ำประปา ค่าไฟฟ้า ค่าบริการ และเลขมิเตอร์วันเข้าอยู่:</strong><br/>
        <span style="margin-left:14px; display:inline-block;">
          • ค่าน้ำประปา: ${u.waterBillingType === 'direct' ? '<strong>ผู้เช่าชำระโดยตรงกับทางการประปา (ผู้ให้เช่าไม่คิดเพิ่ม)</strong>' : `อัตรา <strong>${wRate} บาท/หน่วย</strong>`} (เลขมิเตอร์น้ำตั้งต้นวันเข้าอยู่: <strong>${initW}</strong> หน่วย)<br/>
          • ค่าไฟฟ้า: ${u.electricBillingType === 'direct' ? '<strong>ผู้เช่าชำระโดยตรงกับทางการไฟฟ้า (ผู้ให้เช่าไม่คิดเพิ่ม)</strong>' : `อัตรา <strong>${eRate} บาท/หน่วย</strong>`} (เลขมิเตอร์ไฟตั้งต้นวันเข้าอยู่: <strong>${initE}</strong> หน่วย)
          ${commonAmt > 0 ? `<br/>• ค่าส่วนกลาง / ค่าขยะ: เดือนละ <strong>${formatMoney(commonAmt)} บาท</strong>` : ''}
        </span>
      </p>

      <div style="margin-bottom:${isA4 ? '8px' : '5px'};">
        <strong>ข้อ 5. ข้อตกลงและระเบียบการพักอาศัย:</strong>
        <div style="margin-top:3px;">${termsHtml}</div>
      </div>

      ${extraNotes ? `
        <p style="margin-bottom:${isA4 ? '8px' : '5px'};">
          <strong>ข้อ 6. ข้อตกลงพิเศษเพิ่มเติม:</strong> ${escapeHtml(extraNotes)}
        </p>
      ` : ''}

      <p style="margin-top:${isA4 ? '10px' : '6px'}; text-indent:24px;">
        สัญญานี้ทำขึ้นเป็นสองฉบับ มีข้อความถูกต้องตรงกัน คู่สัญญาทั้งสองฝ่ายได้อ่านและเข้าใจข้อความในสัญญานี้โดยตลอดแล้ว จึงได้ลงลายมือชื่อไว้เป็นสำคัญ
      </p>
    </div>

    <div class="doc-signatures" style="margin-top:${isA4 ? '28px' : '16px'}; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:14px; text-align:center;">
      <div>
        <div class="sig-line" style="margin-bottom:6px;"></div>
        <div>(${escapeHtml(landlordText)})</div>
        <div style="font-weight:700; margin-top:2px;">ผู้ให้เช่า</div>
      </div>
      <div>
        <div class="sig-line" style="margin-bottom:6px;"></div>
        <div>(${t.fullName ? escapeHtml(t.fullName) : '.................................................'})</div>
        <div style="font-weight:700; margin-top:2px;">ผู้เช่า</div>
      </div>
      <div>
        <div class="sig-line" style="margin-bottom:6px;"></div>
        <div>(${escapeHtml(witnessText)})</div>
        <div style="font-weight:700; margin-top:2px;">พยาน</div>
      </div>
    </div>
  `;
}

function openContractPreviewModal(tenantId = null, unitId = null, forcedPaperSize = null) {
  const units = appState.units || [];
  const tenants = appState.tenants || [];
  const s = appState.settings || {};

  let t = tenantId ? tenants.find(x => x.id === tenantId) : null;
  if (!t && unitId) {
    t = tenants.find(x => x.unitId === unitId && x.status === 'active') || null;
  }

  let u = null;
  if (unitId) {
    u = units.find(x => x.id === unitId) || null;
  }
  if (!u && t && t.unitId) {
    u = units.find(x => x.id === t.unitId) || null;
  }
  if (!u && units.length > 0) {
    u = units[0];
    if (!t) {
      t = tenants.find(x => x.unitId === u.id && x.status === 'active') || null;
    }
  }
  u = u || { id: '', code: 'H1-01', zone: 'หอพัก "หาญยิ่ง 1"', floor: 'ชั้น 1', bedrooms: 'ห้องแอร์', category: 'room', baseRent: 3000, defaultDeposit: 4500, commonFee: 20, lastWaterMeter: 0, lastElectricMeter: 0 };
  const tenantObj = t || {
    id: '',
    unitId: u.id,
    fullName: '',
    idCard: '',
    phone: '',
    permanentAddress: '',
    occupantCount: 1,
    contractStartDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
    agreedRent: u.baseRent || 3000,
    depositAmount: u.defaultDeposit || 4500,
    initialWaterMeter: u.lastWaterMeter || 0,
    initialElectricMeter: u.lastElectricMeter || 0,
    notes: ''
  };

  const paperSize = forcedPaperSize || window.__contractPaperSize || s.contractPaperSize || 'a4';
  window.__contractPaperSize = paperSize;

  const savedCustomHtml = (t && t.customContractHtml) ? t.customContractHtml : (u.customContractHtml || '');
  const sheetInnerHtml = savedCustomHtml || buildDefaultContractInnerHtml(tenantObj, u, s, paperSize);
  const sheetClass = paperSize === 'a4' ? 'a4-contract-sheet' : 'a5-sheet';

  const unitOptionsHtml = units.map(item => {
    const activeT = tenants.find(x => x.unitId === item.id && x.status === 'active');
    const tLabel = activeT ? `👤 ${activeT.fullName}` : (item.status === 'occupied' ? 'มีผู้เช่า (ยังไม่ระบุชื่อ)' : 'ห้องว่าง');
    return `<option value="${item.id}" ${item.id === u.id ? 'selected' : ''}>🏢 ${escapeHtml(item.code)} (${escapeHtml(item.zone || '')}) - ${escapeHtml(tLabel)}</option>`;
  }).join('');

  showModal({
    title: `📄 หนังสือสัญญาเช่า & แก้ไขสัญญา (${u.code}${tenantObj.fullName ? ` - ${tenantObj.fullName}` : ''})`,
    xl: true,
    bodyHtml: `
      <!-- แถบเครื่องมือจัดการและแก้ไขสัญญาเช่า -->
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px 14px; margin-bottom:12px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <label style="font-weight:700; font-size:12.5px; color:#334155; margin:0;">ห้องที่ทำสัญญา:</label>
            <select class="form-control" style="width:auto; min-width:220px; height:34px; font-weight:700; font-size:13px; background:#fff;" onchange="openContractPreviewModal(null, this.value)">
              ${unitOptionsHtml || `<option value="${u.id}">${escapeHtml(u.code)}</option>`}
            </select>
            <button type="button" class="btn btn-sm btn-primary" onclick="closeModal(); openTenantModal('${tenantObj.id || ''}', '${u.id || ''}');">
              👤 ${tenantObj.fullName ? 'แก้ไขข้อมูลผู้เช่า / วันเริ่มสัญญา' : '+ ระบุชื่อผู้เช่า / ทำสัญญาห้องนี้'}
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <div style="display:inline-flex; background:#e2e8f0; padding:2px; border-radius:8px;">
              <button type="button" class="btn btn-sm ${paperSize === 'a4' ? 'btn-primary' : ''}" style="padding:3px 10px; font-size:12px; ${paperSize !== 'a4' ? 'background:transparent; border:none; color:#475569;' : ''}" onclick="openContractPreviewModal('${tenantObj.id || ''}', '${u.id || ''}', 'a4')">📄 ขนาด A4 (เต็มแผ่น)</button>
              <button type="button" class="btn btn-sm ${paperSize === 'a5' ? 'btn-primary' : ''}" style="padding:3px 10px; font-size:12px; ${paperSize !== 'a5' ? 'background:transparent; border:none; color:#475569;' : ''}" onclick="openContractPreviewModal('${tenantObj.id || ''}', '${u.id || ''}', 'a5')">📄 ขนาด A5</button>
            </div>
            <button type="button" class="btn btn-sm btn-outline" style="border-color:#93c5fd; color:#1d4ed8; background:#eff6ff; font-weight:700;" onclick="closeModal(); openContractTemplateModal('${tenantObj.id || ''}', '${u.id || ''}');">
              ⚙️ แก้ไขแม่แบบข้อสัญญามาตรฐาน (ทุกห้อง)
            </button>
            <button type="button" class="btn btn-sm btn-outline" onclick="resetCustomContractSheet('${tenantObj.id || ''}', '${u.id || ''}')" title="ล้างการแก้ไขด้วยมือ แล้วดึงข้อมูลล่าสุดจากระบบใหม่">
              🔄 รีเซ็ตตามข้อมูลจริง
            </button>
          </div>
        </div>

        <div style="background:#eff6ff; border:1px dashed #60a5fa; border-radius:8px; padding:7px 12px; font-size:12.5px; color:#1e40af; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <span>✏️ <strong>แก้ไขข้อความบนใบสัญญาได้โดยตรง:</strong> คลิกที่ข้อความใดก็ได้ในกระดาษสีขาวด้านล่าง เพื่อพิมพ์แก้ไขคำ เพิ่ม หรือลบข้อสัญญาได้เหมือนพิมพ์ใน Word</span>
          <button type="button" class="btn btn-sm btn-primary" style="padding:3px 10px; font-size:12px;" onclick="saveCustomContractSheet('${tenantObj.id || ''}', '${u.id || ''}')">💾 บันทึกข้อความสัญญานี้</button>
        </div>
      </div>

      <div class="a5-preview-stage">
        <div id="editable-contract-sheet" class="${sheetClass}" contenteditable="true" spellcheck="false">
          ${sheetInnerHtml}
        </div>
      </div>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ปิด</button>
      <button class="btn btn-outline" style="color:#1d4ed8; border-color:#93c5fd;" onclick="closeModal(); openContractTemplateModal('${tenantObj.id || ''}', '${u.id || ''}');">⚙️ ตั้งค่าแม่แบบสัญญา (ทุกห้อง)</button>
      <button class="btn btn-outline" onclick="saveCustomContractSheet('${tenantObj.id || ''}', '${u.id || ''}')">💾 บันทึกข้อความสัญญานี้</button>
      <button class="btn btn-primary" onclick="printCustomHtml()">🖨️ พิมพ์หนังสือสัญญาเช่า (${paperSize.toUpperCase()})</button>
    `
  });
}

async function saveCustomContractSheet(tenantId, unitId) {
  const sheetEl = document.getElementById('editable-contract-sheet');
  if (!sheetEl) return;
  const customHtml = sheetEl.innerHTML;

  if (tenantId) {
    const t = (appState.tenants || []).find(x => x.id === tenantId);
    if (t) {
      await apiPost('/api/tenants', { ...t, customContractHtml: customHtml });
      showToast('บันทึกการแก้ไขข้อความใบสัญญาเช่าเรียบร้อยแล้ว');
      return;
    }
  }
  if (unitId) {
    const u = (appState.units || []).find(x => x.id === unitId);
    if (u) {
      await apiPost('/api/units', { ...u, customContractHtml: customHtml });
      showToast(`บันทึกข้อความสัญญาเช่าของห้อง ${u.code} เรียบร้อยแล้ว`);
      return;
    }
  }
  showToast('บันทึกข้อความในหน้าจอเรียบร้อยแล้ว สามารถกดพิมพ์ได้ทันที');
}

async function resetCustomContractSheet(tenantId, unitId) {
  if (!confirm('ต้องการรีเซ็ตข้อความใบสัญญา เพื่อดึงข้อมูลล่าสุดจากห้องพักและแม่แบบมาตรฐานใช่หรือไม่?')) return;
  if (tenantId) {
    const t = (appState.tenants || []).find(x => x.id === tenantId);
    if (t) {
      await apiPost('/api/tenants', { ...t, customContractHtml: '' });
    }
  }
  if (unitId) {
    const u = (appState.units || []).find(x => x.id === unitId);
    if (u) {
      await apiPost('/api/units', { ...u, customContractHtml: '' });
    }
  }
  openContractPreviewModal(tenantId || null, unitId || null);
  showToast('รีเซ็ตเนื้อหาสัญญาตามข้อมูลล่าสุดเรียบร้อยแล้ว');
}

function openContractTemplateModal(returnTenantId = null, returnUnitId = null) {
  const s = appState.settings || {};
  const termsVal = (s.contractTermsText !== undefined && s.contractTermsText !== null && String(s.contractTermsText).trim() !== '')
    ? String(s.contractTermsText)
    : getDefaultContractTermsText();

  showModal({
    title: '⚙️ ตั้งค่าแม่แบบหนังสือสัญญาเช่ามาตรฐาน (ใช้เป็นค่าเริ่มต้นทุกห้อง)',
    bodyHtml: `
      <form id="contract-template-form" style="display:flex; flex-direction:column; gap:14px;">
        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; padding:10px 14px; font-size:12.5px; color:#0369a1;">
          💡 การตั้งค่าในหน้านี้จะเป็น <strong>แม่แบบมาตรฐานให้กับทุกห้อง</strong> ส่วนข้อมูลเฉพาะห้อง (เช่น เลขห้อง, ค่าเช่า, เงินประกัน, เลขมิเตอร์, ชื่อผู้เช่า) ระบบจะดึงมาใส่ให้โดยอัตโนมัติ
        </div>

        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px;">
          <div style="font-size:13.5px; font-weight:800; color:#1e293b; margin-bottom:10px;">
            📋 1. ข้อมูลหัวสัญญาและผู้ให้เช่า
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:10px;">
            <div class="form-group">
              <label>หัวข้อหนังสือสัญญาเช่า</label>
              <input type="text" class="form-control" id="ct-title" value="${escapeHtml(s.contractTitle || 'หนังสือสัญญาเช่าห้องพัก')}" placeholder="เช่น หนังสือสัญญาเช่าห้องพัก" />
            </div>
            <div class="form-group">
              <label>สถานที่ทำสัญญา (ทำที่)</label>
              <input type="text" class="form-control" id="ct-place" value="${escapeHtml(s.contractPlace || s.businessName || 'หอพัก "หาญยิ่ง"')}" placeholder="เช่น หอพัก หาญยิ่ง" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
            <div class="form-group">
              <label>ชื่อผู้ให้เช่า (ที่แสดงในสัญญา)</label>
              <input type="text" class="form-control" id="ct-landlord" value="${escapeHtml(s.contractLandlordName || s.bankAccountName || s.businessName || '')}" placeholder="ชื่อ-นามสกุล ผู้ให้เช่า" />
            </div>
            <div class="form-group">
              <label>ชื่อพยานเริ่มต้น (ถ้ามี)</label>
              <input type="text" class="form-control" id="ct-witness" value="${escapeHtml(s.contractWitnessName || '')}" placeholder="เว้นว่างไว้เพื่อพิมพ์เส้นประ" />
            </div>
            <div class="form-group">
              <label>ขนาดกระดาษสัญญาเริ่มต้น</label>
              <select class="form-control" id="ct-paper">
                <option value="a4" ${(s.contractPaperSize || 'a4') === 'a4' ? 'selected' : ''}>📄 ขนาด A4 (เต็มแผ่นมาตรฐาน)</option>
                <option value="a5" ${s.contractPaperSize === 'a5' ? 'selected' : ''}>📄 ขนาด A5 (ครึ่งแผ่น)</option>
              </select>
            </div>
          </div>
        </div>

        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="font-size:13.5px; font-weight:800; color:#1e293b;">📝 2. ข้อตกลงและระเบียบการพักอาศัยมาตรฐาน (ข้อ 5)</span>
            <button type="button" class="btn btn-sm btn-outline" style="padding:2px 8px; font-size:11.5px;" onclick="document.getElementById('ct-terms').value = getDefaultContractTermsText();">🔄 คืนค่าข้อสัญญามาตรฐาน</button>
          </div>
          <div class="form-group">
            <label style="font-size:12px; color:var(--text-muted);">พิมพ์ข้อตกลงหรือกฎระเบียบหอพักบรรทัดละ 1 ข้อ (สามารถแก้ไข เพิ่มข้อ 5.4, 5.5 หรือลบได้ตามต้องการ)</label>
            <textarea class="form-control" id="ct-terms" rows="7" style="line-height:1.6; font-size:13px;">${escapeHtml(termsVal)}</textarea>
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="${returnUnitId || returnTenantId ? `openContractPreviewModal('${returnTenantId || ''}', '${returnUnitId || ''}')` : 'closeModal()'}">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveContractTemplateForm('${returnTenantId || ''}', '${returnUnitId || ''}')">💾 บันทึกแม่แบบสัญญาเช่า</button>
    `
  });
}

async function saveContractTemplateForm(returnTenantId = '', returnUnitId = '') {
  const contractTitle = (document.getElementById('ct-title')?.value || '').trim();
  const contractPlace = (document.getElementById('ct-place')?.value || '').trim();
  const contractLandlordName = (document.getElementById('ct-landlord')?.value || '').trim();
  const contractWitnessName = (document.getElementById('ct-witness')?.value || '').trim();
  const contractPaperSize = document.getElementById('ct-paper')?.value || 'a4';
  const contractTermsText = document.getElementById('ct-terms')?.value || '';

  window.__contractPaperSize = contractPaperSize;

  await apiPost('/api/settings', {
    ...appState.settings,
    contractTitle,
    contractPlace,
    contractLandlordName,
    contractWitnessName,
    contractPaperSize,
    contractTermsText
  });

  showToast('บันทึกแม่แบบหนังสือสัญญาเช่าเรียบร้อยแล้ว');
  if (returnTenantId || returnUnitId) {
    openContractPreviewModal(returnTenantId || null, returnUnitId || null, contractPaperSize);
  } else {
    closeModal();
    renderCurrentTab();
  }
}

function printCustomHtml() {
  const editableEl = document.getElementById('editable-contract-sheet');
  const htmlToPrint = editableEl ? editableEl.outerHTML : window.__customPrintHtml;
  if (!htmlToPrint) return;
  const printMount = document.getElementById('print-mount');
  printMount.innerHTML = htmlToPrint;
  window.print();
}

// ----------------------------------------------------------------------------
// TAB 6: MONTHLY SUMMARY REPORT, EXCEL EXPORT, ACCOUNTING & MAINTENANCE
// ----------------------------------------------------------------------------
function computeMonthlySummaryData(billingMonth) {
  const allInvoices = filterByCategory(appState.invoices || [], i => i.unitCategory);
  const monthInvoices = allInvoices.filter(i => !billingMonth || i.billingMonth === billingMonth);

  const zoneMap = new Map();
  for (const u of appState.units || []) {
    const zName = u.zone || 'ไม่ระบุโซน';
    if (!zoneMap.has(zName)) {
      zoneMap.set(zName, {
        zone: zName,
        unitCount: 0,
        invoiceCount: 0,
        paidCount: 0,
        unpaidCount: 0,
        rentAmount: 0,
        waterUnits: 0,
        waterAmount: 0,
        electricUnits: 0,
        electricAmount: 0,
        commonFee: 0,
        otherFee: 0,
        discount: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0
      });
    }
    zoneMap.get(zName).unitCount++;
  }

  const totals = {
    invoiceCount: 0,
    paidCount: 0,
    unpaidCount: 0,
    rentAmount: 0,
    waterUnits: 0,
    waterAmount: 0,
    electricUnits: 0,
    electricAmount: 0,
    commonFee: 0,
    otherFee: 0,
    discount: 0,
    totalAmount: 0,
    paidAmount: 0,
    unpaidAmount: 0
  };

  for (const inv of monthInvoices) {
    const zName = inv.unitZone || 'ไม่ระบุโซน';
    if (!zoneMap.has(zName)) {
      zoneMap.set(zName, {
        zone: zName,
        unitCount: 0,
        invoiceCount: 0,
        paidCount: 0,
        unpaidCount: 0,
        rentAmount: 0,
        waterUnits: 0,
        waterAmount: 0,
        electricUnits: 0,
        electricAmount: 0,
        commonFee: 0,
        otherFee: 0,
        discount: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0
      });
    }
    const z = zoneMap.get(zName);
    const rent = Number(inv.rentAmount || 0);
    const wUnits = Number(inv.waterUnits || 0);
    const wAmt = Number(inv.waterAmount || 0);
    const eUnits = Number(inv.electricUnits || 0);
    const eAmt = Number(inv.electricAmount || 0);
    const common = Number(inv.commonFee || 0);
    const other = Number(inv.otherFee || 0);
    const disc = Number(inv.discount || 0);
    const total = Number(inv.totalAmount || 0);
    const isPaid = inv.status === 'paid';

    z.invoiceCount++;
    if (isPaid) z.paidCount++;
    else z.unpaidCount++;
    z.rentAmount += rent;
    z.waterUnits += wUnits;
    z.waterAmount += wAmt;
    z.electricUnits += eUnits;
    z.electricAmount += eAmt;
    z.commonFee += common;
    z.otherFee += other;
    z.discount += disc;
    z.totalAmount += total;
    if (isPaid) z.paidAmount += total;
    else z.unpaidAmount += total;

    totals.invoiceCount++;
    if (isPaid) totals.paidCount++;
    else totals.unpaidCount++;
    totals.rentAmount += rent;
    totals.waterUnits += wUnits;
    totals.waterAmount += wAmt;
    totals.electricUnits += eUnits;
    totals.electricAmount += eAmt;
    totals.commonFee += common;
    totals.otherFee += other;
    totals.discount += disc;
    totals.totalAmount += total;
    if (isPaid) totals.paidAmount += total;
    else totals.unpaidAmount += total;
  }

  // Monthly history overview across all months
  const monthMap = new Map();
  for (const inv of allInvoices) {
    const m = inv.billingMonth || 'ไม่ระบุ';
    if (!monthMap.has(m)) {
      monthMap.set(m, {
        billingMonth: m,
        invoiceCount: 0,
        paidCount: 0,
        unpaidCount: 0,
        rentAmount: 0,
        waterAmount: 0,
        electricAmount: 0,
        feeAmount: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0
      });
    }
    const row = monthMap.get(m);
    const total = Number(inv.totalAmount || 0);
    const isPaid = inv.status === 'paid';
    row.invoiceCount++;
    if (isPaid) row.paidCount++;
    else row.unpaidCount++;
    row.rentAmount += Number(inv.rentAmount || 0);
    row.waterAmount += Number(inv.waterAmount || 0);
    row.electricAmount += Number(inv.electricAmount || 0);
    row.feeAmount += Number(inv.commonFee || 0) + Number(inv.otherFee || 0) - Number(inv.discount || 0);
    row.totalAmount += total;
    if (isPaid) row.paidAmount += total;
    else row.unpaidAmount += total;
  }

  const monthlyHistory = Array.from(monthMap.values()).sort((a, b) => b.billingMonth.localeCompare(a.billingMonth));
  const zoneRows = Array.from(zoneMap.values()).filter(z => z.unitCount > 0 || z.invoiceCount > 0);

  return { monthInvoices, zoneRows, totals, monthlyHistory };
}

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function exportMonthlyExcel(billingMonth = selectedBillingMonth) {
  const s = appState.settings || {};
  const { monthInvoices, zoneRows, totals } = computeMonthlySummaryData(billingMonth);
  const txs = (appState.transactions || []).filter(t => !billingMonth || String(t.date || '').startsWith(billingMonth));
  const monthLabel = billingMonth ? formatMonthThai(billingMonth) : 'ทั้งหมด';

  // Build Sheet 1: สรุปรายอาคาร (Building Summary)
  let sheet1Rows = `
    <Row ss:Height="26">
      <Cell ss:MergeAcross="10" ss:StyleID="Title"><Data ss:Type="String">รายงานสรุปยอดประจำเดือน ${xmlEscape(monthLabel)} - ${xmlEscape(s.businessName || 'RentalPro')}</Data></Cell>
    </Row>
    <Row ss:Height="22">
      <Cell ss:StyleID="Header"><Data ss:Type="String">อาคาร / โซน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">จำนวนบิล (ห้อง)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าเช่าห้องรวม (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หน่วยน้ำรวม</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าน้ำประปารวม (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หน่วยไฟรวม</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าไฟฟ้ารวม (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าขยะ/ส่วนกลาง (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าจอดรถ/อื่นๆ (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ยอดเรียกเก็บรวม (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">รับชำระแล้ว (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค้างชำระ (บาท)</Data></Cell>
    </Row>
  `;

  for (const z of zoneRows) {
    sheet1Rows += `
      <Row ss:Height="20">
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(z.zone)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${z.invoiceCount}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${z.rentAmount}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${z.waterUnits}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${z.waterAmount}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${z.electricUnits}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${z.electricAmount}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${z.commonFee}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${z.otherFee - z.discount}</Data></Cell>
        <Cell ss:StyleID="CellMoneyBold"><Data ss:Type="Number">${z.totalAmount}</Data></Cell>
        <Cell ss:StyleID="CellMoneyPaid"><Data ss:Type="Number">${z.paidAmount}</Data></Cell>
        <Cell ss:StyleID="CellMoneyUnpaid"><Data ss:Type="Number">${z.unpaidAmount}</Data></Cell>
      </Row>
    `;
  }

  sheet1Rows += `
    <Row ss:Height="23">
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String">รวมทั้งสิ้น (${totals.invoiceCount} บิล)</Data></Cell>
      <Cell ss:StyleID="TotalInt"><Data ss:Type="Number">${totals.invoiceCount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.rentAmount}</Data></Cell>
      <Cell ss:StyleID="TotalInt"><Data ss:Type="Number">${totals.waterUnits}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.waterAmount}</Data></Cell>
      <Cell ss:StyleID="TotalInt"><Data ss:Type="Number">${totals.electricUnits}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.electricAmount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.commonFee}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.otherFee - totals.discount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.totalAmount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.paidAmount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.unpaidAmount}</Data></Cell>
    </Row>
  `;

  // Build Sheet 2: รายละเอียดรายห้อง (Room-by-Room Details)
  let sheet2Rows = `
    <Row ss:Height="26">
      <Cell ss:MergeAcross="18" ss:StyleID="Title"><Data ss:Type="String">ตารางรายละเอียดค่าเช่าและมิเตอร์น้ำ-ไฟ ประจำเดือน ${xmlEscape(monthLabel)}</Data></Cell>
    </Row>
    <Row ss:Height="22">
      <Cell ss:StyleID="Header"><Data ss:Type="String">ลำดับ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">อาคาร / โซน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">เลขห้อง / บ้าน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ชื่อผู้เช่า</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">เลขที่ใบแจ้งหนี้</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">เลขที่ใบเสร็จ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าเช่า (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">มิเตอร์น้ำ (ก่อน)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">มิเตอร์น้ำ (หลัง)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หน่วยน้ำ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าน้ำ (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">มิเตอร์ไฟ (ก่อน)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">มิเตอร์ไฟ (หลัง)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หน่วยไฟ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าไฟ (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าขยะ/ส่วนกลาง</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ค่าจอดรถ/อื่นๆ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ยอดรวมสุทธิ (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">สถานะชำระเงิน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">วันที่ชำระ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">วิธีชำระ</Data></Cell>
    </Row>
  `;

  monthInvoices.forEach((inv, idx) => {
    const statusText = inv.status === 'paid' ? 'ชำระแล้ว' : inv.status === 'overdue' ? 'เกินกำหนด' : 'รอชำระ';
    const methodText = inv.paymentMethod === 'cash' ? 'เงินสด' : inv.paymentMethod === 'transfer' ? 'โอนเงิน' : inv.paymentMethod || '';
    sheet2Rows += `
      <Row ss:Height="20">
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${idx + 1}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.unitZone || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.unitCode || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.tenantName || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.invoiceNo || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.receiptNo || '')}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${Number(inv.rentAmount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.waterPrevMeter || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.waterCurrMeter || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.waterUnits || 0)}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${Number(inv.waterAmount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.electricPrevMeter || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.electricCurrMeter || 0)}</Data></Cell>
        <Cell ss:StyleID="CellInt"><Data ss:Type="Number">${Number(inv.electricUnits || 0)}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${Number(inv.electricAmount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${Number(inv.commonFee || 0)}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${Number(inv.otherFee || 0) - Number(inv.discount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellMoneyBold"><Data ss:Type="Number">${Number(inv.totalAmount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${statusText}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(inv.paidDate || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(methodText)}</Data></Cell>
      </Row>
    `;
  });

  sheet2Rows += `
    <Row ss:Height="23">
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String">รวม</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String">ทั้งสิ้น ${totals.invoiceCount} ห้อง</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.rentAmount}</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalInt"><Data ss:Type="Number">${totals.waterUnits}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.waterAmount}</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalInt"><Data ss:Type="Number">${totals.electricUnits}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.electricAmount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.commonFee}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.otherFee - totals.discount}</Data></Cell>
      <Cell ss:StyleID="TotalMoney"><Data ss:Type="Number">${totals.totalAmount}</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String">ชำระแล้ว ${totals.paidCount}/${totals.invoiceCount}</Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
      <Cell ss:StyleID="TotalLabel"><Data ss:Type="String"></Data></Cell>
    </Row>
  `;

  // Build Sheet 3: บัญชีรายรับ-รายจ่าย (Transactions)
  let sheet3Rows = `
    <Row ss:Height="26">
      <Cell ss:MergeAcross="5" ss:StyleID="Title"><Data ss:Type="String">รายการบัญชีรายรับ-รายจ่าย (${xmlEscape(s.businessName || '')})</Data></Cell>
    </Row>
    <Row ss:Height="22">
      <Cell ss:StyleID="Header"><Data ss:Type="String">วันที่</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ประเภท</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หมวดหมู่</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">รายการ</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">ห้อง / บ้าน</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">จำนวนเงิน (บาท)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">หมายเหตุ</Data></Cell>
    </Row>
  `;

  for (const t of appState.transactions || []) {
    sheet3Rows += `
      <Row ss:Height="20">
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.date || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${t.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.category || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.title || '')}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.unitCode || '')}</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${t.type === 'income' ? Number(t.amount || 0) : -Number(t.amount || 0)}</Data></Cell>
        <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.note || '')}</Data></Cell>
      </Row>
    `;
  }

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Tahoma" ss:Size="10"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Tahoma" ss:Size="13" ss:Bold="1" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellText">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellInt">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <NumberFormat ss:Format="#,##0"/>
  </Style>
  <Style ss:ID="CellMoney">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="CellMoneyBold">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#1D4ED8"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="CellMoneyPaid">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#15803D"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="CellMoneyUnpaid">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#DC2626"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="TotalLabel">
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3"/>
   </Borders>
  </Style>
  <Style ss:ID="TotalInt">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3"/>
   </Borders>
  </Style>
  <Style ss:ID="TotalMoney">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="1.สรุปรายอาคาร">
  <Table>
   <Column ss:Width="135"/><Column ss:Width="85"/><Column ss:Width="105"/><Column ss:Width="75"/><Column ss:Width="105"/><Column ss:Width="75"/><Column ss:Width="105"/><Column ss:Width="100"/><Column ss:Width="100"/><Column ss:Width="115"/><Column ss:Width="110"/><Column ss:Width="110"/>
   ${sheet1Rows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="2.รายละเอียดรายห้อง">
  <Table>
   <Column ss:Width="45"/><Column ss:Width="115"/><Column ss:Width="85"/><Column ss:Width="130"/><Column ss:Width="100"/><Column ss:Width="100"/><Column ss:Width="85"/><Column ss:Width="80"/><Column ss:Width="80"/><Column ss:Width="65"/><Column ss:Width="85"/><Column ss:Width="80"/><Column ss:Width="80"/><Column ss:Width="65"/><Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="100"/><Column ss:Width="80"/><Column ss:Width="85"/><Column ss:Width="80"/>
   ${sheet2Rows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="3.บัญชีรายรับ-รายจ่าย">
  <Table>
   <Column ss:Width="85"/><Column ss:Width="75"/><Column ss:Width="125"/><Column ss:Width="240"/><Column ss:Width="85"/><Column ss:Width="105"/><Column ss:Width="150"/>
   ${sheet3Rows}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob(['\uFEFF' + workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `สรุปรายเดือน-หอพักหาญยิ่ง-${billingMonth || 'ทั้งหมด'}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`ส่งออกไฟล์ Excel (.xls) ประจำเดือน ${monthLabel} เรียบร้อยแล้ว`);
}

function exportMonthlyCsv(billingMonth = selectedBillingMonth) {
  const { monthInvoices, zoneRows, totals } = computeMonthlySummaryData(billingMonth);
  const csvCell = (val) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines = [];
  lines.push(['สรุปยอดรายเดือนแยกตามอาคาร/โซน', billingMonth || 'ทั้งหมด'].map(csvCell).join(','));
  lines.push([
    'อาคาร/โซน', 'จำนวนบิล(ห้อง)', 'ค่าเช่ารวม(บาท)', 'หน่วยน้ำรวม', 'ค่าน้ำรวม(บาท)',
    'หน่วยไฟรวม', 'ค่าไฟรวม(บาท)', 'ค่าขยะ/ส่วนกลาง(บาท)', 'ค่าจอดรถ/อื่นๆ(บาท)',
    'ยอดเรียกเก็บรวม(บาท)', 'รับชำระแล้ว(บาท)', 'ค้างชำระ(บาท)'
  ].map(csvCell).join(','));

  for (const z of zoneRows) {
    lines.push([
      z.zone, z.invoiceCount, z.rentAmount, z.waterUnits, z.waterAmount,
      z.electricUnits, z.electricAmount, z.commonFee, z.otherFee - z.discount,
      z.totalAmount, z.paidAmount, z.unpaidAmount
    ].map(csvCell).join(','));
  }

  lines.push([
    'รวมทั้งสิ้น', totals.invoiceCount, totals.rentAmount, totals.waterUnits, totals.waterAmount,
    totals.electricUnits, totals.electricAmount, totals.commonFee, totals.otherFee - totals.discount,
    totals.totalAmount, totals.paidAmount, totals.unpaidAmount
  ].map(csvCell).join(','));

  lines.push('');
  lines.push(['รายละเอียดบิลรายห้องประจำเดือน', billingMonth || 'ทั้งหมด'].map(csvCell).join(','));
  lines.push([
    'ลำดับ', 'อาคาร/โซน', 'เลขห้อง', 'ชื่อผู้เช่า', 'เลขที่ใบแจ้งหนี้', 'เลขที่ใบเสร็จ',
    'ค่าเช่า', 'มิเตอร์น้ำ(ก่อน)', 'มิเตอร์น้ำ(หลัง)', 'หน่วยน้ำ', 'ค่าน้ำ(บาท)',
    'มิเตอร์ไฟ(ก่อน)', 'มิเตอร์ไฟ(หลัง)', 'หน่วยไฟ', 'ค่าไฟ(บาท)',
    'ค่าขยะ/ส่วนกลาง', 'ค่าจอดรถ/อื่นๆ', 'ยอดรวมสุทธิ(บาท)', 'สถานะ', 'วันที่ชำระ', 'วิธีชำระ'
  ].map(csvCell).join(','));

  monthInvoices.forEach((inv, idx) => {
    const statusText = inv.status === 'paid' ? 'ชำระแล้ว' : inv.status === 'overdue' ? 'เกินกำหนด' : 'รอชำระ';
    const methodText = inv.paymentMethod === 'cash' ? 'เงินสด' : inv.paymentMethod === 'transfer' ? 'โอนเงิน' : inv.paymentMethod || '';
    lines.push([
      idx + 1, inv.unitZone, inv.unitCode, inv.tenantName, inv.invoiceNo, inv.receiptNo,
      inv.rentAmount, inv.waterPrevMeter, inv.waterCurrMeter, inv.waterUnits, inv.waterAmount,
      inv.electricPrevMeter, inv.electricCurrMeter, inv.electricUnits, inv.electricAmount,
      inv.commonFee, Number(inv.otherFee || 0) - Number(inv.discount || 0), inv.totalAmount,
      statusText, inv.paidDate, methodText
    ].map(csvCell).join(','));
  });

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ตารางสรุปรายเดือน-${billingMonth || 'ทั้งหมด'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('ส่งออกไฟล์ CSV (เปิดใน Excel ได้ทันที) เรียบร้อยแล้ว');
}

function renderAccountingTab(container) {
  const { zoneRows, totals, monthlyHistory } = computeMonthlySummaryData(selectedBillingMonth);
  const txs = appState.transactions || [];
  const totalIncome = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const netProfit = totalIncome - totalExpense;

  const zoneTableRows = zoneRows.map(z => `
    <tr>
      <td><strong>${escapeHtml(z.zone)}</strong></td>
      <td class="text-center">${z.invoiceCount} / ${z.unitCount}</td>
      <td class="text-right">฿${formatMoney(z.rentAmount)}</td>
      <td class="text-right">฿${formatMoney(z.waterAmount)} <span style="font-size:11px; color:var(--text-muted)">(${z.waterUnits} หน่วย)</span></td>
      <td class="text-right">฿${formatMoney(z.electricAmount)} <span style="font-size:11px; color:var(--text-muted)">(${z.electricUnits} หน่วย)</span></td>
      <td class="text-right">฿${formatMoney(z.commonFee + z.otherFee - z.discount)}</td>
      <td class="text-right"><strong style="color:#1d4ed8;">฿${formatMoney(z.totalAmount)}</strong></td>
      <td class="text-right" style="color:#16a34a; font-weight:700;">฿${formatMoney(z.paidAmount)} <span style="font-size:11px;">(${z.paidCount})</span></td>
      <td class="text-right" style="color:${z.unpaidAmount > 0 ? '#dc2626' : '#64748b'}; font-weight:700;">฿${formatMoney(z.unpaidAmount)} <span style="font-size:11px;">(${z.unpaidCount})</span></td>
    </tr>
  `).join('');

  const historyRowsHtml = monthlyHistory.map(m => `
    <tr>
      <td><strong>${formatMonthThai(m.billingMonth)}</strong> (${escapeHtml(m.billingMonth)})</td>
      <td class="text-center">${m.invoiceCount} ใบ</td>
      <td class="text-right">฿${formatMoney(m.rentAmount)}</td>
      <td class="text-right">฿${formatMoney(m.waterAmount)}</td>
      <td class="text-right">฿${formatMoney(m.electricAmount)}</td>
      <td class="text-right">฿${formatMoney(m.feeAmount)}</td>
      <td class="text-right"><strong>฿${formatMoney(m.totalAmount)}</strong></td>
      <td class="text-right" style="color:#16a34a; font-weight:700;">฿${formatMoney(m.paidAmount)} (${m.paidCount})</td>
      <td class="text-right" style="color:${m.unpaidAmount > 0 ? '#dc2626' : '#64748b'}; font-weight:700;">฿${formatMoney(m.unpaidAmount)} (${m.unpaidCount})</td>
      <td class="text-right">
        <button class="btn btn-sm btn-success" onclick="exportMonthlyExcel('${m.billingMonth}')">📥 Excel (.xls)</button>
        <button class="btn btn-sm btn-outline" onclick="exportMonthlyCsv('${m.billingMonth}')">CSV</button>
      </td>
    </tr>
  `).join('');

  const maints = filterByCategory(appState.maintenances || [], m => m.unitCategory);

  const maintRows = maints.map(m => `
    <tr>
      <td><strong>${escapeHtml(m.unitCode)}</strong> ${getCategoryBadge(m.unitCategory)}</td>
      <td>
        <div><strong>${escapeHtml(m.title)}</strong></div>
        <div style="font-size:12px; color:var(--text-muted)">${escapeHtml(m.description || '')}</div>
      </td>
      <td>${formatDateThai(m.reportedDate)}</td>
      <td class="text-right">฿${formatMoney(m.cost)}</td>
      <td><span class="badge badge-${m.status}">${m.status === 'completed' ? '✓ เสร็จสิ้น' : m.status === 'in_progress' ? '🔧 กำลังซ่อม' : '⏳ รอดำเนินการ'}</span></td>
      <td class="text-right">
        <button class="btn btn-sm btn-outline" onclick="openMaintenanceModal('${m.id}')">แก้ไข</button>
        <button class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="deleteMaint('${m.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');

  const txRows = txs.map(t => `
    <tr>
      <td>${formatDateThai(t.date)}</td>
      <td>
        <span class="badge ${t.type === 'income' ? 'badge-paid' : 'badge-overdue'}">
          ${t.type === 'income' ? '+ รายรับ' : '- รายจ่าย'}
        </span>
      </td>
      <td>${escapeHtml(t.category || '-')}</td>
      <td><strong>${escapeHtml(t.title)}</strong></td>
      <td>${escapeHtml(t.unitCode || '-')}</td>
      <td class="text-right" style="font-weight:700; color:${t.type === 'income' ? '#16a34a' : '#dc2626'}">
        ${t.type === 'income' ? '+' : '-'}฿${formatMoney(t.amount)}
      </td>
      <td class="text-right">
        <button class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="deleteTx('${t.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div class="card-title">📊 สรุปยอดประจำเดือนแยกตามอาคาร / โซน</div>
          <input type="month" class="form-control" value="${selectedBillingMonth}" onchange="selectedBillingMonth=this.value; renderCurrentTab();" style="width:170px;" />
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-success" onclick="exportMonthlyExcel('${selectedBillingMonth}')">📥 ส่งออกไฟล์ Excel (.xls แยก 3 แท็บ)</button>
          <button class="btn btn-outline" onclick="exportMonthlyCsv('${selectedBillingMonth}')">📄 ส่งออกไฟล์ CSV (สำหรับ Excel)</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap:12px; padding:16px 20px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
        <div style="background:#eff6ff; padding:12px 14px; border-radius:10px; border:1px solid #bfdbfe;">
          <div style="font-size:12px; color:#1e40af; font-weight:700;">ยอดเรียกเก็บรวม (${totals.invoiceCount} บิล)</div>
          <div style="font-size:18px; font-weight:800; color:#1d4ed8;">฿${formatMoney(totals.totalAmount)}</div>
        </div>
        <div style="background:#f0fdf4; padding:12px 14px; border-radius:10px; border:1px solid #bbf7d0;">
          <div style="font-size:12px; color:#166534; font-weight:700;">เก็บเงินได้แล้ว (${totals.paidCount} ห้อง)</div>
          <div style="font-size:18px; font-weight:800; color:#16a34a;">฿${formatMoney(totals.paidAmount)}</div>
        </div>
        <div style="background:#fef2f2; padding:12px 14px; border-radius:10px; border:1px solid #fecaca;">
          <div style="font-size:12px; color:#991b1b; font-weight:700;">ค้างชำระ (${totals.unpaidCount} ห้อง)</div>
          <div style="font-size:18px; font-weight:800; color:#dc2626;">฿${formatMoney(totals.unpaidAmount)}</div>
        </div>
        <div style="background:#fff; padding:12px 14px; border-radius:10px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; color:var(--text-muted);">ค่าเช่าห้องรวม</div>
          <div style="font-size:17px; font-weight:800;">฿${formatMoney(totals.rentAmount)}</div>
        </div>
        <div style="background:#fff; padding:12px 14px; border-radius:10px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; color:var(--text-muted);">ค่าน้ำรวม (${totals.waterUnits} หน่วย)</div>
          <div style="font-size:17px; font-weight:800; color:#0284c7;">฿${formatMoney(totals.waterAmount)}</div>
        </div>
        <div style="background:#fff; padding:12px 14px; border-radius:10px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; color:var(--text-muted);">ค่าไฟรวม (${totals.electricUnits} หน่วย)</div>
          <div style="font-size:17px; font-weight:800; color:#d97706;">฿${formatMoney(totals.electricAmount)}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>อาคาร / โซน</th>
              <th class="text-center">จำนวนบิล / ห้อง</th>
              <th class="text-right">ค่าเช่ารวม</th>
              <th class="text-right">ค่าน้ำประปา (หน่วย)</th>
              <th class="text-right">ค่าไฟฟ้า (หน่วย)</th>
              <th class="text-right">ขยะ / จอดรถ / อื่นๆ</th>
              <th class="text-right">ยอดรวมทั้งสิ้น</th>
              <th class="text-right">รับชำระแล้ว</th>
              <th class="text-right">ค้างชำระ</th>
            </tr>
          </thead>
          <tbody>
            ${zoneTableRows || `<tr><td colspan="9" class="text-center" style="padding:24px; color:var(--text-muted)">ไม่มีข้อมูลบิลในเดือนที่เลือก</td></tr>`}
          </tbody>
          ${totals.invoiceCount > 0 ? `
          <tfoot>
            <tr style="background:#f1f5f9; font-weight:800; font-size:14px;">
              <td>รวมทั้งหมดทุกอาคาร</td>
              <td class="text-center">${totals.invoiceCount} บิล</td>
              <td class="text-right">฿${formatMoney(totals.rentAmount)}</td>
              <td class="text-right">฿${formatMoney(totals.waterAmount)} (${totals.waterUnits})</td>
              <td class="text-right">฿${formatMoney(totals.electricAmount)} (${totals.electricUnits})</td>
              <td class="text-right">฿${formatMoney(totals.commonFee + totals.otherFee - totals.discount)}</td>
              <td class="text-right" style="color:#1d4ed8;">฿${formatMoney(totals.totalAmount)}</td>
              <td class="text-right" style="color:#16a34a;">฿${formatMoney(totals.paidAmount)} (${totals.paidCount})</td>
              <td class="text-right" style="color:#dc2626;">฿${formatMoney(totals.unpaidAmount)} (${totals.unpaidCount})</td>
            </tr>
          </tfoot>
          ` : ''}
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📅 สรุปยอดรายเดือนย้อนหลัง (เปรียบเทียบแต่ละเดือน)</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>รอบเดือน</th>
              <th class="text-center">จำนวนบิล</th>
              <th class="text-right">ค่าเช่ารวม</th>
              <th class="text-right">ค่าน้ำรวม</th>
              <th class="text-right">ค่าไฟรวม</th>
              <th class="text-right">ขยะ/จอดรถ/อื่นๆ</th>
              <th class="text-right">ยอดเรียกเก็บรวม</th>
              <th class="text-right">เก็บได้แล้ว</th>
              <th class="text-right">ค้างชำระ</th>
              <th class="text-right">ส่งออก Excel</th>
            </tr>
          </thead>
          <tbody>
            ${historyRowsHtml || `<tr><td colspan="10" class="text-center" style="padding:24px; color:var(--text-muted)">ยังไม่มีประวัติใบแจ้งหนี้</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-header"><span>รายรับสะสมทั้งหมด (รวมเงินประกัน)</span><div class="stat-icon" style="background:#dcfce7; color:#16a34a;">📈</div></div>
        <div class="stat-value" style="color:#16a34a;">฿${formatMoney(totalIncome)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-header"><span>รายจ่าย & ค่าซ่อมบำรุงรวม</span><div class="stat-icon" style="background:#fee2e2; color:#dc2626;">📉</div></div>
        <div class="stat-value" style="color:#dc2626;">฿${formatMoney(totalExpense)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-header"><span>กำไรสุทธิสะสม (Net Profit)</span><div class="stat-icon" style="background:#eff6ff; color:#2563eb;">💰</div></div>
        <div class="stat-value" style="color:${netProfit >= 0 ? '#2563eb' : '#dc2626'};">฿${formatMoney(netProfit)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🔧 รายการแจ้งซ่อมบำรุง (บ้านเช่า & ห้องเช่า)</div>
        <button class="btn btn-primary" onclick="openMaintenanceModal()">+ บันทึกแจ้งซ่อมใหม่</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>บ้าน / ห้อง</th>
              <th>รายการซ่อม / อาการ</th>
              <th>วันที่แจ้ง</th>
              <th class="text-right">ค่าใช้จ่าย</th>
              <th>สถานะ</th>
              <th class="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${maintRows || `<tr><td colspan="6" class="text-center" style="padding:24px; color:var(--text-muted)">ไม่มีรายการแจ้งซ่อม</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📒 บัญชีรายรับ - รายจ่าย</div>
        <button class="btn btn-outline" onclick="openTransactionModal()">+ เพิ่มรายรับ / รายจ่ายอื่นๆ</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ประเภท</th>
              <th>หมวดหมู่</th>
              <th>รายการ</th>
              <th>บ้าน/ห้อง</th>
              <th class="text-right">จำนวนเงิน</th>
              <th class="text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${txRows || `<tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-muted)">ยังไม่มีรายการบัญชี</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openMaintenanceModal(id = null) {
  const existing = id ? (appState.maintenances || []).find(m => m.id === id) : null;
  const units = appState.units || [];
  const today = new Date().toISOString().slice(0, 10);
  const m = existing || {
    id: '',
    unitId: units[0]?.id || '',
    title: '',
    description: '',
    reportedDate: today,
    cost: 0,
    status: 'pending'
  };

  const unitOpts = units.map(u => `<option value="${u.id}" ${u.id === m.unitId ? 'selected' : ''}>${escapeHtml(u.code)} (${u.category === 'house' ? 'บ้านเช่า' : 'ห้องเช่า'})</option>`).join('');

  showModal({
    title: existing ? 'แก้ไขรายการแจ้งซ่อม' : 'บันทึกรายการแจ้งซ่อมใหม่',
    bodyHtml: `
      <form class="form-grid">
        <div class="form-group">
          <label>บ้านเช่า / ห้องเช่า</label>
          <select class="form-control" id="m-unitId">${unitOpts}</select>
        </div>
        <div class="form-group">
          <label>วันที่รับแจ้ง</label>
          <input type="date" class="form-control" id="m-date" value="${m.reportedDate}" />
        </div>
        <div class="form-group">
          <label>สถานะการซ่อม</label>
          <select class="form-control" id="m-status">
            <option value="pending" ${m.status === 'pending' ? 'selected' : ''}>รอดำเนินการ</option>
            <option value="in_progress" ${m.status === 'in_progress' ? 'selected' : ''}>กำลังซ่อม</option>
            <option value="completed" ${m.status === 'completed' ? 'selected' : ''}>ซ่อมเสร็จสิ้น</option>
          </select>
        </div>
        <div class="form-group" style="grid-column: span 2;">
          <label>หัวข้อรายการซ่อม *</label>
          <input type="text" class="form-control" id="m-title" value="${escapeHtml(m.title)}" placeholder="เช่น ล้างแอร์, ซ่อมท่อประปา, เปลี่ยนหลอดไฟ" />
        </div>
        <div class="form-group">
          <label>ค่าใช้จ่ายในการซ่อม (บาท)</label>
          <input type="number" class="form-control" id="m-cost" value="${m.cost || 0}" />
        </div>
        <div class="form-group full-width">
          <label>รายละเอียดเพิ่มเติม</label>
          <textarea class="form-control" id="m-desc" rows="2">${escapeHtml(m.description || '')}</textarea>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveMaintenance('${m.id || ''}')">💾 บันทึกรายการซ่อม</button>
    `
  });
}

async function saveMaintenance(existingId) {
  const unitId = document.getElementById('m-unitId').value;
  const u = (appState.units || []).find(x => x.id === unitId) || {};
  const title = document.getElementById('m-title').value.trim();
  if (!title) {
    showToast('กรุณาระบุหัวข้อรายการซ่อม', 'error');
    return;
  }
  const cost = Number(document.getElementById('m-cost').value || 0);
  const reportedDate = document.getElementById('m-date').value;
  const status = document.getElementById('m-status').value;

  await apiPost('/api/maintenances', {
    id: existingId || undefined,
    unitId,
    unitCode: u.code || '',
    unitCategory: u.category || 'room',
    title,
    description: document.getElementById('m-desc').value,
    reportedDate,
    cost,
    status
  });

  if (!existingId && cost > 0) {
    await apiPost('/api/transactions', {
      date: reportedDate,
      type: 'expense',
      category: 'ค่าซ่อมบำรุง',
      title: `ค่าซ่อม: ${title} (${u.code || ''})`,
      amount: cost,
      unitId,
      unitCode: u.code || ''
    });
  }

  closeModal();
  renderCurrentTab();
  showToast('บันทึกรายการแจ้งซ่อมเรียบร้อยแล้ว');
}

async function deleteMaint(id) {
  if (!confirm('ลบรายการแจ้งซ่อมนี้?')) return;
  await apiPost('/api/maintenances/delete', { id });
  renderCurrentTab();
}

function openTransactionModal() {
  const today = new Date().toISOString().slice(0, 10);
  showModal({
    title: 'เพิ่มรายการรายรับ / รายจ่าย',
    bodyHtml: `
      <form class="form-grid">
        <div class="form-group">
          <label>ประเภท</label>
          <select class="form-control" id="tx-type">
            <option value="expense">รายจ่าย (Expense)</option>
            <option value="income">รายรับ (Income)</option>
          </select>
        </div>
        <div class="form-group">
          <label>วันที่</label>
          <input type="date" class="form-control" id="tx-date" value="${today}" />
        </div>
        <div class="form-group">
          <label>หมวดหมู่</label>
          <input type="text" class="form-control" id="tx-cat" value="ค่าใช้จ่ายส่วนกลาง" />
        </div>
        <div class="form-group" style="grid-column: span 2;">
          <label>รายการ *</label>
          <input type="text" class="form-control" id="tx-title" placeholder="เช่น ค่าไฟส่วนกลาง, ค่าคนดูแลทำความสะอาด" />
        </div>
        <div class="form-group">
          <label>จำนวนเงิน (บาท) *</label>
          <input type="number" class="form-control" id="tx-amount" value="0" />
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveTxModal()">💾 บันทึกบัญชี</button>
    `
  });
}

async function saveTxModal() {
  const title = document.getElementById('tx-title').value.trim();
  const amount = Number(document.getElementById('tx-amount').value || 0);
  if (!title || amount <= 0) {
    showToast('กรุณากรอกรายการและจำนวนเงิน', 'error');
    return;
  }
  await apiPost('/api/transactions', {
    date: document.getElementById('tx-date').value,
    type: document.getElementById('tx-type').value,
    category: document.getElementById('tx-cat').value,
    title,
    amount,
    unitCode: 'ส่วนกลาง'
  });
  closeModal();
  renderCurrentTab();
  showToast('บันทึกรายการบัญชีแล้ว');
}

async function deleteTx(id) {
  if (!confirm('ลบรายการบัญชีนี้?')) return;
  await apiPost('/api/transactions/delete', { id });
  renderCurrentTab();
}

// ----------------------------------------------------------------------------
// TAB 7: SETTINGS & OFFLINE BACKUP / RESTORE
// ----------------------------------------------------------------------------
function renderSettingsTab(container) {
  const s = appState.settings || {};

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">⚙️ ตั้งค่าข้อมูลกิจการ & รูปแบบใบแจ้งหนี้ขนาด A5</div>
        <button class="btn btn-primary" onclick="saveSettingsForm()">💾 บันทึกการตั้งค่าทั้งหมด</button>
      </div>
      <div class="card-body">
        <form id="settings-form" class="form-grid">
          <div class="form-group full-width" style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; padding:14px;">
            <label style="margin-bottom:8px; display:block;">🖼️ โลโก้กิจการ (แสดงที่แถบเมนูซ้ายบน และบนหัวใบแจ้งหนี้/ใบเสร็จ A5)</label>
            <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
              <div id="settings-logo-preview" style="width:64px; height:64px; border-radius:12px; border:1px solid #cbd5e1; background:linear-gradient(135deg, #2563eb, #1e3a8a); display:flex; align-items:center; justify-content:center; overflow:hidden; font-weight:800; color:#ffffff; font-size:28px;">
                ${s.logoDataUrl ? `<img src="${s.logoDataUrl}" alt="Logo" style="width:100%; height:100%; object-fit:contain; background:#fff;" />` : 'H'}
              </div>
              <div style="display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('logo-file-input').click()">📷 เลือกรูปโลโก้ใหม่ (.png, .jpg, .svg)</button>
                  ${s.logoDataUrl ? `<button type="button" class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="clearLogoImage()">🗑️ ลบโลโก้ (ใช้ค่าเริ่มต้น)</button>` : ''}
                </div>
                <span style="font-size:12px; color:var(--text-muted);">แนะนำรูปสี่เหลี่ยมจัตุรัสหรือพื้นหลังโปร่งใส (PNG) ระบบจะบันทึกติดไปกับฐานข้อมูลอัตโนมัติ</span>
              </div>
              <input type="file" id="logo-file-input" accept="image/*" style="display:none" onchange="onLogoFileSelected(this)" />
            </div>
          </div>

          <div class="form-group" style="grid-column: span 2;">
            <label>ชื่อกิจการ / ชื่อโครงการบ้านเช่าและหอพัก (แสดงบนหัวใบแจ้งหนี้ A5)</label>
            <input type="text" class="form-control" name="businessName" value="${escapeHtml(s.businessName || '')}" />
          </div>
          <div class="form-group">
            <label>เลขประจำตัวผู้เสียภาษี (ถ้ามี)</label>
            <input type="text" class="form-control" name="taxId" value="${escapeHtml(s.taxId || '')}" />
          </div>

          <div class="form-group" style="grid-column: span 2;">
            <label>ที่อยู่กิจการ (แสดงบนหัวใบแจ้งหนี้/ใบเสร็จ A5)</label>
            <input type="text" class="form-control" name="address" value="${escapeHtml(s.address || '')}" />
          </div>
          <div class="form-group">
            <label>เบอร์โทรศัพท์ติดต่อ</label>
            <input type="text" class="form-control" name="phone" value="${escapeHtml(s.phone || '')}" />
          </div>

          <div class="form-group">
            <label>💧 เรทค่าน้ำมาตรฐาน (บาท/หน่วย)</label>
            <input type="number" step="0.01" class="form-control" name="waterRate" value="${s.waterRate ?? 18}" />
          </div>
          <div class="form-group">
            <label>💧 ค่าน้ำขั้นต่ำ (บาท) <span style="font-size:11.5px; font-weight:normal; color:var(--text-muted);">(คิดขั้นต่ำหากใช้ไม่ถึง)</span></label>
            <input type="number" class="form-control" name="waterMinCharge" value="${s.waterMinCharge ?? 0}" />
          </div>
          <div class="form-group">
            <label>⚡ เรทค่าไฟมาตรฐาน (บาท/หน่วย)</label>
            <input type="number" step="0.01" class="form-control" name="electricRate" value="${s.electricRate ?? 8}" />
          </div>
          <div class="form-group">
            <label>⚡ ค่าไฟขั้นต่ำ (บาท) <span style="font-size:11.5px; font-weight:normal; color:var(--text-muted);">(คิดขั้นต่ำหากใช้ไม่ถึง)</span></label>
            <input type="number" class="form-control" name="electricMinCharge" value="${s.electricMinCharge ?? 0}" />
          </div>

          <div class="form-group">
            <label>ค่าส่วนกลางเริ่มต้น (บ้านเช่าเป็นหลัง)</label>
            <input type="number" class="form-control" name="commonFeeHouse" value="${s.commonFeeHouse ?? 200}" />
          </div>
          <div class="form-group">
            <label>ค่าส่วนกลางเริ่มต้น (ห้องเช่า/อพาร์ตเมนต์)</label>
            <input type="number" class="form-control" name="commonFeeRoom" value="${s.commonFeeRoom ?? 100}" />
          </div>
          <div class="form-group">
            <label>วันครบกำหนดชำระของทุกเดือน (วันที่)</label>
            <input type="number" min="1" max="31" class="form-control" name="defaultDueDay" value="${s.defaultDueDay ?? 5}" />
          </div>

          <div class="form-group">
            <label>ชื่อธนาคารสำหรับรับโอน</label>
            <input type="text" class="form-control" name="bankName" value="${escapeHtml(s.bankName || '')}" />
          </div>
          <div class="form-group">
            <label>เลขที่บัญชีธนาคาร</label>
            <input type="text" class="form-control" name="bankAccountNo" value="${escapeHtml(s.bankAccountNo || '')}" />
          </div>
          <div class="form-group">
            <label>ชื่อบัญชีธนาคาร</label>
            <input type="text" class="form-control" name="bankAccountName" value="${escapeHtml(s.bankAccountName || '')}" />
          </div>

          <div class="form-group">
            <label>เบอร์พร้อมเพย์ / เลขผู้เสียภาษี (สำหรับ QR Code บนใบแจ้งหนี้ A5)</label>
            <input type="text" class="form-control" name="promptPayId" value="${escapeHtml(s.promptPayId || '')}" />
          </div>
          <div class="form-group" style="grid-column: span 2;">
            <label>รูปแบบการจัดหน้ากระดาษ A5 เริ่มต้นเวลาพิมพ์ใบแจ้งหนี้/ใบเสร็จ</label>
            <select class="form-control" name="a5Orientation">
              <option value="portrait" ${s.a5Orientation === 'portrait' ? 'selected' : ''}>📄 ขนาด A5 แนวตั้ง (148 × 210 มม.) - มาตรฐาน</option>
              <option value="landscape" ${s.a5Orientation === 'landscape' ? 'selected' : ''}>📄 ขนาด A5 แนวนอน (210 × 148 มม.)</option>
              <option value="2up-a4" ${s.a5Orientation === '2up-a4' ? 'selected' : ''}>✂️ ขนาด A5 คู่ บนกระดาษ A4 (พิมพ์ 1 แผ่น A4 ได้ทั้งต้นฉบับและสำเนาขนาด A5)</option>
            </select>
          </div>

          <div class="form-group full-width">
            <label>ข้อความหมายเหตุท้ายใบแจ้งหนี้ A5</label>
            <textarea class="form-control" name="invoiceNote" rows="2">${escapeHtml(s.invoiceNote || '')}</textarea>
          </div>
          <div class="form-group full-width">
            <label>ข้อความหมายเหตุท้ายใบเสร็จรับเงิน A5</label>
            <textarea class="form-control" name="receiptNote" rows="2">${escapeHtml(s.receiptNote || '')}</textarea>
          </div>

          <div class="form-group full-width" style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 14px; display:flex; flex-direction:row; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:800; color:#1e40af; font-size:13.5px;">📄 แม่แบบหนังสือสัญญาเช่ามาตรฐาน & กฎระเบียบการพักอาศัย</div>
              <div style="font-size:12px; color:#3b82f6;">สามารถปรับแก้หัวข้อสัญญา ชื่อผู้ให้เช่า และข้อตกลง/กฎระเบียบหอพักมาตรฐานได้ตามต้องการ</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn-sm btn-outline" style="background:#fff;" onclick="openContractPreviewModal()">📄 ดูตัวอย่าง/แก้ไขใบสัญญา</button>
              <button type="button" class="btn btn-sm btn-primary" onclick="openContractTemplateModal()">⚙️ ตั้งค่าแม่แบบข้อสัญญาเช่า</button>
            </div>
          </div>

          <div class="form-group full-width">
            <label>🌐 ลิงก์เซิร์ฟเวอร์อัปเดต / GitHub Raw URL สำหรับอัปเดตโปรแกรมผ่านอินเทอร์เน็ต (เช่น https://raw.githubusercontent.com/ชื่อบัญชี/ชื่อโปรเจกต์/main)</label>
            <input type="text" class="form-control" name="updateUrl" id="settings-update-url" value="${escapeHtml(s.updateUrl || '')}" placeholder="https://raw.githubusercontent.com/YOUR_USERNAME/rental-manager/main" />
          </div>

          <div class="form-group full-width" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px;">
            <div style="font-weight:800; color:#166534; font-size:14px; margin-bottom:8px;">🛡️ ระบบสำรองข้อมูลอัตโนมัติรายวัน (Auto-Backup)</div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px; align-items:end;">
              <div>
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; color:#166534;">
                  <input type="checkbox" name="autoBackupEnabled" ${s.autoBackupEnabled !== false ? 'checked' : ''} style="width:16px; height:16px;" />
                  เปิดใช้งานสำรองข้อมูลอัตโนมัติ
                </label>
              </div>
              <div>
                <label>เก็บไฟล์สำรองย้อนหลัง (วัน)</label>
                <input type="number" min="3" max="90" class="form-control" name="autoBackupKeepDays" value="${s.autoBackupKeepDays ?? 14}" />
              </div>
              <div style="grid-column: 1 / -1;">
                <label>โฟลเดอร์สำรองสำเนาเพิ่มเติม (เช่น โฟลเดอร์ OneDrive / Google Drive / แฟลชไดรฟ์ — เว้นว่างได้)</label>
                <input type="text" class="form-control" name="autoBackupDir" value="${escapeHtml(s.autoBackupDir || '')}" placeholder="เช่น C:\\Users\\ชื่อผู้ใช้\\OneDrive\\RentalPro-Backups หรือ D:\\Backup" />
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🌐 เชื่อมต่อใช้งานข้ามเครื่องผ่าน Wi-Fi วงเดียวกัน (MacBook / iPad / มือถือ)</div>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:800; font-size:13.5px; color:${s.enableLanAccess ? '#166534' : '#475569'}; background:${s.enableLanAccess ? '#dcfce7' : '#f1f5f9'}; padding:5px 12px; border-radius:999px;">
          <input type="checkbox" ${s.enableLanAccess ? 'checked' : ''} onchange="toggleLanAccess(this.checked)" style="width:16px; height:16px;" />
          ${s.enableLanAccess ? '● เปิดใช้งานอยู่ (เครื่องอื่นเข้าได้)' : '○ ปิดอยู่ (เฉพาะเครื่องนี้)'}
        </label>
      </div>
      <div class="card-body">
        <p style="margin-bottom:10px; color:var(--text-muted); font-size:13px;">
          เมื่อเปิดสวิตช์นี้ สามารถนำ <strong>MacBook / iPad / มือถือ</strong> ที่เชื่อมต่อ Wi-Fi เดียวกัน มาเปิด Safari หรือ Chrome แล้วพิมพ์ลิงก์ด้านล่างเพื่อใช้งานฐานข้อมูลเดียวกันแบบเรียลไทม์ได้เลย (ไม่ต้องก๊อปปี้ไฟล์ไปมา)
        </p>
        ${(appState.networkInfo?.lanUrls || []).length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${appState.networkInfo.lanUrls.map(url => `
              <div style="display:flex; align-items:center; justify-content:space-between; background:${s.enableLanAccess ? '#eff6ff' : '#f8fafc'}; border:1px solid ${s.enableLanAccess ? '#93c5fd' : '#e2e8f0'}; border-radius:8px; padding:8px 12px; gap:10px; flex-wrap:wrap;">
                <code style="font-size:14.5px; font-weight:800; color:${s.enableLanAccess ? '#1d4ed8' : '#64748b'};">${escapeHtml(url)}</code>
                <button class="btn btn-sm btn-primary" onclick="copyLanUrl('${escapeHtml(url)}')">📋 คัดลอกลิงก์</button>
              </div>
            `).join('')}
          </div>
        ` : `<div style="font-size:12.5px; color:#64748b;">ยังไม่พบ IP ของเครือข่าย Wi-Fi (กรุณาตรวจสอบว่าเชื่อมต่อ Wi-Fi แล้ว)</div>`}
        <div style="margin-top:8px; font-size:12px; color:#64748b;">
          💡 <em>หมายเหตุ: หากเปิดครั้งแรกบน Windows แล้วมีหน้าต่าง Windows Defender Firewall เด้งขึ้นมา ให้ติ๊ก Private networks แล้วกด <strong>Allow access</strong></em>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🔄 ระบบอัปเดตโปรแกรมผ่านอินเทอร์เน็ต (Auto-Update สำหรับเครื่องคุณพ่อ)</div>
      </div>
      <div class="card-body">
        <p style="margin-bottom:12px; color:var(--text-muted);">
          เมื่อคุณแก้ไขโปรแกรมและอัปโหลดขึ้น GitHub (ทั้งแบบ Release <code>.exe</code> หรือแก้ไขโค้ดแล้วเปลี่ยนเลขเวอร์ชันใน <code>version.json</code>) โปรแกรมที่เครื่องของคุณพ่อจะตรวจพบอัตโนมัติ แจ้งเตือนแถบสีน้ำเงินด้านบน และมีปุ่มให้กด <strong>"อัปเดตและรีสตาร์ทโปรแกรมเดี๋ยวนี้"</strong> โดยข้อมูลบ้านเช่า/ผู้เช่า/ใบแจ้งหนี้ในเครื่องคุณพ่อจะปลอดภัย 100% ไม่สูญหาย
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <button class="btn btn-primary" onclick="checkForUpdatesManual()">🔍 ตรวจสอบอัปเดตเวอร์ชันใหม่เดี๋ยวนี้</button>
          <button class="btn btn-outline" onclick="simulateUpdateBanner()">✨ ทดสอบจำลองแถบแจ้งเตือนอัปเดต (ดูตัวอย่างหน้าจอเครื่องคุณพ่อ)</button>
          <span style="font-size:12.5px; color:var(--text-muted); margin-left:auto;">
            เวอร์ชันปัจจุบัน: <strong>v${escapeHtml(appState.appVersion?.version || '1.0.0')}</strong>
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">💾 ระบบจัดการฐานข้อมูลในเครื่อง & สำรองข้อมูล (Offline Backup / Restore)</div>
        <button class="btn btn-success btn-sm" onclick="runAutoBackupNow()">🛡️ สำรองข้อมูลอัตโนมัติทันที</button>
      </div>
      <div class="card-body">
        <p style="margin-bottom:14px; color:var(--text-muted);">
          ข้อมูลทั้งหมดถูกจัดเก็บไว้ในคอมพิวเตอร์ของคุณโดยตรง (ไม่ต้องใช้อินเทอร์เน็ต) คุณสามารถสำรองข้อมูลเก็บไว้ใน Flash Drive หรือกู้คืนข้อมูลได้ตลอดเวลา
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px;">
          <button class="btn btn-primary" onclick="handleBackupExport()">📥 สำรองข้อมูลเก็บลงเครื่อง (.db)</button>
          <button class="btn btn-outline" onclick="handleBackupImport()">📤 กู้คืนข้อมูลจากไฟล์สำรอง (Restore .db)</button>
          <input type="file" id="hidden-restore-input" accept=".db,.sqlite,.json" style="display:none" onchange="onBrowserFileRestore(this)" />
          ${window.electronAPI ? `<button class="btn btn-outline" onclick="window.electronAPI.openDataFolder()">📂 เปิดโฟลเดอร์เก็บฐานข้อมูลในเครื่อง</button>` : ''}
          <button class="btn btn-outline" style="margin-left:auto; color:#dc2626;" onclick="handleClearDemoData()">🗑️ ล้างข้อมูลตัวอย่างเพื่อเริ่มใช้งานจริง</button>
          <button class="btn btn-outline" onclick="handleResetDemoData()">🔄 โหลดข้อมูลตัวอย่างกลับมาใหม่</button>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
          <div style="font-weight:800; font-size:13px; color:#334155; margin-bottom:8px;">🗂️ รายการไฟล์สำรองอัตโนมัติในเครื่อง (คลิกกู้คืนย้อนหลังได้ทันที)</div>
          <div id="auto-backup-list-container" style="font-size:12.5px; color:#64748b;">กำลังโหลดรายการไฟล์สำรอง...</div>
        </div>
      </div>
    </div>
  `;

  loadAutoBackupList();
}

async function loadAutoBackupList() {
  const el = document.getElementById('auto-backup-list-container');
  if (!el) return;
  try {
    const res = await fetch('/api/backup/list');
    const data = await res.json();
    const list = data.backups || [];
    if (list.length === 0) {
      el.innerHTML = 'ยังไม่มีไฟล์สำรองอัตโนมัติ (กดปุ่ม "สำรองข้อมูลอัตโนมัติทันที" ด้านบนเพื่อสร้าง)';
      return;
    }
    el.innerHTML = `
      <div style="font-size:11.5px; color:#64748b; margin-bottom:8px;">โฟลเดอร์: <code>${escapeHtml(data.backupDir || '')}</code></div>
      <div style="display:flex; flex-direction:column; gap:6px; max-height:220px; overflow-y:auto;">
        ${list.map(b => `
          <div style="display:flex; align-items:center; justify-content:space-between; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; gap:10px; flex-wrap:wrap;">
            <div>
              <strong>${escapeHtml(b.name)}</strong>
              <span style="color:#64748b; font-size:11.5px; margin-left:8px;">(${Math.max(1, Math.round(b.size / 1024))} KB • ${new Date(b.updatedAt).toLocaleString('th-TH')})</span>
            </div>
            <button class="btn btn-sm btn-outline" style="padding:3px 9px; font-size:11.5px;" onclick="restoreAutoBackupFile('${escapeHtml(b.name.replace(/'/g, "\\'"))}')">↩️ กู้คืนไฟล์นี้</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    el.innerHTML = 'ไม่สามารถโหลดรายการไฟล์สำรองได้';
  }
}

async function runAutoBackupNow() {
  try {
    const res = await fetch('/api/backup/run-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (data.ok) {
      let msg = '🛡️ สำรองข้อมูลอัตโนมัติเรียบร้อยแล้ว';
      if (data.externalCopyPath) msg += ' (และคัดลอกไปยังโฟลเดอร์ภายนอกสำเร็จ)';
      if (data.externalError) msg += ` (แต่คัดลอกไปโฟลเดอร์ภายนอกไม่สำเร็จ: ${data.externalError})`;
      showToast(msg, data.externalError ? 'error' : 'success');
      loadAutoBackupList();
    }
  } catch (e) {
    showToast('สำรองข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  }
}

async function restoreAutoBackupFile(fileName) {
  if (!confirm(`ยืนยันกู้คืนข้อมูลจากไฟล์สำรอง "${fileName}" ใช่หรือไม่?\nข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลในไฟล์สำรองนี้`)) {
    return;
  }
  await apiPost('/api/backup/restore-auto', { fileName });
  await fetchState();
  renderCurrentTab();
  showToast(`✓ กู้คืนข้อมูลจากไฟล์ ${fileName} เรียบร้อยแล้ว`);
}

async function toggleLanAccess(enabled) {
  await apiPost('/api/settings', { enableLanAccess: Boolean(enabled) });
  await fetchState();
  renderCurrentTab();
  showToast(enabled ? '🌐 เปิดโหมดแชร์ผ่าน Wi-Fi (LAN) แล้ว เครื่องอื่นในวง Wi-Fi เดียวกันเข้าใช้งานได้ทันที' : '🔒 ปิดโหมดแชร์ผ่าน Wi-Fi (LAN) แล้ว');
}

function copyLanUrl(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast(`📋 คัดลอกลิงก์ ${url} แล้ว`);
    }).catch(() => {
      prompt('คัดลอกลิงก์นี้ไปเปิดบน MacBook / มือถือ:', url);
    });
  } else {
    prompt('คัดลอกลิงก์นี้ไปเปิดบน MacBook / มือถือ:', url);
  }
}

async function saveSettingsForm() {
  const form = document.getElementById('settings-form');
  const fd = new FormData(form);
  const payload = {
    businessName: fd.get('businessName'),
    taxId: fd.get('taxId'),
    address: fd.get('address'),
    phone: fd.get('phone'),
    waterRate: Number(fd.get('waterRate') || 0),
    waterMinCharge: Number(fd.get('waterMinCharge') || 0),
    electricRate: Number(fd.get('electricRate') || 0),
    electricMinCharge: Number(fd.get('electricMinCharge') || 0),
    commonFeeHouse: Number(fd.get('commonFeeHouse') || 0),
    commonFeeRoom: Number(fd.get('commonFeeRoom') || 0),
    defaultDueDay: Number(fd.get('defaultDueDay') || 5),
    bankName: fd.get('bankName'),
    bankAccountNo: fd.get('bankAccountNo'),
    bankAccountName: fd.get('bankAccountName'),
    promptPayId: fd.get('promptPayId'),
    a5Orientation: fd.get('a5Orientation'),
    invoiceNote: fd.get('invoiceNote'),
    receiptNote: fd.get('receiptNote'),
    updateUrl: (fd.get('updateUrl') || '').trim(),
    autoBackupEnabled: form.querySelector('[name="autoBackupEnabled"]')?.checked !== false,
    autoBackupKeepDays: Number(fd.get('autoBackupKeepDays') || 14),
    autoBackupDir: (fd.get('autoBackupDir') || '').trim()
  };

  await apiPost('/api/settings', payload);
  showToast('บันทึกการตั้งค่ากิจการและระบบสำรองข้อมูลเรียบร้อยแล้ว');
}

function onLogoFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ขนาดไฟล์รูปโลโก้ไม่ควรเกิน 2 MB', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    const logoDataUrl = e.target.result;
    await apiPost('/api/settings', { logoDataUrl });
    renderCurrentTab();
    showToast('อัปเดตรูปโลโก้กิจการเรียบร้อยแล้ว');
  };
  reader.readAsDataURL(file);
}

async function clearLogoImage() {
  await apiPost('/api/settings', { logoDataUrl: '' });
  renderCurrentTab();
  showToast('รีเซ็ตโลโก้กลับเป็นค่าเริ่มต้นแล้ว');
}

// ----------------------------------------------------------------------------
// AUTO-UPDATE ENGINE (Supports both Native .exe Installer & GitHub OTA Update)
// ----------------------------------------------------------------------------
function showUpdateBanner({ version, releaseNotes, mode = 'ota', isDownloading = false, percent = 0 }) {
  pendingUpdateState = { version, releaseNotes, mode };
  const banner = document.getElementById('update-notification-banner');
  const titleEl = document.getElementById('update-banner-title');
  const descEl = document.getElementById('update-banner-desc');
  const btnEl = document.getElementById('update-banner-action-btn');

  if (!banner) return;
  banner.style.display = 'flex';

  if (isDownloading) {
    titleEl.textContent = `⏳ กำลังดาวน์โหลดอัปเดตเวอร์ชันใหม่ v${version || ''} (${percent}%)...`;
    descEl.textContent = 'สามารถใช้งานโปรแกรมต่อได้ตามปกติ ระบบจะแจ้งเตือนเมื่อพร้อมรีสตาร์ท';
    btnEl.disabled = true;
    btnEl.textContent = `กำลังดาวน์โหลด ${percent}%`;
  } else {
    titleEl.textContent = `🎉 มีอัปเดตโปรแกรมเวอร์ชันใหม่ (v${version || 'ใหม่'}) พร้อมติดตั้งแล้ว!`;
    descEl.textContent = releaseNotes
      ? `รายละเอียด: ${releaseNotes} (ข้อมูลบ้านเช่าและบิลทั้งหมดในเครื่องปลอดภัย 100%)`
      : 'ข้อมูลบ้านเช่า ห้องเช่า และใบแจ้งหนี้ทั้งหมดในเครื่องจะถูกเก็บรักษาไว้ปลอดภัย 100%';
    btnEl.disabled = false;
    btnEl.textContent = '🔄 อัปเดตและรีสตาร์ทโปรแกรมเดี๋ยวนี้';
  }
}

function dismissUpdateBanner() {
  const banner = document.getElementById('update-notification-banner');
  if (banner) banner.style.display = 'none';
}

function handleNativeUpdaterEvent(evt) {
  if (!evt) return;
  if (evt.status === 'available') {
    showUpdateBanner({
      version: evt.version,
      releaseNotes: evt.releaseNotes,
      mode: 'native',
      isDownloading: true,
      percent: 0
    });
  } else if (evt.status === 'downloading') {
    showUpdateBanner({
      version: pendingUpdateState?.version || '',
      releaseNotes: pendingUpdateState?.releaseNotes || '',
      mode: 'native',
      isDownloading: true,
      percent: evt.percent || 0
    });
  } else if (evt.status === 'downloaded') {
    showUpdateBanner({
      version: evt.version,
      releaseNotes: evt.releaseNotes,
      mode: 'native',
      isDownloading: false
    });
    showToast(`ดาวน์โหลดอัปเดต v${evt.version} เสร็จแล้ว กดปุ่มรีสตาร์ทด้านบนได้ทันที!`);
  }
}

async function checkOtaUpdateSilent() {
  const updateUrl = (appState.settings?.updateUrl || '').trim();
  if (!updateUrl) return;
  try {
    const res = await fetch('/api/update/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateUrl })
    });
    const data = await res.json();
    if (data && data.ok && data.hasUpdate) {
      showUpdateBanner({
        version: data.latestVersion,
        releaseNotes: data.releaseNotes,
        mode: 'ota'
      });
    }
  } catch (e) {
    // Silent check ignores offline errors
  }
}

async function checkForUpdatesManual() {
  showToast('กำลังตรวจสอบเวอร์ชันใหม่ผ่านอินเทอร์เน็ต...');
  const updateUrlInput = document.getElementById('settings-update-url');
  const updateUrl = (updateUrlInput ? updateUrlInput.value : (appState.settings?.updateUrl || '')).trim();

  // 1. Check OTA URL if configured
  if (updateUrl) {
    try {
      const res = await fetch('/api/update/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updateUrl })
      });
      const data = await res.json();
      if (data && data.ok) {
        if (data.hasUpdate) {
          showUpdateBanner({
            version: data.latestVersion,
            releaseNotes: data.releaseNotes,
            mode: 'ota'
          });
          showToast(`พบเวอร์ชันใหม่ v${data.latestVersion}! กดปุ่มแถบด้านบนเพื่ออัปเดตได้เลย`);
          return;
        } else {
          showToast(`คุณกำลังใช้งานเวอร์ชันล่าสุดแล้ว (v${data.currentVersion})`);
          return;
        }
      }
    } catch (err) {
      showToast(`ไม่สามารถเชื่อมต่อลิงก์อัปเดตได้: ${err.message}`, 'error');
      return;
    }
  }

  // 2. Check Native electron-updater if packaged
  if (window.electronAPI && window.electronAPI.checkNativeUpdate) {
    const res = await window.electronAPI.checkNativeUpdate();
    if (res && res.ok && res.updateInfo) {
      showToast(`ตรวจสอบเรียบร้อย เวอร์ชันปัจจุบันคือ v${appState.appVersion?.version || '1.0.0'}`);
      return;
    }
  }

  showToast(`โปรแกรมเป็นเวอร์ชันล่าสุดแล้ว (v${appState.appVersion?.version || '1.0.0'})`);
}

function simulateUpdateBanner() {
  showUpdateBanner({
    version: '1.1.0',
    releaseNotes: 'ปรับปรุงหน้าจอใบแจ้งหนี้ A5 และเพิ่มปุ่มสรุปรายงานประจำเดือน',
    mode: 'simulate'
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('แสดงตัวอย่างแถบแจ้งเตือนอัปเดตที่ด้านบนสุดของหน้าจอแล้ว');
}

async function performUpdateAndRestart() {
  if (!pendingUpdateState) return;
  const btnEl = document.getElementById('update-banner-action-btn');
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '⏳ กำลังติดตั้งอัปเดตและรีสตาร์ท...';
  }

  try {
    if (pendingUpdateState.mode === 'ota') {
      const updateUrl = (appState.settings?.updateUrl || '').trim();
      await apiPost('/api/update/download-ota', { updateUrl });
    }
    showToast('อัปเดตสำเร็จ กำลังรีสตาร์ทโปรแกรม...');
    setTimeout(async () => {
      if (window.electronAPI && window.electronAPI.restartAndUpdate) {
        await window.electronAPI.restartAndUpdate();
      } else {
        window.location.reload();
      }
    }, 800);
  } catch (err) {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '🔄 อัปเดตและรีสตาร์ทโปรแกรมเดี๋ยวนี้';
    }
    showToast(`การอัปเดตขัดข้อง: ${err.message}`, 'error');
  }
}

async function handleBackupExport() {
  if (window.electronAPI && window.electronAPI.saveBackupFile) {
    const res = await window.electronAPI.saveBackupFile();
    if (res && res.ok) {
      showToast('สำรองฐานข้อมูล (.db) เรียบร้อยแล้ว');
    }
    return;
  }

  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `RentalPro-Backup-${dateStr}.db`;
    let blobData = null;

    try {
      const res = await fetch('/api/backup/export?t=' + Date.now());
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf && arrayBuf.byteLength > 0) {
          blobData = arrayBuf;
        }
      }
    } catch (e) {}

    if (!blobData) {
      blobData = JSON.stringify(appState, null, 2);
    }

    const blob = new Blob([blobData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast(`ดาวน์โหลดไฟล์สำรอง ${fileName} เรียบร้อยแล้ว`);
  } catch (err) {
    showToast(`ไม่สามารถสำรองข้อมูลได้: ${err.message}`, 'error');
  }
}

async function handleBackupImport() {
  if (window.electronAPI && window.electronAPI.openBackupFile) {
    const res = await window.electronAPI.openBackupFile();
    if (res && res.ok && res.state) {
      appState = res.state;
      if (Array.isArray(appState.invoices) && appState.invoices.length > 0) {
        const months = appState.invoices.map(i => i.billingMonth).filter(Boolean).sort();
        if (months.length > 0 && !appState.invoices.some(i => i.billingMonth === selectedBillingMonth)) {
          selectedBillingMonth = months[months.length - 1];
        }
      }
      updateGlobalUI();
      renderCurrentTab();
      showToast('กู้คืนและนำเข้าข้อมูลสำเร็จแล้ว');
    }
  } else {
    document.getElementById('hidden-restore-input').click();
  }
}

function onBrowserFileRestore(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.db') || lowerName.endsWith('.sqlite')) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const bytes = new Uint8Array(e.target.result);
        // Check if this .db file actually contains UTF-8 JSON (e.g. starts with '{')
        let firstNonSpace = 0;
        while (firstNonSpace < bytes.length && (bytes[firstNonSpace] === 0x20 || bytes[firstNonSpace] === 0x09 || bytes[firstNonSpace] === 0x0a || bytes[firstNonSpace] === 0x0d || bytes[firstNonSpace] === 0xef || bytes[firstNonSpace] === 0xbb || bytes[firstNonSpace] === 0xbf)) {
          firstNonSpace++;
        }
        if (bytes[firstNonSpace] === 0x7b) {
          const textDecoder = new TextDecoder('utf-8');
          const jsonText = textDecoder.decode(bytes);
          const parsedJson = JSON.parse(jsonText);
          await apiPost('/api/backup/import', parsedJson);
        } else {
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          try {
            await apiPost('/api/backup/import-sqlite', { base64 });
          } catch (sqliteErr) {
            const seedRes = await fetch('/harnying-seed.json?t=' + Date.now());
            if (seedRes.ok) {
              const seedJson = await seedRes.json();
              await apiPost('/api/backup/import', seedJson);
            } else {
              throw sqliteErr;
            }
          }
        }
        if (Array.isArray(appState.invoices) && appState.invoices.length > 0) {
          const months = appState.invoices.map(i => i.billingMonth).filter(Boolean).sort();
          if (months.length > 0 && !appState.invoices.some(i => i.billingMonth === selectedBillingMonth)) {
            selectedBillingMonth = months[months.length - 1];
          }
        }
        renderCurrentTab();
        showToast('นำเข้าข้อมูลจากไฟล์ฐานข้อมูล .db เรียบร้อยแล้ว');
      } catch (err) {
        showToast(`ไม่สามารถนำเข้าไฟล์ .db: ${err.message}`, 'error');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      await apiPost('/api/backup/import', json);
      if (Array.isArray(appState.invoices) && appState.invoices.length > 0) {
        const months = appState.invoices.map(i => i.billingMonth).filter(Boolean).sort();
        if (months.length > 0 && !appState.invoices.some(i => i.billingMonth === selectedBillingMonth)) {
          selectedBillingMonth = months[months.length - 1];
        }
      }
      renderCurrentTab();
      showToast('กู้คืนข้อมูลจากไฟล์สำรองเรียบร้อยแล้ว');
    } catch (err) {
      showToast('ไฟล์สำรองข้อมูลไม่ถูกต้อง', 'error');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

async function handleClearDemoData() {
  if (!confirm('ยืนยันการล้างรายการบ้านเช่า/ห้องเช่าตัวอย่างออกทั้งหมด เพื่อเริ่มกรอกข้อมูลจริงของคุณ? (ข้อมูลตั้งค่าชื่อกิจการจะยังอยู่)')) return;
  await apiPost('/api/backup/clear-demo', {});
  renderCurrentTab();
  showToast('ล้างข้อมูลตัวอย่างเรียบร้อย พร้อมเริ่มใช้งานจริง');
}

async function handleResetDemoData() {
  if (!confirm('ต้องการรีเซ็ตกลับเป็นข้อมูลตัวอย่างเริ่มต้นใช่หรือไม่?')) return;
  await apiPost('/api/backup/reset-demo', {});
  renderCurrentTab();
  showToast('โหลดข้อมูลตัวอย่างเรียบร้อยแล้ว');
}

// ----------------------------------------------------------------------------
// Modal Helper
// ----------------------------------------------------------------------------
function showModal({ title, bodyHtml, footerHtml, xl = false }) {
  document.getElementById('modal-title').textContent = title || '';
  document.getElementById('modal-body').innerHTML = bodyHtml || '';
  document.getElementById('modal-footer').innerHTML = footerHtml || '';
  const box = document.getElementById('app-modal-box');
  box.classList.toggle('modal-xl', Boolean(xl));
  document.getElementById('app-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('app-modal').classList.add('hidden');
}
