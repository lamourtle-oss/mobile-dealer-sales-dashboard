/* Mobile Dealer Sales Dashboard */

const state = {
  branch: '',
  region: '',
  month: '',
  dealerSearch: '',
  tier: 'all',
  sort: {}, // per-table {key, dir}
};

const fmtMoney = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtNum = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct = n => (n === null || n === undefined) ? '-' : n.toFixed(1) + '%';
const tierClass = t => 'tier-' + (t || '').replace(' ', '');
const tierEmoji = t => t === 'Reliable' ? '🟢' : t === 'Watch' ? '🟡' : t === 'High Risk' ? '🔴' : '';
const shopNameHtml = n => n ? n : '<span class="shop-name-na">N/A</span>';
const statusBadgeHtml = s => {
  if (!s) return '<span class="status-none">-</span>';
  const cls = s === 'CLOSED' ? 'status-CLOSED' : s === 'INACTIVE' ? 'status-INACTIVE' : 'status-none';
  return `<span class="status-badge ${cls}">${s}</span>`;
};
const escapeAttr = s => (s || '').replace(/"/g, '&quot;');
const verifyBadgeHtml = (status, note) => {
  if (!status) return '<span class="verify-na">-</span>';
  const title = note ? ` title="${escapeAttr(note)}"` : '';
  if (status === 'พบตัวตนออนไลน์') return `<span class="verify-badge verify-found"${title}>✅ พบตัวตนออนไลน์</span>`;
  if (status.indexOf('ปิดกิจการ') !== -1) return `<span class="verify-badge verify-closed"${title}>⛔ ยืนยันปิดกิจการ</span>`;
  if (status.indexOf('N/A') !== -1 || status.indexOf('ไม่มีชื่อร้าน') !== -1 || status.indexOf('Temp SN') !== -1) return '<span class="verify-na">N/A</span>';
  return `<span class="verify-badge verify-notfound"${title}>ไม่พบ/ไม่ชัดเจน</span>`;
};

let DATA = {};

// full (unsliced) filtered row sets, kept in sync by each render*Table() call so
// the download buttons can export everything currently matching the filters,
// not just the rows visible in the (capped) on-screen table.
const lastRows = { branchTable: [], dealerTable: [], watchTable: [] };

async function loadAll() {
  const files = ['branch_month_type', 'branch_month_dealer', 'dealer_profile', 'watchlist', 'months', 'month_overview', 'kpi'];
  const results = await Promise.all(files.map(f => fetch('data/' + f + '.json').then(r => r.json())));
  files.forEach((f, i) => DATA[f] = results[i]);

  // dealer lookup map
  DATA.dealerMap = {};
  DATA.dealer_profile.forEach(d => DATA.dealerMap[d.dealer_code] = d);

  // branch -> region lookup (derived from branch_month_type, which carries region per branch)
  DATA.branchRegion = {};
  DATA.branch_month_type.forEach(r => { if (r.branch && r.region) DATA.branchRegion[r.branch] = r.region; });
  const regionOf = branch => DATA.branchRegion[branch] || '';

  // attach region to dealer_profile and watchlist rows for filtering/display
  DATA.dealer_profile.forEach(d => { d.region = regionOf(d.primary_branch); });
  DATA.watchlist.forEach(w => { w.region = regionOf(w.branch); });
}

function populateFilters() {
  const branches = [...new Set(DATA.branch_month_type.map(r => r.branch))].sort();
  const branchSel = document.getElementById('branchFilter');
  branches.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = b;
    branchSel.appendChild(o);
  });

  const regions = [...new Set(DATA.branch_month_type.map(r => r.region).filter(Boolean))].sort();
  const regionSel = document.getElementById('regionFilter');
  regions.forEach(rg => {
    const o = document.createElement('option');
    o.value = rg; o.textContent = rg;
    regionSel.appendChild(o);
  });

  const monthSel = document.getElementById('monthFilter');
  DATA.months.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    monthSel.appendChild(o);
  });

  branchSel.addEventListener('change', e => { state.branch = e.target.value; renderAll(); });
  regionSel.addEventListener('change', e => { state.region = e.target.value; renderAll(); });
  monthSel.addEventListener('change', e => { state.month = e.target.value; renderAll(); });
  document.getElementById('dealerSearch').addEventListener('input', e => { state.dealerSearch = e.target.value.trim().toUpperCase(); renderAll(); });

  document.querySelectorAll('#tierChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#tierChips .chip').forEach(c => c.dataset.active = '0');
      chip.dataset.active = '1';
      state.tier = chip.dataset.tier;
      renderAll();
    });
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    state.branch = ''; state.region = ''; state.month = ''; state.dealerSearch = ''; state.tier = 'all';
    branchSel.value = ''; regionSel.value = ''; monthSel.value = ''; document.getElementById('dealerSearch').value = '';
    document.querySelectorAll('#tierChips .chip').forEach(c => c.dataset.active = (c.dataset.tier === 'all' ? '1' : '0'));
    renderAll();
  });

  document.querySelectorAll('th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const table = th.closest('table').id;
      const key = th.dataset.key;
      const cur = state.sort[table];
      const dir = (cur && cur.key === key && cur.dir === 'desc') ? 'asc' : 'desc';
      state.sort[table] = { key, dir };
      renderAll();
    });
  });

  setupDownloadButtons();

  const lu = new Date().toISOString().slice(0, 10);
  document.getElementById('lastUpdated').textContent = 'ข้อมูลถึง มี.ค. 2026 · สร้างแดชบอร์ด ' + lu;
}

// ---------------- CSV export ----------------

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(headers, keys, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(keys.map(k => csvEscape(r[k])).join(',')));
  // BOM so Excel opens Thai text as UTF-8 correctly
  return '﻿' + lines.join('\r\n');
}

function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function setupDownloadButtons() {
  document.getElementById('dlBranchTable').addEventListener('click', () => {
    const headers = ['สาขา', 'ภาค', 'เดือน', 'Dealer Code', 'ชื่อร้าน Dealer', 'สถานะร้าน', 'ยอดขาย (บาท)', 'จำนวน (หน่วย)', 'จำนวนบิล', 'สถานะความน่าเชื่อถือ', 'ประเภท Dealer'];
    const keys = ['branch', 'region', 'year_month', 'dealer_code', 'shop_name', 'dealer_status', 'sales', 'qty', 'txn', 'reliability_tier', 'tenure_label'];
    downloadCSV(`branch_dealer_month_${todayStamp()}.csv`, toCSV(headers, keys, lastRows.branchTable));
  });

  document.getElementById('dlDealerTable').addEventListener('click', () => {
    const headers = ['Dealer Code', 'ชื่อร้าน Dealer', 'สถานะร้าน', 'สาขาหลัก', 'ภาค', 'จำนวนสาขาที่ขาย', 'ยอดขายรวม (บาท)', 'จำนวนรวม (หน่วย)', 'จำนวนบิล', 'เดือนที่ขาย (/15)', '% ยกเลิก', '% ค้างชำระ', 'Risk Score', 'สถานะความน่าเชื่อถือ', 'ประเภท', 'ผลตรวจสอบ Google/Facebook', 'หมายเหตุการตรวจสอบ'];
    const keys = ['dealer_code', 'shop_name', 'dealer_status', 'primary_branch', 'region', 'n_branches', 'total_sales', 'total_qty', 'txn', 'n_months', 'cancel_rate', 'overdue_rate', 'risk_score', 'reliability_tier', 'tenure_label', 'verify_status', 'verify_note'];
    downloadCSV(`dealer_profile_${todayStamp()}.csv`, toCSV(headers, keys, lastRows.dealerTable));
  });

  document.getElementById('dlWatchTable').addEventListener('click', () => {
    const headers = ['สาขา', 'ภาค', 'เดือน', 'Direct Sale (บาท)', 'Mobile Dealer รวม (บาท)', 'Dealer เด่นสุดในเดือนนั้น', 'ชื่อร้าน Dealer', 'สถานะร้าน', 'ยอดขาย Dealer นี้ (บาท)', 'Risk Score', 'สถานะ', 'ผลตรวจสอบ Google/Facebook', 'หมายเหตุการตรวจสอบ'];
    const keys = ['branch', 'region', 'year_month', 'direct_sales', 'dealer_sales', 'dealer_code', 'shop_name', 'dealer_status', 'dealer_sales_this_month', 'dealer_risk_score', 'dealer_tier', 'verify_status', 'verify_note'];
    downloadCSV(`watchlist_anomaly_${todayStamp()}.csv`, toCSV(headers, keys, lastRows.watchTable));
  });
}

function sortRows(rows, tableId, defaultKey, defaultDir) {
  const s = state.sort[tableId] || { key: defaultKey, dir: defaultDir };
  const { key, dir } = s;
  const copy = [...rows];
  copy.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') { va = va || ''; vb = vb || ''; return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
    va = va || 0; vb = vb || 0;
    return dir === 'asc' ? va - vb : vb - va;
  });
  return copy;
}

function renderKpi() {
  const k = DATA.kpi;
  const cards = [
    { label: 'ยอดขายรวมทั้งหมด', value: '฿' + fmtMoney(k.total_sales), sub: fmtNum(k.total_txn) + ' รายการ' },
    { label: 'ยอดขายผ่าน Mobile Dealer', value: '฿' + fmtMoney(k.dealer_sales), sub: (k.dealer_sales / k.total_sales * 100).toFixed(1) + '% ของยอดรวม' },
    { label: 'ยอดขาย Direct Sale', value: '฿' + fmtMoney(k.direct_sales), sub: (k.direct_sales / k.total_sales * 100).toFixed(1) + '% ของยอดรวม' },
    { label: 'ยอดขาย Online', value: '฿' + fmtMoney(k.online_sales), sub: (k.online_sales / k.total_sales * 100).toFixed(1) + '% ของยอดรวม' },
    { label: 'จำนวน Mobile Dealer', value: fmtNum(k.n_dealers) + ' ราย', sub: fmtNum(k.n_branches) + ' สาขา' },
    { label: 'Dealer กลุ่ม High Risk', value: fmtNum(DATA.dealer_profile.filter(d => d.reliability_tier === 'High Risk').length) + ' ราย', sub: 'ควรตรวจสอบหน้าร้าน/ตัวตน' },
    { label: 'รายการยอดขายผิดปกติ', value: fmtNum(DATA.watchlist.length) + ' รายการ', sub: 'Direct ต่ำ + Dealer สูง + เสี่ยง' },
    { label: 'ร้านสถานะ CLOSED (ทางการ)', value: fmtNum(DATA.dealer_profile.filter(d => d.dealer_status === 'CLOSED').length) + ' ราย', sub: 'จากฐานข้อมูล MT_DEALER' },
    { label: 'พบตัวตนออนไลน์ (FB/Google)', value: fmtNum(DATA.dealer_profile.filter(d => d.verify_status === 'พบตัวตนออนไลน์').length) + ' ราย', sub: 'เฉพาะกลุ่ม Watch + High Risk' },
  ];
  document.getElementById('kpiRow').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join('');
}

let channelChart, qtyChart;

function renderCharts() {
  let rows = DATA.month_overview;
  if (state.branch || state.region) {
    // month_overview has no branch/region dimension; approximate using branch_month_type filtered
    let filtered = DATA.branch_month_type;
    if (state.branch) filtered = filtered.filter(r => r.branch === state.branch);
    if (state.region) filtered = filtered.filter(r => r.region === state.region);
    const agg = {};
    filtered.forEach(r => {
      const k = r.year_month + '|' + r.type_sale;
      agg[k] = agg[k] || { year_month: r.year_month, type_sale: r.type_sale, sales: 0, qty: 0, txn: 0 };
      agg[k].sales += r.sales; agg[k].qty += r.qty; agg[k].txn += r.txn;
    });
    rows = Object.values(agg);
  }

  const months = DATA.months;
  const byType = t => months.map(m => {
    const r = rows.filter(x => x.year_month === m && x.type_sale === t);
    return r.reduce((s, x) => s + x.sales, 0);
  });
  const qtyByMonth = months.map(m => {
    const r = rows.filter(x => x.year_month === m);
    return r.reduce((s, x) => s + x.qty, 0);
  });

  const ctx1 = document.getElementById('channelTrendChart');
  if (channelChart) channelChart.destroy();
  channelChart = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label: 'Direct sale', data: byType('Direc sale'), borderColor: '#4f8cff', backgroundColor: '#4f8cff33', tension: .3 },
        { label: 'Mobile Dealer', data: byType('Mobile Dealer'), borderColor: '#f0556b', backgroundColor: '#f0556b33', tension: .3 },
        { label: 'Online', data: byType('online'), borderColor: '#33c37c', backgroundColor: '#33c37c33', tension: .3 },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#9aa5c0' } } },
      scales: {
        x: { ticks: { color: '#9aa5c0' }, grid: { color: '#2a355055' } },
        y: { ticks: { color: '#9aa5c0', callback: v => '฿' + (v / 1e6).toFixed(1) + 'M' }, grid: { color: '#2a355055' } }
      }
    }
  });

  const ctx2 = document.getElementById('qtyChart');
  if (qtyChart) qtyChart.destroy();
  qtyChart = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{ label: 'จำนวนที่ขายได้ (หน่วย)', data: qtyByMonth, backgroundColor: '#7c5cffaa' }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9aa5c0' }, grid: { display: false } },
        y: { ticks: { color: '#9aa5c0' }, grid: { color: '#2a355055' } }
      }
    }
  });
}

function renderBranchTable() {
  let rows = DATA.branch_month_dealer.map(r => {
    const d = DATA.dealerMap[r.ARD_SALESMAN_CODE] || {};
    return {
      branch: r.branch, region: r.region, year_month: r.year_month,
      dealer_code: r.ARD_SALESMAN_CODE, sales: r.sales, qty: r.qty, txn: r.txn,
      shop_name: d.shop_name || null, dealer_status: d.dealer_status || '',
      reliability_tier: d.reliability_tier || '-', tenure_label: d.tenure_label || '-'
    };
  });

  if (state.branch) rows = rows.filter(r => r.branch === state.branch);
  if (state.region) rows = rows.filter(r => r.region === state.region);
  if (state.month) rows = rows.filter(r => r.year_month === state.month);
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.reliability_tier === state.tier);

  rows = sortRows(rows, 'branchTable', 'sales', 'desc');
  lastRows.branchTable = rows;
  document.getElementById('branchTableCount').textContent = rows.length.toLocaleString() + ' แถว';

  const MAX = 500;
  const shown = rows.slice(0, MAX);
  document.getElementById('branchTableBody').innerHTML = shown.map(r => `
    <tr>
      <td>${r.branch}</td>
      <td>${r.region}</td>
      <td>${r.year_month}</td>
      <td>${r.dealer_code}</td>
      <td>${shopNameHtml(r.shop_name)}</td>
      <td>${statusBadgeHtml(r.dealer_status)}</td>
      <td class="right">${fmtMoney(r.sales)}</td>
      <td class="right">${fmtNum(r.qty)}</td>
      <td class="right">${fmtNum(r.txn)}</td>
      <td><span class="tier-badge ${tierClass(r.reliability_tier)}">${tierEmoji(r.reliability_tier)} ${r.reliability_tier}</span></td>
      <td><span class="tenure-badge">${r.tenure_label}</span></td>
    </tr>`).join('');
}

function renderDealerTable() {
  let rows = DATA.dealer_profile;
  if (state.branch) rows = rows.filter(r => r.primary_branch === state.branch);
  if (state.region) rows = rows.filter(r => r.region === state.region);
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.reliability_tier === state.tier);
  if (state.month) rows = rows.filter(r => r.first_month <= state.month && r.last_month >= state.month);

  rows = sortRows(rows, 'dealerTable', 'total_sales', 'desc');
  lastRows.dealerTable = rows;
  document.getElementById('dealerTableCount').textContent = rows.length.toLocaleString() + ' dealer';

  const MAX = 500;
  const shown = rows.slice(0, MAX);
  document.getElementById('dealerTableBody').innerHTML = shown.map(r => `
    <tr>
      <td>${r.dealer_code}</td>
      <td>${shopNameHtml(r.shop_name)}</td>
      <td>${statusBadgeHtml(r.dealer_status)}</td>
      <td>${r.primary_branch}</td>
      <td>${r.region || '-'}</td>
      <td class="right">${r.n_branches}</td>
      <td class="right">${fmtMoney(r.total_sales)}</td>
      <td class="right">${fmtNum(r.total_qty)}</td>
      <td class="right">${fmtNum(r.txn)}</td>
      <td class="right">${r.n_months}</td>
      <td class="right">${fmtPct(r.cancel_rate)}</td>
      <td class="right">${fmtPct(r.overdue_rate)}</td>
      <td class="right">${r.risk_score}</td>
      <td><span class="tier-badge ${tierClass(r.reliability_tier)}">${tierEmoji(r.reliability_tier)} ${r.reliability_tier}</span></td>
      <td><span class="tenure-badge">${r.tenure_label}</span></td>
      <td>${verifyBadgeHtml(r.verify_status, r.verify_note)}</td>
    </tr>`).join('');
}

function renderWatchTable() {
  let rows = DATA.watchlist.map(r => {
    const d = DATA.dealerMap[r.dealer_code] || {};
    return Object.assign({}, r, {
      shop_name: d.shop_name || null, dealer_status: d.dealer_status || '',
      verify_status: d.verify_status || '', verify_note: d.verify_note || ''
    });
  });
  if (state.branch) rows = rows.filter(r => r.branch === state.branch);
  if (state.region) rows = rows.filter(r => r.region === state.region);
  if (state.month) rows = rows.filter(r => r.year_month === state.month);
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.dealer_tier === state.tier);

  rows = sortRows(rows, 'watchTable', 'dealer_sales', 'desc');
  lastRows.watchTable = rows;
  document.getElementById('watchlistCount').textContent = rows.length.toLocaleString() + ' รายการ';

  document.getElementById('watchTableBody').innerHTML = rows.map(r => `
    <tr class="anomaly-row">
      <td>${r.branch}</td>
      <td>${r.region || '-'}</td>
      <td>${r.year_month}</td>
      <td class="right">${fmtMoney(r.direct_sales)}</td>
      <td class="right">${fmtMoney(r.dealer_sales)}</td>
      <td>${r.dealer_code}</td>
      <td>${shopNameHtml(r.shop_name)}</td>
      <td>${statusBadgeHtml(r.dealer_status)}</td>
      <td class="right">${fmtMoney(r.dealer_sales_this_month)}</td>
      <td class="right">${r.dealer_risk_score}</td>
      <td><span class="tier-badge ${tierClass(r.dealer_tier)}">${tierEmoji(r.dealer_tier)} ${r.dealer_tier}</span></td>
      <td>${verifyBadgeHtml(r.verify_status, r.verify_note)}</td>
    </tr>`).join('');
}

function safe(fn, label) {
  try { fn(); } catch (e) { console.error('render error in ' + label, e); }
}

function renderAll() {
  safe(renderCharts, 'renderCharts');
  safe(renderBranchTable, 'renderBranchTable');
  safe(renderDealerTable, 'renderDealerTable');
  safe(renderWatchTable, 'renderWatchTable');
}

(async function init() {
  await loadAll();
  populateFilters();
  renderKpi();
  renderAll();
})();
