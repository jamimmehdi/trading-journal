const sb = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

let allTrades = [];
let currentUser = null;
let activeFilter = "all";
let isSignUp = false;
let editingId = null;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtMoney = (n) => (n < 0 ? "-" : "") + inrFormatter.format(Math.abs(n));
const todayStr = () => new Date().toISOString().slice(0, 10);
const SYMBOL_PRESETS = ["BTC", "ETH", "SOL", "XAU"];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- USD -> INR conversion (free, no-key APIs, tried in order) ----------
const RATE_SOURCES = [
  { url: "https://api.frankfurter.dev/v1/latest?from=USD&to=INR", extract: (d) => d?.rates?.INR },
  { url: "https://open.er-api.com/v6/latest/USD", extract: (d) => d?.rates?.INR },
];
const FALLBACK_USD_INR_RATE = 95.3; // last-resort estimate, only used if every live source fails
const RATE_CACHE_MS = 6 * 60 * 60 * 1000;
let usdInrRate = null;
let usdInrRateIsLive = false;

async function getUsdInrRate() {
  if (usdInrRate != null) return usdInrRate;
  try {
    const cachedRate = Number(localStorage.getItem("usd_inr_rate"));
    const cachedTs = Number(localStorage.getItem("usd_inr_rate_ts"));
    if (cachedRate && Date.now() - cachedTs < RATE_CACHE_MS) {
      usdInrRate = cachedRate;
      usdInrRateIsLive = true;
      return usdInrRate;
    }
  } catch (e) {}

  for (const source of RATE_SOURCES) {
    try {
      const res = await fetch(source.url);
      const data = await res.json();
      const rate = source.extract(data);
      if (rate) {
        usdInrRate = rate;
        usdInrRateIsLive = true;
        try {
          localStorage.setItem("usd_inr_rate", String(rate));
          localStorage.setItem("usd_inr_rate_ts", String(Date.now()));
        } catch (e) {}
        return usdInrRate;
      }
    } catch (e) {}
  }

  usdInrRate = FALLBACK_USD_INR_RATE;
  usdInrRateIsLive = false;
  return usdInrRate;
}

function computePnl(trade) {
  if (trade.exit_price == null || trade.exit_price === "") return null;
  const entry = Number(trade.entry_price);
  const exit = Number(trade.exit_price);
  if (!entry) return null;
  const investment = Number(trade.investment_amount);
  const leverage = Number(trade.leverage) || 1;
  const fees = Number(trade.fees) || 0;
  const priceChangeFrac = trade.side === "short" ? (entry - exit) / entry : (exit - entry) / entry;
  const raw = investment * leverage * priceChangeFrac;
  return raw - fees;
}

function computePnlPct(trade) {
  const pnl = computePnl(trade);
  if (pnl == null) return null;
  const basis = Number(trade.investment_amount);
  if (!basis) return null;
  return (pnl / basis) * 100;
}

// ---------- auth ----------
$("auth-toggle-btn").addEventListener("click", () => {
  isSignUp = !isSignUp;
  $("auth-submit-btn").textContent = isSignUp ? "Sign Up" : "Sign In";
  $("auth-toggle-btn").textContent = isSignUp
    ? "Already have an account? Sign in"
    : "Need an account? Sign up";
  $("auth-error").textContent = "";
});

$("auth-submit-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  $("auth-error").textContent = "";
  if (!email || !password) {
    $("auth-error").textContent = "Enter an email and password.";
    return;
  }
  $("auth-submit-btn").textContent = "Please wait…";
  try {
    const { error } = isSignUp
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (isSignUp) {
      toast("Account created — check your email if confirmation is required.");
    }
  } catch (e) {
    $("auth-error").textContent = e.message || "Something went wrong.";
  } finally {
    $("auth-submit-btn").textContent = isSignUp ? "Sign Up" : "Sign In";
  }
});

$("logout-btn").addEventListener("click", async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) {
    $("auth-screen").classList.add("hidden");
    $("main-app").classList.remove("hidden");
    loadTrades();
  } else {
    $("main-app").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
  }
});

// ---------- navigation ----------
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  $(`page-${name}`).classList.remove("hidden");
  document.querySelector(`.nav-btn[data-page="${name}"]`).classList.add("active");
  if (name === "form" && !editingId) resetForm();
  document.querySelector("main").scrollTop = 0;
}

// ---------- data loading ----------
async function loadTrades() {
  const { data, error } = await sb
    .from("trades")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    toast("Failed to load trades: " + error.message);
    return;
  }
  allTrades = data || [];
  renderDashboard();
  renderTradeList();
}

// ---------- dashboard ----------
function renderDashboard() {
  const closed = allTrades.filter((t) => t.status === "closed" && t.exit_price != null);
  const pnls = closed.map(computePnl);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const winRate = pnls.length ? (wins.length / pnls.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const openCount = allTrades.filter((t) => t.status === "open").length;

  $("stat-total-pnl").textContent = fmtMoney(totalPnl);
  $("stat-total-pnl").className = "hero-value " + (totalPnl >= 0 ? "pos" : "neg");
  $("hero-sub-stats").textContent = `${winRate.toFixed(1)}% win rate · ${closed.length} trades`;
  $("stat-win-rate").textContent = winRate.toFixed(1) + "%";
  $("stat-trade-count").textContent = closed.length;
  $("stat-avg-win").textContent = fmtMoney(avgWin);
  $("stat-avg-loss").textContent = fmtMoney(avgLoss);
  $("stat-profit-factor").textContent = Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞";
  $("stat-open-count").textContent = openCount;

  drawEquityCurve(closed);

  const recent = allTrades.slice(0, 6);
  renderTradeCards($("recent-trade-list"), recent);
}

function drawEquityCurve(closedTrades) {
  const canvas = $("equity-chart");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const sorted = [...closedTrades].sort(
    (a, b) => new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date)
  );
  if (sorted.length === 0) {
    ctx.fillStyle = "#8b93a7";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No closed trades yet", rect.width / 2, rect.height / 2);
    return;
  }

  let running = 0;
  const points = [0];
  sorted.forEach((t) => {
    running += computePnl(t);
    points.push(running);
  });

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const padX = 8, padY = 10;
  const w = rect.width - padX * 2;
  const h = rect.height - padY * 2;

  const last = points[points.length - 1];
  const color = last >= 0 ? "#26a69a" : "#ef5350";

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = padX + (i / (points.length - 1)) * w;
    const y = padY + h - ((p - min) / span) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(padX + w, padY + h);
  ctx.lineTo(padX, padY + h);
  ctx.closePath();
  ctx.fillStyle = color + "22";
  ctx.fill();

  const zeroY = padY + h - ((0 - min) / span) * h;
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(padX, zeroY);
  ctx.lineTo(padX + w, zeroY);
  ctx.strokeStyle = "#8b93a740";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------- trade list ----------
$("search-input").addEventListener("input", renderTradeList);
document.querySelectorAll("#filter-row .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#filter-row .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    renderTradeList();
  });
});

function renderTradeList() {
  const q = $("search-input").value.trim().toLowerCase();
  let list = allTrades.filter((t) => {
    if (q && !(t.symbol.toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q))) return false;
    if (activeFilter === "open") return t.status === "open";
    if (activeFilter === "closed") return t.status === "closed";
    if (activeFilter === "win") return t.status === "closed" && computePnl(t) > 0;
    if (activeFilter === "loss") return t.status === "closed" && computePnl(t) < 0;
    return true;
  });
  renderTradeCards($("full-trade-list"), list);
}

function renderTradeCards(container, trades) {
  container.innerHTML = "";
  if (trades.length === 0) {
    container.innerHTML = '<div class="empty-state">No trades yet. Tap Add to log your first trade.</div>';
    return;
  }
  trades.forEach((t) => {
    const pnl = computePnl(t);
    const pnlPct = computePnlPct(t);
    const dotColor = pnl == null ? "var(--text-dim)" : pnl >= 0 ? "var(--green)" : "var(--red)";
    const card = document.createElement("div");
    card.className = "trade-card";
    card.innerHTML = `
      <div class="trade-dot" style="background:${dotColor}"></div>
      <div class="trade-main">
        <div class="trade-title">${t.symbol} · ${Number(t.leverage) || 1}x ${t.side}${t.status === "open" ? " · open" : ""}</div>
        <div class="meta">${t.entry_date}</div>
      </div>
      <div class="right">
        ${
          pnl == null
            ? '<div class="meta">—</div>'
            : `<div class="pnl ${pnl >= 0 ? "pos" : "neg"}">${fmtMoney(pnl)}</div>
               <div class="pnl-pct">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%</div>`
        }
      </div>
    `;
    card.addEventListener("click", () => openEditForm(t));
    container.appendChild(card);
  });
}

// ---------- form ----------
function applySymbolPreset() {
  const preset = $("f-symbol-preset").value;
  if (preset === "__custom__") {
    $("f-symbol").classList.remove("hidden");
    $("f-symbol").focus();
  } else {
    $("f-symbol").value = preset;
    $("f-symbol").classList.add("hidden");
  }
}

$("f-symbol-preset").addEventListener("change", applySymbolPreset);

function setSymbolField(symbol) {
  if (SYMBOL_PRESETS.includes(symbol)) {
    $("f-symbol-preset").value = symbol;
    $("f-symbol").value = symbol;
    $("f-symbol").classList.add("hidden");
  } else {
    $("f-symbol-preset").value = "__custom__";
    $("f-symbol").value = symbol;
    $("f-symbol").classList.remove("hidden");
  }
}

function resetForm() {
  editingId = null;
  $("trade-id").value = "";
  setSymbolField("BTC");
  $("f-entry-price").value = "";
  $("f-exit-price").value = "";
  $("f-investment").value = "";
  $("f-leverage").value = "1";
  $("f-maker-fee").value = "";
  $("f-taker-fee").value = "";
  setSegment("fee-currency-toggle", "INR");
  $("fee-rate-note").textContent = "";
  $("f-entry-date").value = todayStr();
  $("f-exit-date").value = "";
  $("f-notes").value = "";
  setSegment("side-toggle", "long");
  setSegment("status-toggle", "closed");
  $("delete-trade-btn").classList.add("hidden");
  updateFeeTotal();
}

function openEditForm(t) {
  editingId = t.id;
  $("trade-id").value = t.id;
  setSymbolField(t.symbol);
  $("f-entry-price").value = t.entry_price;
  $("f-exit-price").value = t.exit_price ?? "";
  $("f-investment").value = t.investment_amount;
  $("f-leverage").value = t.leverage ?? 1;
  $("f-maker-fee").value = t.fees ?? "";
  $("f-taker-fee").value = "";
  setSegment("fee-currency-toggle", "INR");
  $("fee-rate-note").textContent = "";
  $("f-entry-date").value = t.entry_date;
  $("f-exit-date").value = t.exit_date ?? "";
  $("f-notes").value = t.notes ?? "";
  setSegment("side-toggle", t.side);
  setSegment("status-toggle", t.status);
  $("delete-trade-btn").classList.remove("hidden");
  updateFeeTotal();
  showPage("form");
}

function setSegment(groupId, value) {
  const group = $(groupId);
  group.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === value);
  });
  group.dataset.value = value;
}

["side-toggle", "status-toggle"].forEach((id) => {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    setSegment(id, btn.dataset.value);
    updatePnlPreview();
  });
});

$("fee-currency-toggle").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  setSegment("fee-currency-toggle", btn.dataset.value);
  await updateFeeTotal();
});

["f-maker-fee", "f-taker-fee"].forEach((id) => {
  $(id).addEventListener("input", updateFeeTotal);
});

["f-entry-price", "f-exit-price", "f-investment", "f-leverage"].forEach((id) => {
  $(id).addEventListener("input", updatePnlPreview);
});

function computeFeeSum() {
  const maker = Number($("f-maker-fee").value) || 0;
  const taker = Number($("f-taker-fee").value) || 0;
  return maker + taker;
}

async function computeTotalFeesInr() {
  const currency = $("fee-currency-toggle").dataset.value || "INR";
  const sum = computeFeeSum();
  if (currency === "USD") {
    const rate = await getUsdInrRate();
    return sum * rate;
  }
  return sum;
}

async function updateFeeTotal() {
  const currency = $("fee-currency-toggle").dataset.value || "INR";
  const total = await computeTotalFeesInr();
  $("fee-total-preview").textContent = fmtMoney(total);
  if (currency === "USD") {
    const rate = usdInrRate ?? FALLBACK_USD_INR_RATE;
    $("fee-rate-note").textContent = `1 USD = ${fmtMoney(rate)}${usdInrRateIsLive ? "" : " (fallback rate, offline)"}`;
  } else {
    $("fee-rate-note").textContent = "";
  }
  updatePnlPreview();
}

async function updatePnlPreview() {
  const trade = {
    side: $("side-toggle").dataset.value,
    entry_price: $("f-entry-price").value,
    exit_price: $("f-exit-price").value,
    investment_amount: $("f-investment").value,
    leverage: $("f-leverage").value || 1,
    fees: await computeTotalFeesInr(),
  };
  const pnl = computePnl(trade);
  const pnlPct = computePnlPct(trade);
  const el = $("calc-pnl-preview");
  const pctEl = $("calc-pnl-pct-preview");
  if (pnl == null || !trade.entry_price || !trade.investment_amount) {
    el.textContent = "—";
    el.className = "value";
    pctEl.textContent = "";
  } else {
    el.textContent = fmtMoney(pnl);
    el.className = "value " + (pnl >= 0 ? "pos" : "neg");
    pctEl.textContent = pnlPct == null ? "" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% ROI`;
  }
}

$("save-trade-btn").addEventListener("click", async () => {
  const symbol = $("f-symbol").value.trim().toUpperCase();
  const entryPrice = $("f-entry-price").value;
  const investment = $("f-investment").value;
  const entryDate = $("f-entry-date").value;

  if (!symbol || entryPrice === "" || investment === "" || !entryDate) {
    toast("Symbol, entry price, investment amount and entry date are required.");
    return;
  }

  const payload = {
    symbol,
    side: $("side-toggle").dataset.value,
    status: $("status-toggle").dataset.value,
    entry_price: Number(entryPrice),
    exit_price: $("f-exit-price").value === "" ? null : Number($("f-exit-price").value),
    investment_amount: Number(investment),
    leverage: $("f-leverage").value === "" ? 1 : Number($("f-leverage").value),
    fees: await computeTotalFeesInr(),
    entry_date: entryDate,
    exit_date: $("f-exit-date").value || null,
    notes: $("f-notes").value.trim() || null,
  };

  $("save-trade-btn").textContent = "Saving…";
  try {
    if (editingId) {
      const { error } = await sb.from("trades").update(payload).eq("id", editingId);
      if (error) throw error;
      toast("Trade updated");
    } else {
      payload.user_id = currentUser.id;
      const { error } = await sb.from("trades").insert(payload);
      if (error) throw error;
      toast("Trade saved");
    }
    await loadTrades();
    resetForm();
    showPage("trades");
  } catch (e) {
    toast("Error: " + e.message);
  } finally {
    $("save-trade-btn").textContent = "Save Trade";
  }
});

$("delete-trade-btn").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Delete this trade? This can't be undone.")) return;
  try {
    const { error } = await sb.from("trades").delete().eq("id", editingId);
    if (error) throw error;
    toast("Trade deleted");
    await loadTrades();
    resetForm();
    showPage("trades");
  } catch (e) {
    toast("Error: " + e.message);
  }
});

resetForm();
