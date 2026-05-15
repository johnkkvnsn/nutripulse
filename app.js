/* ══════════════════════════════════════
   NutriPulse — App Logic v3
   REST API + Offline-First PWA
══════════════════════════════════════ */

// ─── STATE ───────────────────────────────
const APP = {
  user: null,
  token: null,  // JWT token
  today: getToday(),
  logs: {},     // { 'YYYY-MM-DD': { breakfast:[], lunch:[], dinner:[], snacks:[] } }
  weights: {},  // { 'YYYY-MM-DD': kg }
  charts: {},
  currentMeal: null,
  gender: 'male',
  goal: 'maintain',
  dark: true,
  mode: null,   // 'online' | 'offline' | null
  alertSettings: {
    enabled: true, // Master toggle
    reminders: { breakfast: true, lunch: true, dinner: true },
    goalAlerts: { 'calorie-goal': true, 'over-budget': true, 'streak': true, 'weekly-report': true }
  },
  notifications: [],  // { id, type, icon, title, desc, time, unread }
};

const TIPS = [
  'Drinking water before meals can reduce calorie intake by up to 13%.',
  'Eating slowly helps you feel full sooner — aim for 20 minutes per meal.',
  'Protein-rich breakfasts reduce cravings throughout the day.',
  'Pre-logging meals the night before improves dietary adherence.',
  'Colorful plates tend to be more nutritious — aim for 3+ colors per meal.',
  'Sleep deprivation increases hunger hormones — prioritize 7–9 hrs.',
  'Meal prepping on weekends reduces impulse eating by up to 40%.',
];

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// ─── API CLIENT ──────────────────────────
const API_BASE = '/api/v1';

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (APP.token) headers['Authorization'] = 'Bearer ' + APP.token;
  try {
    const res = await fetch(API_BASE + endpoint, { ...options, headers });
    const data = await res.json();
    if (res.status === 401) {
      console.warn('[API] Token expired or invalid');
      // Don't auto-logout — let offline cache work
    }
    return data;
  } catch (e) {
    console.warn('[API] Request failed, using offline cache', e);
    return { status: 'error', offline: true, message: 'Network unavailable' };
  }
}

function isOnline() { return APP.mode === 'online' && APP.token; }

// ─── STORAGE (offline-first cache) ───────
function save() {
  try {
    localStorage.setItem('np_user', JSON.stringify(APP.user));
    localStorage.setItem('np_logs', JSON.stringify(APP.logs));
    localStorage.setItem('np_weights', JSON.stringify(APP.weights));
    localStorage.setItem('np_dark', String(APP.dark));
    localStorage.setItem('np_gender', APP.gender);
    localStorage.setItem('np_goal', APP.goal);
    localStorage.setItem('np_alertSettings', JSON.stringify(APP.alertSettings));
    localStorage.setItem('np_notifications', JSON.stringify(APP.notifications));
    if (APP.token) localStorage.setItem('np_token', APP.token);
  } catch (e) { console.error('Save failed', e); }
}

function load() {
  try {
    const u = localStorage.getItem('np_user');
    const l = localStorage.getItem('np_logs');
    const w = localStorage.getItem('np_weights');
    if (u) APP.user = JSON.parse(u);
    if (l) APP.logs = JSON.parse(l);
    if (w) APP.weights = JSON.parse(w);
    const d = localStorage.getItem('np_dark');
    if (d !== null) APP.dark = d === 'true';
    APP.gender = localStorage.getItem('np_gender') || 'male';
    APP.goal = localStorage.getItem('np_goal') || 'maintain';
    const as = localStorage.getItem('np_alertSettings');
    if (as) APP.alertSettings = JSON.parse(as);
    const notifs = localStorage.getItem('np_notifications');
    if (notifs) APP.notifications = JSON.parse(notifs);
    const tk = localStorage.getItem('np_token');
    if (tk) APP.token = tk;
  } catch (e) { console.error('Load failed', e); }
}

// ─── SYNC: pull server data into local cache ─
async function syncFromServer() {
  if (!isOnline()) return;
  try {
    // Sync profile
    const profileRes = await api('/users/profile');
    if (profileRes.status === 'success') {
      const p = profileRes.profile;
      APP.user = {
        name: p.name, gender: p.gender, age: p.age,
        height: p.height, weight: p.weight,
        targetWeight: p.target_weight, activity: p.activity, goal: p.goal
      };
      APP.gender = p.gender || 'male';
      APP.goal = p.goal || 'maintain';
    }
    // Sync today's meals
    const mealsRes = await api('/meals?date=' + APP.today);
    if (mealsRes.status === 'success') {
      APP.logs[APP.today] = mealsRes.meals;
    }
    // Sync weight history
    const wtRes = await api('/weight/history?limit=60');
    if (wtRes.status === 'success') {
      APP.weights = {};
      (wtRes.weights || []).forEach(w => {
        APP.weights[w.weight_date] = w.weight_kg;
      });
    }
    save();
  } catch (e) { console.warn('[Sync] Failed', e); }
}

// ─── CALCULATIONS ─────────────────────────
function calcBMR(u) {
  if (!u) return 2000;
  const w = parseFloat(u.weight), h = parseFloat(u.height), a = parseInt(u.age);
  if (!w || !h || !a) return 2000;
  return Math.round(10 * w + 6.25 * h - 5 * a + (u.gender === 'female' ? -161 : 5));
}
function calcTDEE(u) {
  if (!u) return 2000;
  const bmr = calcBMR(u);
  const act = parseFloat(u.activity || 1.55);
  let tdee = Math.round(bmr * act);
  if (u.goal === 'lose') tdee -= 500;
  else if (u.goal === 'gain') tdee += 300;
  return Math.max(1200, tdee);
}

// ─── LOG HELPERS ─────────────────────────
function todayLog() {
  if (!APP.logs[APP.today])
    APP.logs[APP.today] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
  return APP.logs[APP.today];
}
function mealCal(meal, date) {
  const log = APP.logs[date || APP.today];
  return (log?.[meal] || []).reduce((s, f) => s + (f.cal || 0), 0);
}
function totalCal(date) {
  return ['breakfast', 'lunch', 'dinner', 'snacks'].reduce((s, m) => s + mealCal(m, date), 0);
}
function calcStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (totalCal(d.toISOString().split('T')[0]) > 0) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// ─── FOOD DB ─────────────────────────────
const FOOD_DB = [
  { name: 'Rice (1 cup cooked)', cal: 206 },
  { name: 'Chicken Breast (100g)', cal: 165 },
  { name: 'Egg (1 large)', cal: 72 },
  { name: 'Banana (medium)', cal: 105 },
  { name: 'Apple (medium)', cal: 95 },
  { name: 'Oatmeal (1 cup)', cal: 154 },
  { name: 'Greek Yogurt (100g)', cal: 59 },
  { name: 'Salmon (100g)', cal: 208 },
  { name: 'Broccoli (1 cup)', cal: 55 },
  { name: 'Whole Milk (1 cup)', cal: 149 },
  { name: 'Bread (1 slice)', cal: 79 },
  { name: 'Pasta (100g cooked)', cal: 157 },
  { name: 'Cheddar Cheese (30g)', cal: 120 },
  { name: 'Avocado (half)', cal: 120 },
  { name: 'Peanut Butter (2 tbsp)', cal: 188 },
  { name: 'Almonds (28g)', cal: 164 },
  { name: 'Orange Juice (1 cup)', cal: 112 },
  { name: 'Black Coffee (1 cup)', cal: 2 },
  { name: 'Latte (1 cup)', cal: 120 },
  { name: 'Protein Shake', cal: 150 },
  { name: 'Beef Burger (patty)', cal: 290 },
  { name: 'Pizza Slice', cal: 285 },
  { name: 'French Fries (medium)', cal: 365 },
  { name: 'Cola (330ml)', cal: 140 },
  { name: 'Chocolate Bar (50g)', cal: 260 },
  { name: 'Ice Cream (scoop)', cal: 130 },
  { name: 'Baked Potato', cal: 161 },
  { name: 'Tuna (100g)', cal: 144 },
  { name: 'Tofu (100g)', cal: 76 },
  { name: 'Sweet Potato (medium)', cal: 103 },
];

const MEAL_COLORS = { breakfast: '#fb923c', lunch: '#22d3a0', dinner: '#a78bfa', snacks: '#fb7185' };
const MEAL_BG_CLASS = { breakfast: 'breakfast-bg', lunch: 'lunch-bg', dinner: 'dinner-bg', snacks: 'snacks-bg' };

// ─── RING DRAWING ─────────────────────────
function drawRing(canvasId, consumed, goal, size = 64) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const r = size * 0.4;
  const lw = size * 0.1;
  const over = consumed > goal;
  const pct = Math.min(consumed / (goal || 1), 1);

  ctx.clearRect(0, 0, size, size);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = over ? 'rgba(248,113,113,.15)' : 'rgba(34,211,160,.12)';
  ctx.lineWidth = lw;
  ctx.stroke();

  if (pct > 0) {
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    if (over) { grad.addColorStop(0, '#f87171'); grad.addColorStop(1, '#fb923c'); }
    else { grad.addColorStop(0, '#22d3a0'); grad.addColorStop(1, '#38bdf8'); }
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.strokeStyle = grad;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ─── DONUT CHART ─────────────────────────
let donutChart = null, mealPieChart = null;

function updateDonut(bfCal, luCal, diCal, snCal) {
  const ctx = document.getElementById('donutChart');
  if (!ctx) return;
  const total = bfCal + luCal + diCal + snCal || 1;
  const data = [bfCal, luCal, diCal, snCal];
  const colors = Object.values(MEAL_COLORS);

  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data, backgroundColor: colors,
        borderWidth: 0, hoverOffset: 4,
      }]
    },
    options: {
      cutout: '70%', responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 400 }
    }
  });
}

// ─── MAIN UI UPDATE ───────────────────────
function updateHomeUI() {
  const goal = calcTDEE(APP.user);
  const consumed = totalCal(APP.today);
  const remaining = Math.max(0, goal - consumed);
  const streak = calcStreak();
  const pct = Math.round(Math.min(consumed / goal * 100, 100));

  // — WEB KPIs —
  setText('kpiConsumed', consumed);
  setText('kpiRemaining', remaining);
  setText('kpiGoal', goal);
  setText('kpiStreak', streak);
  drawRing('ringCanvas', consumed, goal, 64);
  setText('ringPct', pct + '%');

  // — WEB meals table —
  const meals = ['breakfast', 'lunch', 'dinner', 'snacks'];
  meals.forEach(m => {
    const cal = mealCal(m);
    const items = todayLog()[m] || [];
    setText('mt-cal-' + m, cal + ' kcal');
    setText('mt-items-' + m, items.length ? items.length + ' item' + (items.length > 1 ? 's' : '') : '—');
  });

  // Web food log
  buildWebFoodLog();

  // Side donut
  const [bf, lu, di, sn] = meals.map(m => mealCal(m));
  updateDonut(bf, lu, di, sn);
  setText('dl-breakfast', bf); setText('dl-lunch', lu);
  setText('dl-dinner', di); setText('dl-snacks', sn);

  // — MOBILE —
  drawRing('mobRingCanvas', consumed, goal, 180);
  setText('mobConsumed', consumed);
  setText('mobGoal', goal);
  setText('mobRemaining', remaining);
  setText('mobStreak', streak);

  meals.forEach(m => {
    const cal = mealCal(m);
    const items = todayLog()[m] || [];
    setText('mm-cal-' + m, cal + ' kcal');
    setText('mm-sub-' + m, items.length ? items.map(f => f.name).slice(0, 2).join(', ') + (items.length > 2 ? '…' : '') : 'No items');
  });

  // Greeting
  const h = new Date().getHours();
  const name = APP.user?.name ? `, ${APP.user.name}` : '';
  const greet = h < 12 ? `Good morning${name} 👋` : h < 17 ? `Good afternoon${name} 👋` : `Good evening${name} 👋`;
  setText('greeting', greet);
  setText('mobGreeting', greet);

  // Dates
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  setText('wdDate', today);
  setText('tbDate', shortDate);
  setText('mobDate', shortDate);

  // Sidebar user
  setText('sbAvatar', (APP.user?.name?.[0] || 'U').toUpperCase());
  setText('sbName', APP.user?.name || 'Guest User');
  setText('sbCal', APP.user ? calcTDEE(APP.user) + ' kcal goal' : 'Set up profile');
  setText('tbAvatar', (APP.user?.name?.[0] || 'U').toUpperCase());
  setText('mobAvatar', (APP.user?.name?.[0] || 'U').toUpperCase());

  // Tip
  const tipIdx = Math.floor(Date.now() / 86400000) % TIPS.length;
  setText('tipText', TIPS[tipIdx]);
}

function buildWebFoodLog() {
  const log = todayLog();
  const container = document.getElementById('webFoodLog');
  const empty = document.getElementById('foodLogEmpty');
  if (!container) return;

  const allItems = [];
  ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(m => {
    (log[m] || []).forEach((f, i) => allItems.push({ ...f, meal: m, idx: i }));
  });

  if (!allItems.length) {
    container.innerHTML = '';
    container.appendChild(createEmpty());
    return;
  }
  container.innerHTML = allItems.map(f => `
    <div class="food-log-item">
      <div class="fli-left">
        <span class="fli-meal-dot" style="background:${MEAL_COLORS[f.meal]}"></span>
        <span class="fli-name">${f.name}</span>
        <span style="font-size:.75rem;color:var(--text3);text-transform:capitalize">${f.meal}</span>
      </div>
      <div class="fli-right">
        <span class="fli-cal">${f.cal} kcal</span>
        <button class="fli-del" data-meal="${f.meal}" data-idx="${f.idx}">✕</button>
      </div>
    </div>
  `).join('');
}

function createEmpty() {
  const d = document.createElement('div');
  d.className = 'food-log-empty';
  d.innerHTML = '<div style="font-size:2rem">🍽</div><div>No food logged today</div><div style="font-size:.8rem;opacity:.5">Click "+ Add" on any meal to start</div>';
  return d;
}

// ─── PROFILE UI ──────────────────────────
function isProfileComplete() {
  return APP.user && APP.user.age && APP.user.height && APP.user.weight;
}

function updateProfileUI() {
  if (isProfileComplete()) {
    showProfileView();
  } else {
    showProfileEdit(true); // true = mandatory setup (no cancel)
  }
}

function showProfileView() {
  const u = APP.user;
  if (!u) return;

  document.getElementById('profileView').classList.remove('hidden');
  document.getElementById('profileEdit').classList.add('hidden');
  document.getElementById('profileSetupNotice').classList.add('hidden');

  // Banner
  setText('pbAvatar', u.name ? u.name[0].toUpperCase() + '🎯' : '👤');
  setText('pbName', u.name || 'No name set');
  const goalLabel = { lose: 'Lose Weight 🔥', maintain: 'Maintain ⚖️', gain: 'Build Muscle 💪' }[u.goal || APP.goal] || '—';
  setText('pbGoal', goalLabel);
  setText('pbCalVal', calcTDEE(u));

  // Read-only values
  setText('pvName', u.name || '—');
  setText('pvGender', (u.gender || APP.gender) === 'female' ? '♀ Female' : '♂ Male');
  setText('pvAge', u.age ? u.age + ' years' : '—');
  setText('pvHeight', u.height ? u.height + ' cm' : '—');
  setText('pvWeight', u.weight ? u.weight + ' kg' : '—');
  setText('pvTargetWeight', u.targetWeight ? u.targetWeight + ' kg' : '—');

  const actLabels = {
    '1.2': 'Sedentary', '1.375': 'Lightly active',
    '1.55': 'Moderately active', '1.725': 'Very active', '1.9': 'Super active'
  };
  setText('pvActivity', actLabels[String(u.activity)] || 'Moderately active');
  setText('pvGoal', { lose: 'Lose Weight 🔥', maintain: 'Maintain ⚖️', gain: 'Build Muscle 💪' }[u.goal || APP.goal] || '—');

  // Result card in view mode
  const tdee = calcTDEE(u);
  const bmr = calcBMR(u);
  setText('resultCaloriesView', tdee);
  setText('resultBMRView', bmr);
  const goalMap = { lose: 'Deficit −500 kcal', maintain: 'Maintenance', gain: 'Surplus +300 kcal' };
  setText('resultBreakdownView', `BMR: ${bmr} · Activity: ×${u.activity || 1.55} · ${goalMap[u.goal || APP.goal] || ''}`);

  // Weight history
  renderWeightHistory('weightHistory');
  renderWeightHistory('weightHistory2');
}

function showProfileEdit(isMandatory) {
  document.getElementById('profileView').classList.add('hidden');
  document.getElementById('profileEdit').classList.remove('hidden');

  const cancelBtn = document.getElementById('cancelEditBtn');
  const noticeEl = document.getElementById('profileSetupNotice');

  if (isMandatory) {
    // First-time setup: show notice, hide cancel button
    noticeEl.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
  } else {
    // User clicked Edit: show cancel, hide notice
    noticeEl.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
  }

  // Fill form with current data
  const u = APP.user || {};
  if (u.name) setVal('inputName', u.name);
  if (u.age) setVal('inputAge', u.age);
  if (u.height) setVal('inputHeight', u.height);
  if (u.weight) setVal('inputWeight', u.weight);
  if (u.targetWeight) setVal('inputTargetWeight', u.targetWeight);
  if (u.activity) setVal('inputActivity', u.activity);

  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.gender === (u.gender || APP.gender)));
  document.querySelectorAll('.gs-btn').forEach(b => b.classList.toggle('active', b.dataset.goal === (u.goal || APP.goal)));

  // Weight history
  renderWeightHistory('weightHistory');
  renderWeightHistory('weightHistory2');
}

function showResultCard() {
  const card = document.getElementById('resultCard');
  if (!card || !APP.user) return;
  card.classList.remove('hidden');
  const tdee = calcTDEE(APP.user);
  const bmr = calcBMR(APP.user);
  setText('resultCalories', tdee);
  setText('resultBMR', bmr);
  const goalMap = { lose: 'Deficit −500 kcal', maintain: 'Maintenance', gain: 'Surplus +300 kcal' };
  setText('resultBreakdown', `BMR: ${bmr} · Activity: ×${APP.user.activity || 1.55} · ${goalMap[APP.goal] || ''}`);

  // Also update the view-mode result card
  setText('resultCaloriesView', tdee);
  setText('resultBMRView', bmr);
  setText('resultBreakdownView', `BMR: ${bmr} · Activity: ×${APP.user.activity || 1.55} · ${goalMap[APP.goal] || ''}`);
}

function renderWeightHistory(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const keys = Object.keys(APP.weights).sort().slice(-5).reverse();
  if (!keys.length) { el.innerHTML = '<div style="font-size:.78rem;color:var(--text3);padding:8px 0">No entries yet</div>'; return; }
  el.innerHTML = keys.map(k => `
    <div class="wh-item">
      <span>${new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      <span class="wh-val">${APP.weights[k]} kg</span>
    </div>
  `).join('');
}

// ─── PROGRESS UI ─────────────────────────
function updateProgressUI() {
  const goal = calcTDEE(APP.user);
  const streak = calcStreak();

  // Last 14 days
  const days = [], calData = [], labels = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    days.push(key);
    calData.push(totalCal(key));
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }

  const withData = days.filter((_, i) => calData[i] > 0);
  const avgCal = withData.length ? Math.round(withData.reduce((_, d) => _ + totalCal(d), 0) / withData.length) : 0;

  setText('pkStreak', streak);
  setText('pkAvg', avgCal || '—');
  setText('pkDays', withData.length);

  // Weight delta
  const wKeys = Object.keys(APP.weights).sort();
  const wVals = wKeys.map(k => APP.weights[k]);
  if (wVals.length >= 2) {
    const delta = (wVals[wVals.length - 1] - parseFloat(APP.user?.weight || wVals[0])).toFixed(1);
    setText('pkDelta', (delta > 0 ? '+' : '') + delta + ' kg');
  }

  // Weight progress bar
  const startW = parseFloat(APP.user?.weight || 0);
  const targetW = parseFloat(APP.user?.targetWeight || 0);
  if (startW && targetW && wVals.length) {
    const curr = wVals[wVals.length - 1];
    const total = Math.abs(targetW - startW);
    const done = total > 0 ? Math.min(100, Math.round(Math.abs(curr - startW) / total * 100)) : 0;
    document.getElementById('wFill').style.width = done + '%';
    setText('wPct', done + '%');
    setText('pStart', startW + ' kg');
    setText('pTarget', targetW + ' kg');
  }

  // Weekly meal averages
  const mealTotals = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
  const cnt = Math.max(withData.length, 1);
  withData.forEach(d => {
    ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(m => { mealTotals[m] += mealCal(m, d); });
  });
  const totalAvg = Object.values(mealTotals).reduce((a, b) => a + b, 0) || 1;
  setText('atBf', Math.round(mealTotals.breakfast / cnt)); setText('atBfP', Math.round(mealTotals.breakfast / totalAvg * 100) + '%');
  setText('atLu', Math.round(mealTotals.lunch / cnt)); setText('atLuP', Math.round(mealTotals.lunch / totalAvg * 100) + '%');
  setText('atDi', Math.round(mealTotals.dinner / cnt)); setText('atDiP', Math.round(mealTotals.dinner / totalAvg * 100) + '%');
  setText('atSn', Math.round(mealTotals.snacks / cnt)); setText('atSnP', Math.round(mealTotals.snacks / totalAvg * 100) + '%');

  buildCharts(labels, calData, goal, wKeys, wVals, mealTotals);
}

function buildCharts(labels, calData, goal, wKeys, wVals, mealTotals) {
  const dark = APP.dark;
  const gridC = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const tickC = dark ? '#445a78' : '#8a9bb0';
  const tooltipBg = dark ? '#162033' : '#ffffff';

  Chart.defaults.font.family = 'Plus Jakarta Sans';

  if (APP.charts.cal) APP.charts.cal.destroy();
  if (APP.charts.wt) APP.charts.wt.destroy();
  if (APP.charts.pie) APP.charts.pie.destroy();

  // Calorie chart
  const calCtx = document.getElementById('calorieChart')?.getContext('2d');
  if (calCtx) {
    APP.charts.cal = new Chart(calCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Calories',
          data: calData,
          backgroundColor: calData.map(v => v > goal ? 'rgba(248,113,113,.65)' : 'rgba(34,211,160,.65)'),
          borderColor: calData.map(v => v > goal ? '#f87171' : '#22d3a0'),
          borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
        }, {
          type: 'line', label: 'Goal',
          data: Array(calData.length).fill(goal),
          borderColor: 'rgba(56,189,248,.6)', borderWidth: 2,
          borderDash: [6, 3], pointRadius: 0, fill: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: tooltipBg, titleColor: tickC, bodyColor: dark ? '#e2eaf8' : '#0f1b2d', borderColor: 'rgba(34,211,160,.3)', borderWidth: 1 } },
        scales: {
          x: { grid: { color: gridC }, ticks: { color: tickC, maxRotation: 45, font: { size: 11 } } },
          y: { grid: { color: gridC }, ticks: { color: tickC }, beginAtZero: true }
        }
      }
    });
  }

  // Weight chart
  const wtCtx = document.getElementById('weightChart')?.getContext('2d');
  if (wtCtx && wVals.length > 0) {
    const wtGrad = wtCtx.createLinearGradient(0, 0, 0, 160);
    wtGrad.addColorStop(0, 'rgba(56,189,248,.25)');
    wtGrad.addColorStop(1, 'rgba(56,189,248,0)');
    APP.charts.wt = new Chart(wtCtx, {
      type: 'line',
      data: {
        labels: wKeys.map(k => new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [{
          label: 'Weight (kg)', data: wVals,
          borderColor: '#38bdf8', backgroundColor: wtGrad,
          borderWidth: 2.5, pointBackgroundColor: '#38bdf8',
          pointRadius: 4, fill: true, tension: 0.4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: tooltipBg, titleColor: tickC, bodyColor: dark ? '#e2eaf8' : '#0f1b2d', borderColor: 'rgba(56,189,248,.3)', borderWidth: 1 } },
        scales: {
          x: { grid: { color: gridC }, ticks: { color: tickC, font: { size: 11 } } },
          y: { grid: { color: gridC }, ticks: { color: tickC } }
        }
      }
    });
  }

  // Meal pie
  const pieCtx = document.getElementById('mealPieChart')?.getContext('2d');
  if (pieCtx) {
    const pieData = [mealTotals.breakfast, mealTotals.lunch, mealTotals.dinner, mealTotals.snacks];
    APP.charts.pie = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
        datasets: [{ data: pieData, backgroundColor: Object.values(MEAL_COLORS), borderWidth: 0, hoverOffset: 6 }]
      },
      options: {
        responsive: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: tickC, font: { size: 11 }, padding: 8 } },
          tooltip: { backgroundColor: tooltipBg, titleColor: tickC, bodyColor: dark ? '#e2eaf8' : '#0f1b2d' }
        }
      }
    });
  }
}

// ─── FOOD MODAL ──────────────────────────
function openModal(meal) {
  APP.currentMeal = meal;
  const names = { breakfast: 'Breakfast 🌅', lunch: 'Lunch ☀️', dinner: 'Dinner 🌙', snacks: 'Snacks 🍎' };
  setText('modalTitle', 'Add to ' + (names[meal] || meal));
  document.getElementById('foodModal').classList.remove('hidden');
  setVal('foodSearch', '');
  setVal('customFoodName', '');
  setVal('customFoodCal', '');
  document.getElementById('foodSuggestions').innerHTML = '';
  requestAnimationFrame(() => document.getElementById('foodSearch').focus());
}
function closeModal() {
  document.getElementById('foodModal').classList.add('hidden');
  APP.currentMeal = null;
}

function searchFood(q) {
  const container = document.getElementById('foodSuggestions');
  if (!q.trim()) { container.innerHTML = ''; return; }
  const results = FOOD_DB.filter(f => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  container.innerHTML = results.map(f => `
    <div class="sugg-item" data-name="${f.name}" data-cal="${f.cal}">
      <span>${f.name}</span>
      <span class="sugg-cal">${f.cal} kcal</span>
    </div>
  `).join('');
}

async function addFood(name, cal) {
  if (!name?.trim() || !cal || isNaN(cal)) { showToast('Please enter food name and calories'); return; }

  // Capture meal type before closeModal resets APP.currentMeal to null
  const mealType = APP.currentMeal;
  closeModal();
  showToast(`✅ Added ${name} — ${cal} kcal`);

  if (isOnline()) {
    // Online: let server be source of truth to avoid duplicate entries
    const res = await api('/meals', {
      method: 'POST',
      body: JSON.stringify({ meal_type: mealType, food_name: name.trim(), calories: parseInt(cal), date: APP.today })
    });
    if (res.status === 'success') {
      // Update local cache from server response
      const log = todayLog();
      if (!log[mealType]) log[mealType] = [];
      log[mealType].push({ id: res.meal.id, name: name.trim(), cal: parseInt(cal) });
      save();
      updateHomeUI();

      // Fire in-app notifications based on server alert triggers
      if (res.alerts_fired?.length) {
        res.alerts_fired.forEach(a => {
          if (a === 'calorie-goal') addNotification('goal', 'Daily Goal Reached! 🎯', `You've hit your ${res.goal} kcal target for today. Great job!`, 'goal');
          if (a === 'over-budget') addNotification('warning', 'Over Budget ⚠️', `You've exceeded your daily goal by ${res.total_calories - res.goal} kcal.`, 'warning');
        });
      }
    } else {
      // Server rejected — fall back to local-only
      const log = todayLog();
      if (!log[mealType]) log[mealType] = [];
      log[mealType].push({ name: name.trim(), cal: parseInt(cal) });
      save();
      updateHomeUI();
      showToast('⚠️ Saved locally — server sync failed');
    }
  } else {
    // Offline: add to local cache directly
    const log = todayLog();
    if (!log[mealType]) log[mealType] = [];
    log[mealType].push({ name: name.trim(), cal: parseInt(cal) });
    save();
    updateHomeUI();

    // Offline goal alerts (local calculation)
    const consumed = totalCal(APP.today);
    const goal = calcTDEE(APP.user);
    const prevConsumed = consumed - parseInt(cal);
    if (APP.alertSettings.goalAlerts['calorie-goal'] && prevConsumed < goal && consumed >= goal) {
      addNotification('goal', 'Daily Goal Reached! 🎯', `You've hit your ${goal} kcal target for today. Great job!`, 'goal');
    }
    if (APP.alertSettings.goalAlerts['over-budget'] && consumed > goal && prevConsumed <= goal) {
      addNotification('warning', 'Over Budget ⚠️', `You've exceeded your daily goal by ${consumed - goal} kcal.`, 'warning');
    }
  }
}

// ─── NAVIGATION ──────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');

  // Sidebar
  document.querySelectorAll('.sb-link').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  // Mobile nav
  document.querySelectorAll('.mn-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  // Topbar title
  const titles = { home: 'Dashboard', about: 'Profile', progress: 'Progress', alerts: 'Alerts & Reminders' };
  setText('tbTitle', titles[page] || '');

  if (page === 'about') updateProfileUI();
  if (page === 'progress') updateProgressUI();
  if (page === 'alerts') updateAlertsUI();
}

// ─── DARK MODE ───────────────────────────
function applyTheme() {
  document.body.classList.toggle('light', !APP.dark);
  const icon = APP.dark ? '🌙' : '☀️';
  const label = APP.dark ? 'Dark mode' : 'Light mode';
  setText('themeIcon', icon);
  setText('themeLabel', label);
  const mobEl = document.getElementById('mobTheme');
  if (mobEl) mobEl.textContent = icon;
}
function toggleTheme() {
  APP.dark = !APP.dark;
  applyTheme();
  save();
  // Rebuild charts with new colors
  if (document.getElementById('page-progress')?.classList.contains('active'))
    updateProgressUI();
}

// ─── TOAST ───────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ─── HELPERS ─────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

// ─── PWA INSTALL ─────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBanner')?.classList.remove('hidden');
});

let swRegistration = null;
let swReady = null;
function registerSW() {
  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    console.warn('[PWA] Service Worker registration failed: Insecure context. HTTPS is required for PWAs.');
    return;
  }

  if ('serviceWorker' in navigator) {
    swReady = navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('[PWA] SW registered, scope:', reg.scope);
        swRegistration = reg;
        return reg;
      })
      .catch(e => {
        console.warn('[PWA] SW registration failed', e);
        return null;
      });
  } else {
    swReady = Promise.resolve(null);
  }
}

// ─── NOTIFICATIONS ───────────────────────
// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyChxGof0XLuq3d9Zfo1EU9kMS9ThQmYGWA",
  authDomain: "nutripulse-d01e0.firebaseapp.com",
  projectId: "nutripulse-d01e0",
  storageBucket: "nutripulse-d01e0.firebasestorage.app",
  messagingSenderId: "767403174340",
  appId: "1:767403174340:web:1fb5861447ca8aa63f9c91",
};

// Firebase Cloud Messaging enabled
firebase.initializeApp(firebaseConfig);

let pendingFcmToken = null;

async function requestNotifPermission() {
  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    showToast('⚠️ Push notifications require HTTPS (or localhost).');
    updatePushStatus('Insecure Context');
    return;
  }

  if (!('Notification' in window)) {
    console.warn('[FCM] Notification API not supported');
    updatePushStatus('Unsupported');
    showToast('⚠️ Notifications not supported by this browser.');
    return;
  }

  updatePushStatus('Requesting...');
  
  try {
    const perm = await Notification.requestPermission();
    console.log('[FCM] Permission result:', perm);
    
    if (perm === 'granted') {
      // Wait for service worker registration to complete
      if (swReady) await swReady;
      
      if (!swRegistration) {
        console.warn('[FCM] No service worker registration available');
        updatePushStatus('SW Error');
        return;
      }

      if (typeof firebase !== 'undefined' && firebase.messaging) {
        const messaging = firebase.messaging();
        console.log('[FCM] Requesting FCM token...');
        
        const token = await messaging.getToken({
          serviceWorkerRegistration: swRegistration,
          vapidKey: 'BKmk9Dsa89PuOx9Tj0aGNBxIjG4BeZFNQC9-YQjmXWK4RsFxtmnw0FzNa-NlpbA_uZ6XKmpDRN5RY0ofHl1fua4'
        });

        if (token) {
          console.log('[FCM] Token obtained');
          pendingFcmToken = token;
          localStorage.setItem('np_fcm_token', token);
          APP.alertSettings.enabled = true;
          save();
          showToast('🔔 Push notifications enabled!');
          updatePushStatus('Active');

          // Send to server if user is authenticated
          sendFcmTokenToServer();

          // Handle foreground messages
          messaging.onMessage((payload) => {
            console.log('[FCM] Foreground message:', payload);
            const title = payload.notification?.title || payload.data?.title || 'NutriPulse';
            const body = payload.notification?.body || payload.data?.body || '';
            if (Notification.permission === 'granted') {
              new Notification(title, { body, icon: 'icons/icon-192.png' });
            }
            addNotification('goal', title, body, 'goal');
          });
          
          scheduleMealReminders();
        } else {
          updatePushStatus('No Token');
        }
      }
    } else {
      updatePushStatus('Denied');
      showToast('⚠️ Notifications denied. Enable them in settings.');
    }
  } catch (e) {
    console.warn('[FCM] Setup failed:', e);
    updatePushStatus('Failed');
    // Fallback to local
    APP.alertSettings.enabled = true;
    save();
    scheduleMealReminders();
  }
}

// updatePushStatus removed as manual UI is deleted

function sendFcmTokenToServer() {
  const token = pendingFcmToken || localStorage.getItem('np_fcm_token');
  if (!token) {
    console.log('[FCM] No FCM token available to send');
    return;
  }
  if (!APP.token) {
    console.log('[FCM] No JWT token — will send FCM token after login');
    return;
  }
  console.log('[FCM] Sending FCM token to server...');
  fetch('/api/v1/fcm-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + APP.token
    },
    body: JSON.stringify({ token: token })
  }).then(r => r.json()).then(data => {
    console.log('[FCM] Token saved to server:', data);
  }).catch(err => {
    console.error('[FCM] Failed to save token to server:', err);
  });
}

let remindersScheduled = false;
function scheduleMealReminders() {
  if (remindersScheduled) return;
  remindersScheduled = true;
  const reminders = [
    { h: 8, m: 0, msg: '🌅 Time to log your breakfast!', meal: 'breakfast' },
    { h: 12, m: 30, msg: '☀️ Log your lunch!', meal: 'lunch' },
    { h: 19, m: 0, msg: '🌙 Don\'t forget dinner — log it in NutriPulse!', meal: 'dinner' },
  ];
  const now = new Date();
  reminders.forEach(({ h, m, msg, meal }) => {
    if (!APP.alertSettings.enabled || !APP.alertSettings.reminders[meal]) return;
    const t = new Date(); t.setHours(h, m, 0, 0);
    let delay = t - now;
    if (delay < 0) delay += 86400000;
    setTimeout(() => {
      if (APP.alertSettings.enabled && Notification.permission === 'granted') {
        new Notification('NutriPulse', { body: msg, icon: 'icons/icon-192.png' });
      }
      addNotification('meal', msg.split(' ')[0], msg, 'meal');
    }, delay);
  });
}

// ─── ALERTS PAGE LOGIC ───────────────────
async function updateAlertsUI() {
  // Sync settings from server if online
  if (isOnline()) {
    const res = await api('/alerts/settings');
    if (res.status === 'success') {
      APP.alertSettings = res.settings;
      save();
    }
  }
  // Rest of the UI updates
  document.querySelectorAll('.reminder-toggle').forEach(t => {
    const meal = t.dataset.meal;
    t.checked = APP.alertSettings.reminders[meal] !== false;
  });
  document.querySelectorAll('.goal-alert-toggle').forEach(t => {
    const alert = t.dataset.alert;
    t.checked = APP.alertSettings.goalAlerts[alert] !== false;
  });

  // Render notification history
  renderNotifHistory();
}

function renderNotifHistory() {
  const container = document.getElementById('notifHistory');
  const emptyEl = document.getElementById('notifEmpty');
  if (!container) return;

  // Remove old items (keep empty placeholder)
  container.querySelectorAll('.notif-item').forEach(el => el.remove());

  if (!APP.notifications.length) {
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Render most recent first
  const sorted = [...APP.notifications].reverse();
  sorted.forEach(n => {
    const div = document.createElement('div');
    div.className = 'notif-item' + (n.unread ? ' unread' : '');
    div.dataset.id = n.id;
    div.innerHTML = `
      <div class="ni-icon ${n.type}">${n.icon}</div>
      <div class="ni-body">
        <div class="ni-title">${n.title}</div>
        <div class="ni-desc">${n.desc}</div>
        <div class="ni-time">${formatNotifTime(n.time)}</div>
      </div>
      <button class="ni-dismiss" data-notif-id="${n.id}" title="Dismiss">✕</button>
    `;
    container.appendChild(div);
  });

  // Mark all as read
  APP.notifications.forEach(n => n.unread = false);
  save();
  updateAlertDot();
}

function addNotification(type, title, desc, iconType) {
  const icons = { meal: '🍽', goal: '🎯', warning: '⚠️', streak: '🔥', report: '📊' };
  const notif = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: iconType || type,
    icon: icons[iconType || type] || '🔔',
    title, desc,
    time: new Date().toISOString(),
    unread: true
  };
  APP.notifications.push(notif);
  // Keep only last 50
  if (APP.notifications.length > 50) APP.notifications = APP.notifications.slice(-50);
  save();
  updateAlertDot();

  // If currently on alerts page, re-render
  if (document.getElementById('page-alerts')?.classList.contains('active')) {
    renderNotifHistory();
  }
}

function removeNotification(id) {
  APP.notifications = APP.notifications.filter(n => n.id !== id);
  save();
  renderNotifHistory();
}

function clearAllNotifications() {
  APP.notifications = [];
  save();
  renderNotifHistory();
  showToast('🗑 All notifications cleared');
}

function updateAlertDot() {
  const hasUnread = APP.notifications.some(n => n.unread);
  document.getElementById('sbAlertDot')?.classList.toggle('hidden', !hasUnread);
}

function formatNotifTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return diffMins + 'm ago';
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return diffHrs + 'h ago';
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return diffDays + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function generateInitialNotifications() {
  // Only generate if notifications array is empty (first visit to alerts)
  if (APP.notifications.length > 0) return;

  const now = new Date();
  const h = now.getHours();

  // Welcome notification
  addNotification('goal', 'Welcome to NutriPulse! 🎉', 'Your calorie tracking journey starts now. Set up your profile to get personalized goals.', 'goal');

  // Contextual tip based on time of day
  if (h < 11) {
    addNotification('meal', 'Good morning! ☀️', 'Don\'t forget to log your breakfast — it kickstarts your metabolism.', 'meal');
  } else if (h < 15) {
    addNotification('meal', 'Lunchtime! 🍽', 'Have you logged your lunch yet? Keep your tracking on point.', 'meal');
  } else if (h < 21) {
    addNotification('meal', 'Evening check-in 🌙', 'Log your meals before the day ends for accurate tracking.', 'meal');
  }

  // Streak motivation
  const streak = calcStreak();
  if (streak >= 3) {
    addNotification('streak', `${streak}-day streak! 🔥`, `You\'ve logged food for ${streak} consecutive days. Keep it up!`, 'streak');
  }
}

// ─── TOPBAR SEARCH ───────────────────────
function handleTopbarSearch(e) {
  const q = e.target.value;
  if (q.length > 1) {
    // Navigate to home and open modal with search pre-filled
    navigate('home');
    setTimeout(() => {
      openModal('breakfast');
      setVal('foodSearch', q);
      searchFood(q);
    }, 100);
  }
}

// ─── MODE MANAGEMENT ─────────────────────
function setMode(mode) {
  APP.mode = mode;
  localStorage.setItem('np_mode', mode);
  updateModeBadge();
}

function getStoredMode() {
  return localStorage.getItem('np_mode'); // 'online' | 'offline' | null
}

function updateModeBadge() {
  const badge = document.getElementById('modeBadge');
  if (!badge) return;
  if (APP.mode === 'online') {
    badge.className = 'mode-badge online';
    badge.innerHTML = '<span class="badge-dot"></span>Online';
  } else {
    badge.className = 'mode-badge offline';
    badge.innerHTML = '<span class="badge-dot"></span>Offline';
  }
}

function updateLogoutVisibility() {
  const isOnline = APP.mode === 'online';
  const sidebarLogout = document.getElementById('sidebarLogout');
  const mobLogout = document.getElementById('mobLogout');

  if (sidebarLogout) {
    sidebarLogout.classList.remove('hidden');
    sidebarLogout.innerHTML = isOnline
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg> Sign Out`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg> Switch Mode`;
  }

  if (mobLogout) {
    mobLogout.classList.remove('hidden');
    mobLogout.innerHTML = isOnline
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>`;
    mobLogout.title = isOnline ? "Sign Out" : "Switch Mode";
  }
}

function handleLogout() {
  const wasOnline = APP.mode === 'online';

  // Clear mode, session, and JWT
  APP.mode = null;
  APP.token = null;
  localStorage.removeItem('np_mode');
  localStorage.removeItem('np_token');

  // If they were online, clear the user to force relogin. If offline, keep local user data.
  if (wasOnline) {
    APP.user = null;
    localStorage.removeItem('np_user');
  }

  // Hide main app
  document.getElementById('mainApp').classList.add('hidden');

  // Reset auth form
  const loginErr = document.getElementById('loginError');
  const regErr = document.getElementById('regError');
  if (loginErr) loginErr.classList.add('hidden');
  if (regErr) regErr.classList.add('hidden');
  setVal('loginUsername', '');
  setVal('loginPassword', '');
  setVal('regUsername', '');
  setVal('regEmail', '');
  setVal('regPassword', '');

  // Show mode selection
  document.getElementById('modeSelect').classList.remove('hidden');
  showToast(wasOnline ? '👋 Signed out successfully' : '🔄 Switched to mode selection');
}

async function enterApp(page) {
  document.getElementById('splash')?.classList.add('hidden');
  document.getElementById('modeSelect')?.classList.add('hidden');
  document.getElementById('authScreen')?.classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  updateModeBadge();
  updateLogoutVisibility();

  if (isOnline()) {
    await syncFromServer();
    // Send any pending FCM token now that we have a JWT
    sendFcmTokenToServer();
  }
  
  if (APP.alertSettings.enabled) {
    scheduleMealReminders();
  }
  updateHomeUI();

  // Force profile setup if profile is incomplete
  if (!isProfileComplete()) {
    navigate('about');
  } else if (page) {
    navigate(page);
  }
}

// ─── AUTH HANDLERS ───────────────────────
async function handleLogin(username, password) {
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.status === 'success') {
      APP.token = data.token;
      setMode('online');
      if (!APP.user) APP.user = { name: data.user.username || data.user.name };
      else APP.user.name = data.user.username || data.user.name;
      save();
      // Send pending FCM token now that user is authenticated
      sendFcmTokenToServer();
      enterApp();
      showToast('✅ Signed in as ' + (data.user.username || data.user.name));
    } else {
      errEl.textContent = data.message || 'Login failed';
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.textContent = 'Cannot reach server. Check your connection or try Offline Mode.';
    errEl.classList.remove('hidden');
  }
}

async function handleRegister(username, email, password) {
  const errEl = document.getElementById('regError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    if (data.status === 'success') {
      APP.token = data.token;
      setMode('online');
      APP.user = { name: username };
      save();
      // Send pending FCM token now that user is authenticated
      sendFcmTokenToServer();
      enterApp('about');
      showToast('🎉 Account created! Set up your profile.');
    } else {
      errEl.textContent = data.message || 'Registration failed';
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.textContent = 'Cannot reach server. Check your connection or try Offline Mode.';
    errEl.classList.remove('hidden');
  }
}

// ─── INIT ────────────────────────────────
function init() {
  load();
  applyTheme();

  const storedMode = getStoredMode();

  // Returning user with mode already set
  if (storedMode && APP.user) {
    APP.mode = storedMode;
    enterApp();
  }
  // Returning user with data but no mode set (legacy) — treat as offline
  else if (APP.user && !storedMode) {
    setMode('offline');
    enterApp();
  }
  // First launch — show splash
  else {
    document.getElementById('splash').classList.remove('hidden');
  }

  // ─── SPLASH → MODE SELECT ─────────────
  document.getElementById('splashStart').onclick = () => {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('modeSelect').classList.remove('hidden');
  };

  // ─── MODE SELECTION ────────────────────
  document.getElementById('modeOnline').onclick = () => {
    document.getElementById('modeSelect').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  };

  document.getElementById('modeOffline').onclick = () => {
    setMode('offline');
    enterApp('about');
    showToast('📴 Offline mode — data saved locally');
  };

  // ─── AUTH SCREEN ───────────────────────
  document.getElementById('authBack').onclick = () => {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('modeSelect').classList.remove('hidden');
  };

  document.getElementById('authGoOffline').onclick = () => {
    setMode('offline');
    enterApp('about');
    showToast('📴 Offline mode — data saved locally');
  };

  // Auth tabs
  document.getElementById('tabLogin').onclick = () => {
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('tabRegister').classList.remove('active');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('authTitle').textContent = 'Sign In';
    document.getElementById('authSub').textContent = 'Welcome back to NutriPulse';
  };
  document.getElementById('tabRegister').onclick = () => {
    document.getElementById('tabRegister').classList.add('active');
    document.getElementById('tabLogin').classList.remove('active');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('authTitle').textContent = 'Create Account';
    document.getElementById('authSub').textContent = 'Start tracking your wellness';
  };

  // Auth forms
  document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    if (u && p) handleLogin(u, p);
  });

  document.getElementById('registerForm').addEventListener('submit', e => {
    e.preventDefault();
    const u = document.getElementById('regUsername').value.trim();
    const em = document.getElementById('regEmail').value.trim();
    const p = document.getElementById('regPassword').value;
    if (u && em && p) handleRegister(u, em, p);
  });

  // ─── SIDEBAR NAV ──────────────────────
  document.querySelectorAll('.sb-link[data-page]').forEach(b => b.onclick = () => navigate(b.dataset.page));
  // Mobile nav
  document.querySelectorAll('.mn-item[data-page]').forEach(b => b.onclick = () => navigate(b.dataset.page));

  // Theme
  document.getElementById('darkToggle').onclick = toggleTheme;
  document.getElementById('mobTheme').onclick = toggleTheme;

  // Logout
  document.getElementById('sidebarLogout')?.addEventListener('click', handleLogout);
  document.getElementById('mobLogout')?.addEventListener('click', handleLogout);

  // Quick add buttons (web)
  document.getElementById('quickAddWeb')?.addEventListener('click', () => openModal('breakfast'));
  document.querySelectorAll('.mt-add[data-meal]').forEach(b => b.onclick = () => openModal(b.dataset.meal));

  // Mobile add buttons
  document.getElementById('fabAdd')?.addEventListener('click', () => openModal('breakfast'));
  document.querySelectorAll('.mm-btn[data-meal]').forEach(b => b.onclick = () => openModal(b.dataset.meal));

  // Food log delete (delegated)
  document.getElementById('webFoodLog')?.addEventListener('click', e => {
    const btn = e.target.closest('.fli-del');
    if (!btn) return;
    todayLog()[btn.dataset.meal].splice(parseInt(btn.dataset.idx), 1);
    save(); updateHomeUI();
  });

  // Modal
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('foodModal').addEventListener('click', e => {
    if (e.target.id === 'foodModal') closeModal();
  });

  document.getElementById('foodSearch').addEventListener('input', e => {
    searchFood(e.target.value);
    setVal('customFoodName', e.target.value);
  });

  document.getElementById('foodSuggestions').addEventListener('click', e => {
    const item = e.target.closest('.sugg-item');
    if (item) addFood(item.dataset.name, item.dataset.cal);
  });

  document.getElementById('addFoodBtn').onclick = () => {
    addFood(
      document.getElementById('customFoodName').value,
      document.getElementById('customFoodCal').value
    );
  };

  // Camera API integration
  let cameraStream = null;
  const cameraContainer = document.getElementById('cameraContainer');
  const cameraPreview = document.getElementById('cameraPreview');
  const cameraBtn = document.getElementById('cameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const cancelCameraBtn = document.getElementById('cancelCameraBtn');
  const scanLoader = document.getElementById('scanLoader');
  const cameraCanvas = document.getElementById('cameraCanvas');

  cameraBtn.onclick = async () => {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cameraPreview.srcObject = cameraStream;
      cameraContainer.classList.remove('hidden');
      cameraBtn.classList.add('hidden');
      scanLoader.classList.add('hidden');
    } catch (err) {
      showToast('Camera access denied. Please allow camera permission and try again.');
    }
  };

  cancelCameraBtn.onclick = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    cameraContainer.classList.add('hidden');
    cameraBtn.classList.remove('hidden');
  };

  captureBtn.onclick = async () => {
    if (!cameraStream) return;
    
    cameraCanvas.width = cameraPreview.videoWidth;
    cameraCanvas.height = cameraPreview.videoHeight;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(cameraPreview, 0, 0);
    const base64Image = cameraCanvas.toDataURL('image/jpeg', 0.8);
    
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    cameraPreview.srcObject = null;
    
    captureBtn.classList.add('hidden');
    cancelCameraBtn.classList.add('hidden');
    scanLoader.classList.remove('hidden');
    
    try {
      const token = localStorage.getItem('np_token');
      const res = await fetch('/api/v1/meals/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ image: base64Image })
      });
      const data = await res.json();
      
      if (!res.ok) {
        showToast(data.error || 'Could not identify food, please enter manually');
      } else {
        document.getElementById('customFoodName').value = data.food_name || '';
        document.getElementById('customFoodCal').value = data.calories || '';
        showToast('Food recognized successfully!');
      }
    } catch (e) {
      showToast('Could not identify food, please enter manually');
    } finally {
      cameraContainer.classList.add('hidden');
      cameraBtn.classList.remove('hidden');
      captureBtn.classList.remove('hidden');
      cancelCameraBtn.classList.remove('hidden');
      scanLoader.classList.add('hidden');
    }
  };

  // Profile — gender
  document.querySelectorAll('.seg-btn[data-gender]').forEach(b => b.onclick = () => {
    APP.gender = b.dataset.gender;
    document.querySelectorAll('.seg-btn[data-gender]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });

  // Profile — goal
  document.querySelectorAll('.gs-btn[data-goal]').forEach(b => b.onclick = () => {
    APP.goal = b.dataset.goal;
    document.querySelectorAll('.gs-btn[data-goal]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });

  // Edit profile button
  document.getElementById('editProfileBtn')?.addEventListener('click', () => {
    showProfileEdit(false);
  });

  // Cancel edit button
  document.getElementById('cancelEditBtn')?.addEventListener('click', () => {
    showProfileView();
  });

  // Save profile
  document.getElementById('saveProfile').onclick = async () => {
    const name = document.getElementById('inputName').value.trim();
    const age = document.getElementById('inputAge').value;
    const height = document.getElementById('inputHeight').value;
    const weight = document.getElementById('inputWeight').value;
    const targetWeight = document.getElementById('inputTargetWeight').value;
    const activity = document.getElementById('inputActivity').value;

    if (!age || !height || !weight) { showToast('Please fill in age, height, and weight'); return; }

    APP.user = { name, age, height, weight, targetWeight, activity, gender: APP.gender, goal: APP.goal };
    save();

    // Push to server if online
    if (isOnline()) {
      await api('/users/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, age: parseInt(age), height: parseFloat(height), weight: parseFloat(weight), target_weight: parseFloat(targetWeight) || null, activity: parseFloat(activity), gender: APP.gender, goal: APP.goal })
      });
    }

    showResultCard();
    updateHomeUI();
    showProfileView();
    showToast('✅ Profile saved!');
    navigate('home');
  };

  // Weight log — web home
  document.getElementById('logWeightBtn')?.addEventListener('click', () => {
    logWeight(document.getElementById('weightLogInput')?.value, 'weightHistory', 'weightLogInput');
  });
  document.getElementById('logWeightBtn2')?.addEventListener('click', () => {
    logWeight(document.getElementById('weightLogInput2')?.value, 'weightHistory2', 'weightLogInput2');
  });
  // Weight log — mobile
  document.getElementById('logWeightMob')?.addEventListener('click', () => {
    logWeight(document.getElementById('weightLogMob')?.value, null, 'weightLogMob');
  });

  // Topbar search
  document.getElementById('topbarSearch')?.addEventListener('input', handleTopbarSearch);


  // Reminder toggles
  document.querySelectorAll('.reminder-toggle').forEach(t => {
    t.addEventListener('change', async () => {
      APP.alertSettings.reminders[t.dataset.meal] = t.checked;
      save();
      if (isOnline()) {
        await api('/alerts/settings', { method: 'PUT', body: JSON.stringify({ ['reminder_' + t.dataset.meal]: t.checked }) });
      }
      const state = t.checked ? 'enabled' : 'disabled';
      showToast(`${t.checked ? '🔔' : '🔕'} ${t.dataset.meal.charAt(0).toUpperCase() + t.dataset.meal.slice(1)} reminder ${state}`);
    });
  });

  // Goal alert toggles
  document.querySelectorAll('.goal-alert-toggle').forEach(t => {
    t.addEventListener('change', async () => {
      APP.alertSettings.goalAlerts[t.dataset.alert] = t.checked;
      save();
      if (isOnline()) {
        const key = 'alert_' + t.dataset.alert.replace('-', '_');
        await api('/alerts/settings', { method: 'PUT', body: JSON.stringify({ [key]: t.checked }) });
      }
      const state = t.checked ? 'enabled' : 'disabled';
      showToast(`${t.checked ? '🔔' : '🔕'} Alert ${state}`);
    });
  });

  // Push setup
  // Push setup listener removed (UI deleted)

  // Clear all notifications
  document.getElementById('clearAlertsBtn')?.addEventListener('click', clearAllNotifications);

  // Dismiss individual notification (delegated)
  document.getElementById('notifHistory')?.addEventListener('click', e => {
    const btn = e.target.closest('.ni-dismiss');
    if (btn) removeNotification(btn.dataset.notifId);
  });

  // Generate initial notifications on first use
  generateInitialNotifications();
  updateAlertDot();

  // Install banner
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') showToast('🎉 NutriPulse installed!');
    deferredPrompt = null;
    document.getElementById('installBanner')?.classList.add('hidden');
  });
  document.getElementById('installDismiss')?.addEventListener('click', () => {
    document.getElementById('installBanner')?.classList.add('hidden');
  });

  // Service Worker MUST be registered BEFORE requesting FCM tokens
  registerSW();

  // On mobile/iOS, we only request permission via user gesture (the button we added).
  // But if already granted, we can refresh the token silently.
  if ('Notification' in window && Notification.permission === 'granted') {
    // Delay slightly to ensure SW is ready
    setTimeout(requestNotifPermission, 1500);
  }
}

async function logWeight(val, historyId, inputId) {
  const w = parseFloat(val);
  if (!w || isNaN(w)) { showToast('Enter a valid weight'); return; }
  APP.weights[APP.today] = w;
  save();
  if (isOnline()) {
    await api('/weight', { method: 'POST', body: JSON.stringify({ weight: w, date: APP.today }) });
  }
  if (historyId) renderWeightHistory(historyId);
  setVal(inputId, '');
  showToast(`⚖️ Logged: ${w} kg`);
}

document.addEventListener('DOMContentLoaded', init);
