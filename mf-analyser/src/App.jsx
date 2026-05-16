import { useState, useEffect, useRef } from "react";

// ─── CORS Proxy chain ─────────────────────────────────────────────────────────
const PROXIES = [
  (url) => url,                                                                 // direct first (works on deployed Vercel)
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://proxy.cors.sh/${url}`,
];

async function fetchWithProxy(url) {
  let lastErr = null;
  for (const makeUrl of PROXIES) {
    try {
      const res = await fetch(makeUrl(url), {
        headers: { "Accept": "application/json", "x-requested-with": "XMLHttpRequest" },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith("Host not") || text.trim().startsWith("<")) continue;
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("All fetch attempts failed");
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  dark: {
    bg: "#0a0e1a", surface: "#111827", card: "#1a2236", cardHover: "#1e2a40",
    border: "#2a3a52", borderLight: "#1e2d42",
    text: "#f0f4ff", textSub: "#8a9bc0", textMuted: "#4a5a78",
    accent: "#3b82f6", green: "#22c55e", red: "#ef4444",
    input: "#1a2236", shadow: "0 4px 24px rgba(0,0,0,0.4)", chip: "#1e2d42",
  },
  light: {
    bg: "#f0f4fb", surface: "#ffffff", card: "#ffffff", cardHover: "#f8faff",
    border: "#e2e8f0", borderLight: "#edf2f7",
    text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
    accent: "#2563eb", green: "#16a34a", red: "#dc2626",
    input: "#f8faff", shadow: "0 4px 24px rgba(0,0,0,0.08)", chip: "#e8edf5",
  },
};

const TABS    = ["NAV Chart","Returns","Risk Metrics","Best/Worst","Rolling Returns","Monthly Heatmap","SIP Calculator"];
const MONTHS  = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const POPULAR = [
  { name: "Parag Parikh Flexi Cap Fund – Direct – Growth", code: 122639 },
  { name: "Quant Small Cap Fund – Direct – Growth",        code: 120828 },
  { name: "HDFC Top 100 Fund – Direct – Growth",           code: 125497 },
  { name: "Nippon India Nifty 50 Index – Direct – Growth", code: 118989 },
  { name: "Mirae Asset Large Cap Fund – Direct – Growth",  code: 118834 },
  { name: "Axis Bluechip Fund – Direct – Growth",          code: 120503 },
];

// ─── Math helpers ─────────────────────────────────────────────────────────────
function parseDate(str) {
  const [d, m, y] = str.split("-");
  return new Date(`${y}-${m}-${d}`);
}
const fmt = (n, dec = 2) => (n == null || isNaN(n) ? "--" : Number(n).toFixed(dec));
const pct = (n) => n == null || isNaN(n) ? "--" : (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
const fmtCr = (n) => {
  if (n == null || isNaN(n)) return "--";
  if (Math.abs(n) >= 10000000) return "₹" + (n / 10000000).toFixed(2) + "Cr";
  if (Math.abs(n) >= 100000)   return "₹" + (n / 100000).toFixed(2) + "L";
  return "₹" + n.toFixed(0);
};

function getNavAt(data, daysAgo) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  for (const d of data) if (parseDate(d.date) <= target) return parseFloat(d.nav);
  return null;
}

function cagr(start, end, years) {
  if (!start || !end || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function computeStats(data) {
  if (!data?.length) return null;
  const latest   = parseFloat(data[0].nav);
  const latestDt = parseDate(data[0].date);
  const first    = parseFloat(data[data.length - 1].nav);
  const firstDt  = parseDate(data[data.length - 1].date);
  const yrs      = (latestDt - firstDt) / (1000 * 60 * 60 * 24 * 365.25);

  // Sharpe 3Y
  const cut3 = new Date(); cut3.setFullYear(cut3.getFullYear() - 3);
  const sl3  = data.filter(d => parseDate(d.date) >= cut3).map(d => parseFloat(d.nav));
  let sharpe = null, sortino = null, stdDev = null;
  if (sl3.length > 20) {
    const rets    = sl3.slice(0, -1).map((v, i) => (v - sl3[i + 1]) / sl3[i + 1]);
    const mean    = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance= rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    const std     = Math.sqrt(variance);
    const downDev = Math.sqrt(rets.filter(r => r < 0).reduce((a, r) => a + r * r, 0) / rets.length || variance);
    stdDev  = std * Math.sqrt(252) * 100;
    sharpe  = stdDev > 0 ? ((mean * 252 - 0.06) / (std * Math.sqrt(252))) : null;
    sortino = downDev > 0 ? ((mean * 252 - 0.06) / (downDev * Math.sqrt(252))) : null;
  }

  // Max drawdown
  let peak = -Infinity, maxDD = 0, ddDate = null;
  for (let i = data.length - 1; i >= 0; i--) {
    const v = parseFloat(data[i].nav);
    if (v > peak) peak = v;
    const dd = (v - peak) / peak * 100;
    if (dd < maxDD) { maxDD = dd; ddDate = data[i].date; }
  }

  const n1y = getNavAt(data, 365), n3y = getNavAt(data, 1095), n5y = getNavAt(data, 1825);
  return {
    latest, latestDate: data[0].date, inceptionDate: data[data.length - 1].date,
    ret1d:  (() => { const n = getNavAt(data, 2);   return n ? (latest - n) / n * 100 : null; })(),
    ret1y:  n1y ? cagr(n1y, latest, 1)  : null,
    cagr3y: n3y ? cagr(n3y, latest, 3)  : null,
    cagr5y: n5y ? cagr(n5y, latest, 5)  : null,
    cagrAll: cagr(first, latest, yrs),
    sharpe, sortino, stdDev, maxDD, ddDate, totalYears: yrs,
  };
}

function computeTrailing(data) {
  const latest  = parseFloat(data[0].nav);
  const latestDt= parseDate(data[0].date);
  const first   = parseFloat(data[data.length - 1].nav);
  const firstDt = parseDate(data[data.length - 1].date);
  const yrs     = (latestDt - firstDt) / (1000 * 60 * 60 * 24 * 365.25);
  const ytd     = (() => {
    const jan1 = new Date(`${latestDt.getFullYear()}-01-01`);
    for (const d of data) if (parseDate(d.date) <= jan1) return parseFloat(d.nav);
    return null;
  })();
  const row = (p, days, y) => {
    const n = days ? getNavAt(data, days) : null;
    return { period: p, ret: days ? (n ? (latest - n) / n * 100 : null) : (ytd ? (latest - ytd) / ytd * 100 : null), cagr: y && n ? cagr(n, latest, y) : null };
  };
  return [
    { period: "YTD",  ret: ytd ? (latest - ytd) / ytd * 100 : null, cagr: null },
    row("1D", 2), row("1W", 7), row("1M", 30), row("3M", 91), row("6M", 182),
    row("1Y", 365, 1), row("3Y", 1095, 3), row("5Y", 1825, 5), row("7Y", 2555, 7), row("10Y", 3650, 10),
    { period: "Since Inception", ret: (latest - first) / first * 100, cagr: cagr(first, latest, yrs) },
  ];
}

function computeCalYear(data) {
  const m = {};
  data.forEach(d => {
    const y = parseDate(d.date).getFullYear();
    if (!m[y]) m[y] = { first: d, last: d };
    else {
      if (parseDate(d.date) < parseDate(m[y].first.date)) m[y].first = d;
      if (parseDate(d.date) > parseDate(m[y].last.date))  m[y].last  = d;
    }
  });
  return Object.keys(m).sort().map(y => ({
    year: +y,
    ret: (parseFloat(m[y].last.nav) - parseFloat(m[y].first.nav)) / parseFloat(m[y].first.nav) * 100,
  }));
}

function computeMonthly(data) {
  const m = {};
  data.forEach(d => {
    const dt = parseDate(d.date), y = dt.getFullYear(), mo = dt.getMonth();
    if (!m[y]) m[y] = {};
    if (!m[y][mo]) m[y][mo] = { first: d, last: d };
    else {
      if (dt < parseDate(m[y][mo].first.date)) m[y][mo].first = d;
      if (dt > parseDate(m[y][mo].last.date))  m[y][mo].last  = d;
    }
  });
  const res = {};
  Object.keys(m).forEach(y => {
    res[y] = {};
    Object.keys(m[y]).forEach(mo => {
      res[y][mo] = (parseFloat(m[y][mo].last.nav) - parseFloat(m[y][mo].first.nav)) / parseFloat(m[y][mo].first.nav) * 100;
    });
  });
  return res;
}

function computeRolling(data, years) {
  const days   = Math.round(years * 365.25);
  const sorted = [...data].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  return sorted.reduce((acc, d, i) => {
    const end = parseDate(d.date), tgt = new Date(end);
    tgt.setDate(tgt.getDate() - days);
    let si = null;
    for (let j = i - 1; j >= 0; j--) { if (parseDate(sorted[j].date) <= tgt) { si = j; break; } }
    if (si !== null) {
      const y = (end - parseDate(sorted[si].date)) / (1000 * 60 * 60 * 24 * 365.25);
      if (y > 0) acc.push({ date: d.date, cagr: (Math.pow(parseFloat(d.nav) / parseFloat(sorted[si].nav), 1 / y) - 1) * 100 });
    }
    return acc;
  }, []);
}

function computeBestWorst(data) {
  const sorted = [...data].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  const res = {};
  for (const [k, days] of Object.entries({ week: 7, month: 30, quarter: 91, year: 365 })) {
    let best = null, worst = null;
    sorted.forEach((d, i) => {
      const end = parseDate(d.date), tgt = new Date(end);
      tgt.setDate(tgt.getDate() - days);
      let si = null;
      for (let j = i - 1; j >= 0; j--) { if (parseDate(sorted[j].date) <= tgt) { si = j; break; } }
      if (si !== null) {
        const r = (parseFloat(d.nav) - parseFloat(sorted[si].nav)) / parseFloat(sorted[si].nav) * 100;
        if (!best || r > best.ret)  best  = { ret: r, begin: sorted[si].date, end: d.date };
        if (!worst || r < worst.ret) worst = { ret: r, begin: sorted[si].date, end: d.date };
      }
    });
    res[k] = { best, worst };
  }
  return res;
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
function LineChart({ data, t, range }) {
  const W = 900, H = 280;
  if (!data?.length) return null;
  const now = new Date(), cut = new Date();
  if      (range === "1Y")  { cut.setFullYear(now.getFullYear() - 1); }
  else if (range === "3Y")  { cut.setFullYear(now.getFullYear() - 3); }
  else if (range === "5Y")  { cut.setFullYear(now.getFullYear() - 5); }
  else if (range === "YTD") { cut.setMonth(0, 1); }
  else { cut.setFullYear(2000); }
  const fd = data.filter(d => parseDate(d.date) >= cut);
  if (fd.length < 2) return <div style={{ color: t.textMuted, textAlign: "center", paddingTop: 60 }}>Not enough data for this range</div>;
  const navs = fd.map(d => parseFloat(d.nav));
  const minV = Math.min(...navs), maxV = Math.max(...navs);
  const pad = { t: 20, b: 44, l: 70, r: 20 };
  const W2 = W - pad.l - pad.r, H2 = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / (fd.length - 1)) * W2;
  const y = (v) => pad.t + (1 - (v - minV) / (maxV - minV || 1)) * H2;
  const pts = fd.map((d, i) => `${x(i)},${y(parseFloat(d.nav))}`).join(" ");
  const isUp = parseFloat(fd[fd.length - 1].nav) >= parseFloat(fd[0].nav);
  const col = isUp ? t.green : t.red;
  const gid = "gc" + Math.random().toString(36).slice(2, 8);
  const step = Math.max(1, Math.floor(fd.length / 7));
  const xL = [];
  for (let i = 0; i < fd.length; i += step) {
    const dt = parseDate(fd[i].date);
    xL.push({ x: x(i), label: `${dt.getMonth()+1}/${String(dt.getFullYear()).slice(2)}` });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }} aria-label="NAV Chart">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={col} stopOpacity="0.28" />
          <stop offset="100%" stopColor={col} stopOpacity="0"    />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
        const yp = pad.t + r * H2, v = maxV - r * (maxV - minV);
        return (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4" />
            <text x={pad.l - 8} y={yp + 4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}</text>
          </g>
        );
      })}
      <polygon points={`${pad.l},${pad.t + H2} ${pts} ${pad.l + W2},${pad.t + H2}`} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {xL.map((l, i) => <text key={i} x={l.x} y={H - 8} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
    </svg>
  );
}

// ─── SVG Rolling Chart ────────────────────────────────────────────────────────
function RollingChart({ data, t }) {
  const W = 900, H = 280;
  if (!data?.length) return <div style={{ color: t.textMuted, padding: "60px", textAlign: "center" }}>Not enough data for this rolling window</div>;
  const vals = data.map(d => d.cagr);
  const minV = Math.min(...vals, 0), maxV = Math.max(...vals);
  const pad = { t: 20, b: 44, l: 58, r: 20 };
  const W2 = W - pad.l - pad.r, H2 = H - pad.t - pad.b;
  const xf = (i) => pad.l + (i / (data.length - 1)) * W2;
  const yf = (v) => pad.t + (1 - (v - minV) / (maxV - minV || 1)) * H2;
  const pts = data.map((d, i) => `${xf(i)},${yf(d.cagr)}`).join(" ");
  const zY = yf(0);
  const step = Math.max(1, Math.floor(data.length / 7));
  const xL = [];
  for (let i = 0; i < data.length; i += step) {
    xL.push({ x: xf(i), label: parseDate(data[i].date).getFullYear().toString() });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }} aria-label="Rolling Returns Chart">
      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
        const yp = pad.t + r * H2, v = maxV - r * (maxV - minV);
        return (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4" />
            <text x={pad.l - 6} y={yp + 4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}%</text>
          </g>
        );
      })}
      <line x1={pad.l} x2={pad.l + W2} y1={zY} y2={zY} stroke={t.textMuted} strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={t.accent} strokeWidth="2.2" strokeLinejoin="round" />
      {xL.map((l, i) => <text key={i} x={l.x} y={H - 8} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [isDark, setIsDark]             = useState(true);
  const t                               = T[isDark ? "dark" : "light"];
  const [query, setQuery]               = useState("");
  const [suggestions, setSuggestions]   = useState([]);
  const [searching, setSearching]       = useState(false);
  const [fund, setFund]                 = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [activeTab, setActiveTab]       = useState("NAV Chart");
  const [navRange, setNavRange]         = useState("ALL");
  const [rollingYears, setRollingYears] = useState(3);
  const [rollingData, setRollingData]   = useState(null);
  const [sip, setSip]                   = useState({ lumpsum: 100000, monthly: 10000, duration: 5, expense: 1.5 });
  const [sipResult, setSipResult]       = useState(null);
  const debRef                          = useRef(null);
  const searchRef                       = useRef(null);

  // close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSuggestions([]); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // search
  const handleSearch = (val) => {
    setQuery(val);
    clearTimeout(debRef.current);
    if (!val.trim()) { setSuggestions([]); return; }
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const json = await fetchWithProxy(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(val)}`);
        setSuggestions((Array.isArray(json) ? json : []).slice(0, 12));
      } catch { setSuggestions([]); }
      setSearching(false);
    }, 380);
  };

  // load fund
  const loadFund = async (code) => {
    setLoading(true); setError(null); setSuggestions([]); setQuery(""); setSipResult(null);
    try {
      const json = await fetchWithProxy(`https://api.mfapi.in/mf/${code}`);
      if (!json?.data?.length) throw new Error("No NAV data returned for this fund");
      setFund(json);
      setActiveTab("NAV Chart");
      setNavRange("ALL");
    } catch (e) {
      setError(e.message || "Failed to load fund data. Please try again.");
    }
    setLoading(false);
  };

  // rolling recompute
  useEffect(() => {
    if (!fund) return;
    setRollingData(computeRolling(fund.data, rollingYears));
  }, [fund, rollingYears]);

  // SIP
  const calcSIP = () => {
    const { lumpsum, monthly, duration, expense } = sip;
    const base = stats?.cagr5y ?? 12;
    const adj  = Math.max(0, base - expense);
    const r = adj / 100 / 12, n = duration * 12;
    const sipFV  = r > 0 ? monthly * ((Math.pow(1 + r, n) - 1) / r) * (1 + r) : monthly * n;
    const lsFV   = lumpsum * Math.pow(1 + adj / 100, duration);
    const total  = sipFV + lsFV;
    const inv    = lumpsum + monthly * n;
    setSipResult({ sipFV, lsFV, total, invested: inv, gain: total - inv, cagr: adj });
  };

  const stats     = fund ? computeStats(fund.data)    : null;
  const calYear   = fund ? computeCalYear(fund.data)  : [];
  const trailing  = fund ? computeTrailing(fund.data) : [];
  const monthly   = fund ? computeMonthly(fund.data)  : {};
  const bestWorst = fund ? computeBestWorst(fund.data): null;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s = {
    app:      { minHeight: "100vh", backgroundColor: t.bg, color: t.text, fontFamily: "'DM Sans','Segoe UI',sans-serif" },
    nav:      { backgroundColor: t.surface, borderBottom: `1px solid ${t.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, position: "sticky", top: 0, zIndex: 100, boxShadow: t.shadow },
    logo:     { display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 20, color: t.text, cursor: "pointer", userSelect: "none" },
    logoBox:  { width: 36, height: 36, background: `linear-gradient(135deg, ${t.accent}, #6366f1)`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 },
    swrap:    { position: "relative", flex: 1, maxWidth: 520, margin: "0 28px" },
    sinput:   { width: "100%", padding: "9px 16px 9px 40px", borderRadius: 10, border: `1.5px solid ${t.border}`, backgroundColor: t.input, color: t.text, fontSize: 14, outline: "none", boxSizing: "border-box" },
    sicon:    { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textMuted, fontSize: 15, pointerEvents: "none" },
    drop:     { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, zIndex: 300, overflow: "hidden", boxShadow: t.shadow, maxHeight: 360, overflowY: "auto" },
    dropItem: { padding: "11px 16px", cursor: "pointer", fontSize: 13, borderBottom: `1px solid ${t.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
    themeBtn: { padding: "7px 16px", borderRadius: 8, border: `1px solid ${t.border}`, backgroundColor: t.chip, color: t.text, cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" },
    cont:     { maxWidth: 1140, margin: "0 auto", padding: "0 20px 80px" },
    card:     { backgroundColor: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: "20px 22px", marginBottom: 20 },
    ctitle:   { fontSize: 15, fontWeight: 700, color: t.accent, marginBottom: 16 },
    statsBar: { display: "flex", flexWrap: "wrap", gap: 1, backgroundColor: t.border, borderRadius: 14, overflow: "hidden", marginBottom: 20, border: `1px solid ${t.border}` },
    sCell:    { flex: "1 1 110px", padding: "14px 14px", backgroundColor: t.card, textAlign: "center" },
    sLabel:   { fontSize: 9, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.9px", marginBottom: 5 },
    sVal:     { fontSize: 17, fontWeight: 700, lineHeight: 1 },
    tabRow:   { display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 24, overflowX: "auto", gap: 0 },
    tab:  (a) => ({ padding: "11px 18px", cursor: "pointer", fontSize: 13, fontWeight: a ? 600 : 400, color: a ? t.accent : t.textSub, borderBottom: a ? `2.5px solid ${t.accent}` : "2.5px solid transparent", whiteSpace: "nowrap", userSelect: "none", backgroundColor: "transparent" }),
    table:    { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th:       { padding: "9px 12px", textAlign: "right",  color: t.textMuted, fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.6px", borderBottom: `1px solid ${t.border}` },
    thL:      { padding: "9px 12px", textAlign: "left",   color: t.textMuted, fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.6px", borderBottom: `1px solid ${t.border}` },
    td:       { padding: "9px 12px", textAlign: "right",  borderBottom: `1px solid ${t.borderLight}`, fontSize: 13 },
    tdL:      { padding: "9px 12px", textAlign: "left",   borderBottom: `1px solid ${t.borderLight}`, fontWeight: 500, fontSize: 13 },
    chip:     { display: "inline-block", padding: "7px 14px", backgroundColor: t.chip, borderRadius: 20, fontSize: 12, cursor: "pointer", border: `1px solid ${t.border}`, margin: "3px" },
    metricBox:{ flex: "1 1 150px", backgroundColor: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 16px" },
    mLabel:   { fontSize: 11, color: t.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.6px" },
    mVal:     { fontSize: 21, fontWeight: 700 },
  };

  const cv = (v) => ({ color: v == null || isNaN(v) ? t.textMuted : v >= 0 ? t.green : t.red, fontWeight: 600 });

  const Dropdown = () => (
    suggestions.length > 0 ? (
      <div style={s.drop}>
        {suggestions.map(su => (
          <div key={su.schemeCode} style={s.dropItem}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = t.chip}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
            onClick={() => loadFund(su.schemeCode)}>
            <span style={{ flex: 1, paddingRight: 8, lineHeight: 1.4 }}>{su.schemeName}</span>
            <span style={{ color: t.textMuted, fontSize: 11, whiteSpace: "nowrap" }}>#{su.schemeCode}</span>
          </div>
        ))}
      </div>
    ) : null
  );

  // ─── HOME ──────────────────────────────────────────────────────────────────
  if (!fund && !loading) return (
    <div style={s.app}>
      <nav style={s.nav}>
        <div style={s.logo}>
          <div style={s.logoBox}>📈</div>
          MFAnalyser
        </div>
        <button style={s.themeBtn} onClick={() => setIsDark(p => !p)}>
          {isDark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </nav>

      <div style={{ textAlign: "center", padding: "80px 24px 60px", maxWidth: 680, margin: "0 auto" }}>
        <div style={{ fontSize: 60, marginBottom: 20 }}>📊</div>
        <h1 style={{ fontSize: "clamp(28px,5vw,52px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 16 }}>
          Analyse any Indian<br />Mutual Fund
        </h1>
        <p style={{ color: t.textSub, fontSize: 16, lineHeight: 1.7, marginBottom: 40 }}>
          Live NAV history · Rolling CAGRs · Risk metrics · SIP & lumpsum calculator<br />
          All from public AMFI data — free, no login required.
        </p>

        <div ref={searchRef} style={{ position: "relative", marginBottom: 28 }}>
          <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: t.textMuted, pointerEvents: "none" }}>🔍</span>
          <input
            style={{ width: "100%", padding: "15px 20px 15px 50px", borderRadius: 14, border: `1.5px solid ${t.border}`, backgroundColor: t.input, color: t.text, fontSize: 16, outline: "none", boxSizing: "border-box", boxShadow: t.shadow }}
            placeholder="Search e.g. Parag Parikh, HDFC, Nifty 50…"
            value={query}
            onChange={e => handleSearch(e.target.value)}
          />
          {searching && <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: t.textMuted, fontSize: 12 }}>Searching…</div>}
          <Dropdown />
        </div>

        <div>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>✦ Popular Funds</div>
          {POPULAR.map(p => (
            <span key={p.code} style={s.chip} onClick={() => loadFund(p.code)}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = t.accent; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = t.accent; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = t.chip; e.currentTarget.style.color = t.text; e.currentTarget.style.borderColor = t.border; }}>
              {p.name.split("–")[0].trim()} <span style={{ color: t.textMuted, fontSize: 10 }}>#{p.code}</span>
            </span>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: 32, backgroundColor: t.card, border: `1px solid ${t.red}`, borderRadius: 12, padding: 20, textAlign: "left" }}>
            <div style={{ color: t.red, fontWeight: 700, marginBottom: 8 }}>⚠️ Error</div>
            <div style={{ color: t.textSub, fontSize: 13, lineHeight: 1.6 }}>{error}</div>
          </div>
        )}

        <div style={{ marginTop: 60, fontSize: 12, color: t.textMuted, lineHeight: 1.8 }}>
          Data sourced from <strong>AMFI India</strong> via mfapi.in · For informational purposes only<br />
          Not investment advice · Past performance does not guarantee future results
        </div>
      </div>
    </div>
  );

  // ─── LOADING ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 48 }}>⏳</div>
      <div style={{ fontSize: 16, color: t.textSub }}>Loading fund data…</div>
      <div style={{ fontSize: 12, color: t.textMuted }}>Fetching from AMFI · please wait</div>
    </div>
  );

  // ─── FUND DETAIL ───────────────────────────────────────────────────────────
  return (
    <div style={s.app}>
      {/* NAV */}
      <nav style={s.nav}>
        <div style={s.logo} onClick={() => { setFund(null); setError(null); }}>
          <div style={s.logoBox}>📈</div>
          <span style={{ display: "none" }}>MFAnalyser</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: t.textMuted }}>MFAnalyser</span>
        </div>
        <div ref={searchRef} style={s.swrap}>
          <span style={s.sicon}>🔍</span>
          <input style={s.sinput} placeholder="Search another fund…" value={query} onChange={e => handleSearch(e.target.value)} />
          <Dropdown />
        </div>
        <button style={s.themeBtn} onClick={() => setIsDark(p => !p)}>
          {isDark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </nav>

      <div style={s.cont}>
        {/* Fund Header */}
        <div style={{ padding: "22px 0 16px" }}>
          <div style={{ fontSize: 11, color: t.textMuted, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 4 }}>
            {fund.meta?.fund_house}
          </div>
          <h2 style={{ fontSize: "clamp(14px, 2vw, 20px)", fontWeight: 700, lineHeight: 1.35, marginBottom: 10 }}>
            {fund.meta?.scheme_name}
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[fund.meta?.scheme_category, fund.meta?.scheme_type].filter(Boolean).map(tag => (
              <span key={tag} style={{ ...s.chip, fontSize: 11, padding: "4px 11px", cursor: "default" }}>{tag}</span>
            ))}
            {stats && (
              <span style={{ ...s.chip, fontSize: 11, padding: "4px 11px", cursor: "default", color: t.textMuted }}>
                Since {stats.inceptionDate}
              </span>
            )}
          </div>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div style={s.statsBar}>
            {[
              { label: "Latest NAV",      val: `₹${fmt(stats.latest)}`,        color: t.text },
              { label: "1D Return",       val: pct(stats.ret1d),               color: (stats.ret1d ?? 0) >= 0 ? t.green : t.red },
              { label: "1Y Return",       val: pct(stats.ret1y),               color: (stats.ret1y ?? 0) >= 0 ? t.green : t.red },
              { label: "3Y CAGR",         val: pct(stats.cagr3y),              color: (stats.cagr3y ?? 0) >= 0 ? t.green : t.red },
              { label: "5Y CAGR",         val: pct(stats.cagr5y),              color: (stats.cagr5y ?? 0) >= 0 ? t.green : t.red },
              { label: "Since Inception", val: pct(stats.cagrAll),             color: (stats.cagrAll ?? 0) >= 0 ? t.green : t.red },
              { label: "Sharpe (3Y)",     val: stats.sharpe != null ? fmt(stats.sharpe) : "--", color: t.text },
              { label: "Max Drawdown",    val: pct(stats.maxDD),               color: t.red },
            ].map(item => (
              <div key={item.label} style={s.sCell}>
                <div style={s.sLabel}>{item.label}</div>
                <div style={{ ...s.sVal, color: item.color }}>{item.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={s.tabRow}>
          {TABS.map(tab => (
            <div key={tab} style={s.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>{tab}</div>
          ))}
        </div>

        {/* ── NAV CHART ── */}
        {activeTab === "NAV Chart" && (
          <div style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
              <div style={s.ctitle}>NAV History</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["YTD", "1Y", "3Y", "5Y", "ALL"].map(r => (
                  <button key={r} onClick={() => setNavRange(r)} style={{
                    padding: "5px 13px", borderRadius: 7, border: `1px solid ${navRange === r ? t.accent : t.border}`,
                    backgroundColor: navRange === r ? t.accent : t.chip, color: navRange === r ? "#fff" : t.text,
                    cursor: "pointer", fontSize: 12, fontWeight: navRange === r ? 600 : 400
                  }}>{r}</button>
                ))}
              </div>
            </div>
            <div style={{ height: 280 }}><LineChart data={fund.data} t={t} range={navRange} /></div>
            {stats && (
              <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
                {[
                  { label: "Inception Date", val: stats.inceptionDate },
                  { label: "Latest Date",    val: stats.latestDate },
                  { label: "Data Points",    val: fund.data.length.toLocaleString() },
                ].map(m => (
                  <div key={m.label} style={{ fontSize: 12 }}>
                    <span style={{ color: t.textMuted }}>{m.label}: </span>
                    <span style={{ fontWeight: 600 }}>{m.val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RETURNS ── */}
        {activeTab === "Returns" && (
          <>
            <div style={s.card}>
              <div style={s.ctitle}>Trailing Returns (%)</div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.thL}>Period</th>
                      {trailing.map(r => <th key={r.period} style={s.th}>{r.period}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={s.tdL}>Return (%)</td>
                      {trailing.map(r => <td key={r.period} style={{ ...s.td, ...cv(r.ret) }}>{r.ret != null ? fmt(r.ret) : "--"}</td>)}
                    </tr>
                    <tr>
                      <td style={s.tdL}>CAGR (%)</td>
                      {trailing.map(r => <td key={r.period} style={{ ...s.td, ...cv(r.cagr) }}>{r.cagr != null ? fmt(r.cagr) : "--"}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style={s.card}>
              <div style={s.ctitle}>Calendar Year Returns (%)</div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.thL}>Year</th>
                      {calYear.map(r => <th key={r.year} style={s.th}>{r.year}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={s.tdL}>Return (%)</td>
                      {calYear.map(r => <td key={r.year} style={{ ...s.td, ...cv(r.ret) }}>{fmt(r.ret)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Bar chart */}
              <div style={{ marginTop: 24, display: "flex", alignItems: "flex-end", gap: 4, height: 120, overflowX: "auto", paddingBottom: 24 }}>
                {calYear.map(r => {
                  const maxAbs = Math.max(...calYear.map(c => Math.abs(c.ret)));
                  const h = Math.abs(r.ret) / maxAbs * 90;
                  return (
                    <div key={r.year} style={{ flex: "1 0 26px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative" }}>
                      <div style={{ fontSize: 9, color: r.ret >= 0 ? t.green : t.red, marginBottom: 2, fontWeight: 600 }}>{fmt(r.ret)}</div>
                      <div style={{ width: "78%", height: `${h}px`, backgroundColor: r.ret >= 0 ? t.green : t.red, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                      <div style={{ fontSize: 9, color: t.textMuted, marginTop: 4, transform: "rotate(-45deg)", whiteSpace: "nowrap", transformOrigin: "top center", position: "absolute", bottom: -20 }}>{r.year}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── RISK METRICS ── */}
        {activeTab === "Risk Metrics" && stats && (
          <>
            <div style={s.card}>
              <div style={s.ctitle}>Risk Metrics (3-Year Window)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {[
                  { label: "3Y CAGR",           val: pct(stats.cagr3y),  color: (stats.cagr3y ?? 0) >= 0 ? t.green : t.red },
                  { label: "5Y CAGR",           val: pct(stats.cagr5y),  color: (stats.cagr5y ?? 0) >= 0 ? t.green : t.red },
                  { label: "Since Inception",   val: pct(stats.cagrAll), color: (stats.cagrAll ?? 0) >= 0 ? t.green : t.red },
                  { label: "Sharpe Ratio (3Y)", val: stats.sharpe != null ? fmt(stats.sharpe) : "--", color: (stats.sharpe ?? 0) >= 1 ? t.green : t.textSub },
                  { label: "Sortino Ratio (3Y)",val: stats.sortino != null ? fmt(stats.sortino) : "--", color: (stats.sortino ?? 0) >= 1 ? t.green : t.textSub },
                  { label: "Std Dev (Ann.) %",  val: stats.stdDev != null ? fmt(stats.stdDev) + "%" : "--", color: t.text },
                  { label: "Max Drawdown",      val: pct(stats.maxDD),   color: t.red },
                  { label: "Drawdown Date",     val: stats.ddDate ?? "--", color: t.textSub },
                  { label: "Risk-Free Rate",    val: "6.0% p.a.",         color: t.textMuted },
                ].map(m => (
                  <div key={m.label} style={s.metricBox}>
                    <div style={s.mLabel}>{m.label}</div>
                    <div style={{ ...s.mVal, color: m.color }}>{m.val}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={s.card}>
              <div style={s.ctitle}>Annual Return by Calendar Year</div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.thL}>Year</th>
                      <th style={s.th}>Calendar Return %</th>
                      <th style={s.th}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calYear.map(r => (
                      <tr key={r.year}>
                        <td style={s.tdL}>{r.year}</td>
                        <td style={{ ...s.td, ...cv(r.ret) }}>{fmt(r.ret)}%</td>
                        <td style={{ ...s.td, color: r.ret >= 0 ? t.green : t.red }}>{r.ret >= 0 ? "▲ Positive" : "▼ Negative"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── BEST/WORST ── */}
        {activeTab === "Best/Worst" && bestWorst && (
          <div style={s.card}>
            <div style={s.ctitle}>Best &amp; Worst Periods</div>
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.thL}></th>
                    {["WEEK", "MONTH", "QUARTER", "YEAR"].flatMap(p => [
                      <th key={p + "B"} style={{ ...s.th, color: t.green }}>{p} BEST</th>,
                      <th key={p + "W"} style={{ ...s.th, color: t.red }}>{p} WORST</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Return (%)", fn: (p, bw) => bw ? fmt(bw.ret) + "%" : "--", bwColor: true },
                    { label: "Begin",      fn: (p, bw) => bw?.begin ?? "--", bwColor: false },
                    { label: "End",        fn: (p, bw) => bw?.end   ?? "--", bwColor: false },
                  ].map(row => (
                    <tr key={row.label}>
                      <td style={s.tdL}>{row.label}</td>
                      {["week", "month", "quarter", "year"].flatMap(p => [
                        <td key={p + "b"} style={{ ...s.td, color: row.bwColor ? t.green : t.text, fontWeight: row.bwColor ? 600 : 400 }}>{row.fn(p, bestWorst[p]?.best)}</td>,
                        <td key={p + "w"} style={{ ...s.td, color: row.bwColor ? t.red : t.text, fontWeight: row.bwColor ? 600 : 400 }}>{row.fn(p, bestWorst[p]?.worst)}</td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ROLLING RETURNS ── */}
        {activeTab === "Rolling Returns" && (
          <div style={s.card}>
            <div style={{ ...s.ctitle, marginBottom: 14 }}>Rolling Returns (CAGR)</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {[1, 3, 5, 7, 10, 12, 15].map(y => (
                <button key={y} onClick={() => setRollingYears(y)} style={{
                  padding: "5px 16px", borderRadius: 20,
                  border: `1px solid ${rollingYears === y ? t.accent : t.border}`,
                  backgroundColor: rollingYears === y ? t.accent : t.chip,
                  color: rollingYears === y ? "#fff" : t.text,
                  cursor: "pointer", fontSize: 13, fontWeight: rollingYears === y ? 600 : 400
                }}>{y}Y</button>
              ))}
            </div>
            <div style={{ height: 280 }}><RollingChart data={rollingData} t={t} /></div>
            {rollingData?.length > 0 && (
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                {[
                  { label: "Min CAGR",    val: Math.min(...rollingData.map(d => d.cagr)),                               color: t.red },
                  { label: "Max CAGR",    val: Math.max(...rollingData.map(d => d.cagr)),                               color: t.green },
                  { label: "Avg CAGR",    val: rollingData.reduce((a, b) => a + b.cagr, 0) / rollingData.length,        color: t.accent },
                  { label: "% Positive",  val: rollingData.filter(d => d.cagr > 0).length / rollingData.length * 100,   color: t.green, suffix: "%" },
                  { label: "Data Points", val: rollingData.length, color: t.textSub, suffix: "" },
                ].map(m => (
                  <div key={m.label} style={s.metricBox}>
                    <div style={s.mLabel}>{m.label}</div>
                    <div style={{ ...s.mVal, color: m.color, fontSize: 18 }}>{typeof m.val === "number" ? fmt(m.val) : m.val}{m.suffix ?? "%"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MONTHLY HEATMAP ── */}
        {activeTab === "Monthly Heatmap" && (
          <div style={s.card}>
            <div style={s.ctitle}>Monthly Returns Heatmap</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...s.table, minWidth: 780 }}>
                <thead>
                  <tr>
                    <th style={s.thL}>YEAR</th>
                    {MONTHS.map(m => <th key={m} style={s.th}>{m}</th>)}
                    <th style={s.th}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(monthly).sort().reverse().map(year => {
                    const total = Object.values(monthly[year]).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={year}>
                        <td style={s.tdL}>{year}</td>
                        {[...Array(12)].map((_, mi) => {
                          const v = monthly[year][mi];
                          const intensity = Math.min(Math.abs(v ?? 0) / 15, 1);
                          const bg = v == null ? "transparent"
                            : v >= 0 ? `rgba(34,197,94,${0.07 + intensity * 0.5})`
                                     : `rgba(239,68,68,${0.07 + intensity * 0.5})`;
                          return (
                            <td key={mi} title={v != null ? `${MONTHS[mi]} ${year}: ${fmt(v)}%` : undefined}
                              style={{ ...s.td, backgroundColor: bg, color: v == null ? t.textMuted : v >= 0 ? t.green : t.red, fontWeight: 500, fontSize: 12 }}>
                              {v != null ? fmt(v) : "--"}
                            </td>
                          );
                        })}
                        <td style={{ ...s.td, ...cv(total), fontWeight: 700 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SIP CALCULATOR ── */}
        {activeTab === "SIP Calculator" && (
          <div style={s.card}>
            <div style={s.ctitle}>SIP & Lumpsum Calculator</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
              {[
                { key: "lumpsum",  label: "Lumpsum Amount (₹)",    step: 10000, min: 0 },
                { key: "monthly",  label: "Monthly SIP (₹)",        step: 1000,  min: 0 },
                { key: "duration", label: "Investment Duration (Yrs)", step: 1,  min: 1, max: 40 },
                { key: "expense",  label: "Expense Ratio (% p.a.)", step: 0.05, min: 0, max: 5 },
              ].map(f => (
                <div key={f.key} style={{ flex: "1 1 200px" }}>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.6px" }}>{f.label}</div>
                  <input type="number" step={f.step} min={f.min} max={f.max}
                    value={sip[f.key]}
                    onChange={e => setSip(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: 9, border: `1.5px solid ${t.border}`, backgroundColor: t.input, color: t.text, fontSize: 14, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              ))}
            </div>

            <button onClick={calcSIP} style={{ padding: "12px 36px", borderRadius: 10, background: `linear-gradient(135deg, ${t.accent}, #6366f1)`, color: "#fff", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, letterSpacing: "0.3px" }}>
              Calculate Returns
            </button>

            {sipResult && (
              <div style={{ marginTop: 28 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "Total Invested",      val: fmtCr(sipResult.invested), color: t.text },
                    { label: "SIP Corpus",          val: fmtCr(sipResult.sipFV),    color: t.green },
                    { label: "Lumpsum Corpus",      val: fmtCr(sipResult.lsFV),     color: t.green },
                    { label: "Total Corpus",        val: fmtCr(sipResult.total),    color: t.accent },
                    { label: "Estimated Gain",      val: fmtCr(sipResult.gain),     color: sipResult.gain >= 0 ? t.green : t.red },
                    { label: "Applied CAGR",        val: pct(sipResult.cagr),       color: t.text },
                    { label: "Wealth Multiplier",   val: fmt(sipResult.total / sipResult.invested, 2) + "x", color: t.accent },
                  ].map(m => (
                    <div key={m.label} style={s.metricBox}>
                      <div style={s.mLabel}>{m.label}</div>
                      <div style={{ ...s.mVal, color: m.color }}>{m.val}</div>
                    </div>
                  ))}
                </div>

                {/* Stacked bar */}
                <div style={{ backgroundColor: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Investment Breakdown</div>
                  <div style={{ height: 32, borderRadius: 8, overflow: "hidden", display: "flex", marginBottom: 10 }}>
                    <div style={{ width: `${sipResult.invested / sipResult.total * 100}%`, background: t.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 600, minWidth: 40 }}>
                      Invested
                    </div>
                    <div style={{ flex: 1, background: t.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 600 }}>
                      Returns
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: t.textMuted }}>
                    <span>Invested: {(sipResult.invested / sipResult.total * 100).toFixed(1)}%</span>
                    <span>Returns: {(sipResult.gain / sipResult.total * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 12, lineHeight: 1.6 }}>
                    * Applied CAGR = Fund's 5Y CAGR ({fmt(stats?.cagr5y)}%) − Expense Ratio ({sip.expense}%).<br />
                    Results are indicative only. Not financial advice.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <button onClick={() => { setFund(null); setError(null); setSipResult(null); }}
          style={{ padding: "9px 22px", borderRadius: 9, border: `1px solid ${t.border}`, backgroundColor: t.chip, color: t.text, cursor: "pointer", fontSize: 13, marginTop: 10 }}>
          ← Back to Search
        </button>
      </div>
    </div>
  );
}
