/* Mobile Dealer Sales Dashboard */

const state = {
  branch: '',
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

let DATA = {};

async function loadAll() {
  const files = ['branch_month_type', 'branch_month_dealer', 'dealer_profile', 'watchlist', 'months', 'month_overview', 'kpi'];
  const results = await Promise.all(files.map(f => fetch('data/' + f + '.json').then(r => r.json())));
  files.forEach((f, i) => DATA[f] = results[i]);

  // dealer lookup map
  DATA.dealerMap = {};
  DATA.dealer_profile.forEach(d => DATA.dealerMap[d.dealer_code] = d);
}

function populateFilters() {
  const branches = [...new Set(DATA.branch_month_type.map(r => r.branch))].sort();
  const branchSel = document.getElementById('branchFilter');
  branches.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = b;
    branchSel.appendChild(o);
  });

  const monthSel = document.getElementById('monthFilter');
  DATA.months.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    monthSel.appendChild(o);
  });

  branchSel.addEventListener('change', e => { state.branch = e.target.value; renderAll(); });
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
    state.branch = ''; state.month = ''; state.dealerSearch = ''; state.tier = 'all';
    branchSel.value = ''; monthSel.value = ''; document.getElementById('dealerSearch').value = '';
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

  const lu = new Date().toISOString().slice(0, 10);
  document.getElementById('lastUpdated').textContent = 'ข้อมูลถึง มี.ค. 2026 · สร้างแดชบอร์ด ' + lu;
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
  if (state.branch) {
    // month_overview has no branch dimension; approximate using branch_month_type filtered
    const filtered = DATA.branch_month_type.filter(r => r.branch === state.branch);
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
      reliability_tier: d.reliability_tier || '-', tenure_label: d.tenure_label || '-'
    };
  });

  if (state.branch) rows = rows.filter(r => r.branch === state.branch);
  if (state.month) rows = rows.filter(r => r.year_month === state.month);
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.reliability_tier === state.tier);

  rows = sortRows(rows, 'branchTable', 'sales', 'desc');
  document.getElementById('branchTableCount').textContent = rows.length.toLocaleString() + ' แถว';

  const MAX = 500;
  const shown = rows.slice(0, MAX);
  document.getElementById('branchTableBody').innerHTML = shown.map(r => `
    <tr>
      <td>${r.branch}</td>
      <td>${r.region}</td>
      <td>${r.year_month}</td>
      <td>${r.dealer_code}</td>
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
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.reliability_tier === state.tier);
  if (state.month) rows = rows.filter(r => r.first_month <= state.month && r.last_month >= state.month);

  rows = sortRows(rows, 'dealerTable', 'total_sales', 'desc');
  document.getElementById('dealerTableCount').textContent = rows.length.toLocaleString() + ' dealer';

  const MAX = 500;
  const shown = rows.slice(0, MAX);
  document.getElementById('dealerTableBody').innerHTML = shown.map(r => `
    <tr>
      <td>${r.dealer_code}</td>
      <td>${r.primary_branch}</td>
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
    </tr>`).join('');
}

function renderWatchTable() {
  let rows = DATA.watchlist;
  if (state.branch) rows = rows.filter(r => r.branch === state.branch);
  if (state.month) rows = rows.filter(r => r.year_month === state.month);
  if (state.dealerSearch) rows = rows.filter(r => r.dealer_code.toUpperCase().includes(state.dealerSearch));
  if (state.tier !== 'all') rows = rows.filter(r => r.dealer_tier === state.tier);

  rows = sortRows(rows, 'watchTable', 'dealer_sales', 'desc');
  document.getElementById('watchlistCount').textContent = rows.length.toLocaleString() + ' รายการ';

  document.getElementById('watchTableBody').innerHTML = rows.map(r => `
    <tr class="anomaly-row">
      <td>${r.branch}</td>
      <td>${r.year_month}</td>
      <td class="right">${fmtMoney(r.direct_sales)}</td>
      <td class="right">${fmtMoney(r.dealer_sales)}</td>
      <td>${r.dealer_code}</td>
      <td class="right">${fmtMoney(r.dealer_sales_this_month)}</td>
      <td class="right">${r.dealer_risk_score}</td>
      <td><span class="tier-badge ${tierClass(r.dealer_tier)}">${tierEmoji(r.dealer_tier)} ${r.dealer_tier}</span></td>
    </tr>`).join('');
}

function renderAll() {
  renderCharts();
  renderBranchTable();
  renderDealerTable();
  renderWatchTable();
}

(async function init() {
  await loadAll();
  populateFilters();
  renderKpi();
  renderAll();
})();
