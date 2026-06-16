import { useState, useEffect, useRef } from "react";

const PAIRS = [
  { label: "XAU/USD", symbol: "XAU/USD", decimals: 2,  base: 2325.00, vol: 1.8    },
  { label: "EUR/USD", symbol: "EUR/USD", decimals: 5,  base: 1.08450, vol: 0.00035 },
  { label: "GBP/USD", symbol: "GBP/USD", decimals: 5,  base: 1.27230, vol: 0.00045 },
  { label: "USD/JPY", symbol: "USD/JPY", decimals: 3,  base: 149.520, vol: 0.055   },
  { label: "CHF/JPY", symbol: "CHF/JPY", decimals: 3,  base: 168.340, vol: 0.065   },
];

const TIMEFRAMES = [
  { label: "1 min",  interval: "1min",  seconds: 60  },
  { label: "5 min",  interval: "5min",  seconds: 300 },
  { label: "15 min", interval: "15min", seconds: 900 },
];

// ── EMA ──────────────────────────────────────────────────────────────────────
function calcEMA(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function computeSignal(closes) {
  if (closes.length < 26) return null;
  const e8  = calcEMA(closes, 8);
  const e21 = calcEMA(closes, 21);
  if (e8.length < 2 || e21.length < 2) return null;
  const le8  = e8[e8.length - 1],  pe8  = e8[e8.length - 2];
  const le21 = e21[e21.length - 1], pe21 = e21[e21.length - 2];
  const last = closes[closes.length - 1];
  const spread    = Math.abs(le8 - le21) / last;
  const strength  = Math.min(99, Math.round(spread * 12000 * 8));
  const trend     = strength > 60 ? "Strong Trend" : strength > 30 ? "Moderate" : "Weak";
  const crossover = (pe8 <= pe21 && le8 > le21) || (pe8 >= pe21 && le8 < le21);
  const direction = le8 > le21 ? "UP" : le8 < le21 ? "DOWN" : "NEUTRAL";
  return { direction, strength, trend, crossover, ema8: le8, ema21: le21,
           price: last, allEma8: e8, allEma21: e21 };
}

// ── Seed candles ─────────────────────────────────────────────────────────────
function seedCandles(pair, count = 80) {
  const candles = [];
  let price = pair.base + (Math.random() - 0.5) * pair.vol * 4;
  let trend = Math.random() > 0.5 ? 1 : -1;
  let trendStrength = Math.random() * 0.3 + 0.1;
  let trendCount = 0;
  for (let i = 0; i < count; i++) {
    trendCount++;
    if (trendCount > 15 + Math.random() * 20) {
      trend *= -1;
      trendStrength = Math.random() * 0.3 + 0.1;
      trendCount = 0;
    }
    const o = price;
    const drift = trend * trendStrength * pair.vol;
    const noise = (Math.random() - 0.5) * pair.vol * 2;
    price = Math.max(price + drift + noise, pair.base * 0.85);
    const c = price;
    const wick = pair.vol * (Math.random() * 0.8 + 0.2);
    const h = Math.max(o, c) + wick * Math.random();
    const l = Math.min(o, c) - wick * Math.random();
    candles.push({ open: o, high: h, low: l, close: c, time: Date.now() - (count - i) * 60000 });
  }
  return candles;
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function MiniChart({ candles, sig }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || candles.length < 3) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, pad = 10;
    ctx.clearRect(0, 0, W, H);
    const mn  = Math.min(...candles.map(c => c.low));
    const mx  = Math.max(...candles.map(c => c.high));
    const rng = mx - mn || 0.0001;
    const toY = v => H - pad - ((v - mn) / rng) * (H - pad * 2);
    const toX = i => pad + (i / (candles.length - 1)) * (W - pad * 2);
    const cw  = Math.max(2, (W - pad * 2) / candles.length - 1);
    candles.forEach((c, i) => {
      const x = toX(i), bull = c.close >= c.open;
      ctx.strokeStyle = bull ? "#00FF88" : "#FF3B5C";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
      ctx.fillStyle = bull ? "#00FF8840" : "#FF3B5C40";
      const y1 = toY(Math.max(c.open, c.close)), y2 = toY(Math.min(c.open, c.close));
      ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
    });
    if (sig) {
      const draw = (arr, color) => {
        if (arr.length < 2) return;
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.8;
        arr.forEach((v, i) => {
          i === 0 ? ctx.moveTo(toX(candles.length - arr.length + i), toY(v))
                  : ctx.lineTo(toX(candles.length - arr.length + i), toY(v));
        });
        ctx.stroke();
      };
      draw(sig.allEma8.slice(-candles.length),  "#00D4FF");
      draw(sig.allEma21.slice(-candles.length), "#FF8C00");
    }
    const lp = candles[candles.length - 1].close;
    ctx.beginPath();
    ctx.arc(toX(candles.length - 1), toY(lp), 4, 0, Math.PI * 2);
    ctx.fillStyle   = sig?.direction === "UP" ? "#00FF88" : sig?.direction === "DOWN" ? "#FF3B5C" : "#00D4FF";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    ctx.fill(); ctx.shadowBlur = 0;
  }, [candles, sig]);
  return <canvas ref={ref} width={300} height={110} style={{ width:"100%", height:110 }} />;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [pair,       setPair]       = useState(PAIRS[0]);
  const [tf,         setTf]         = useState(TIMEFRAMES[1]);
  const [candles,    setCandles]    = useState([]);
  const [signal,     setSignal]     = useState(null);
  const [livePrice,  setLivePrice]  = useState(null);
  const [prevPrice,  setPrevPrice]  = useState(null);
  const [history,    setHistory]    = useState([]);
  const [pulseKey,   setPulseKey]   = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [mode,       setMode]       = useState("sim");
  const prevSigRef  = useRef(null);
  const intervalRef = useRef(null);
  const tickRef     = useRef(null);

  const processSignal = (built, currentPair) => {
    const closes = built.map(c => c.close);
    const latest = closes[closes.length - 1];
    setLivePrice(prev => { setPrevPrice(prev); return latest; });
    const sig = computeSignal(closes);
    if (sig && prevSigRef.current) {
      if (sig.crossover && sig.direction !== prevSigRef.current.direction) {
        setPulseKey(k => k + 1);
        setHistory(h => [{
          time:     new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" }),
          dir:      sig.direction,
          price:    latest.toFixed(currentPair.decimals),
          pair:     currentPair.label,
          strength: sig.strength,
        }, ...h].slice(0, 10));
      }
    }
    prevSigRef.current = sig;
    setSignal(sig);
    setLastUpdate(new Date());
  };

  // ── Fetch via Vercel proxy (same origin = no CORS) ────────────────────────
  const tryLive = async (currentPair, currentTf) => {
    try {
      const url  = `/api/proxy?symbol=${encodeURIComponent(currentPair.symbol)}&interval=${currentTf.interval}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.status === "ok" && data.values?.length) {
        const built = [...data.values].reverse().map(v => ({
          time:  new Date(v.datetime).getTime(),
          open:  parseFloat(v.open),
          high:  parseFloat(v.high),
          low:   parseFloat(v.low),
          close: parseFloat(v.close),
        }));
        setCandles(built);
        processSignal(built, currentPair);
        setMode("live");
        return true;
      }
    } catch {}
    return false;
  };

  // ── Simulation tick ───────────────────────────────────────────────────────
  const simTick = (currentPair, currentTf) => {
    setCandles(prev => {
      if (!prev.length) return prev;
      const last   = prev[prev.length - 1];
      const drift  = (Math.random() - 0.499) * currentPair.vol * 1.2;
      const close  = Math.max(last.close + drift, currentPair.base * 0.85);
      const now    = Date.now();
      const bucket = Math.floor(now / (currentTf.seconds * 1000)) * (currentTf.seconds * 1000);
      let built;
      if (last.time === bucket) {
        built = [...prev.slice(0, -1), {
          ...last, high: Math.max(last.high, close),
          low: Math.min(last.low, close), close,
        }];
      } else {
        built = [...prev, {
          time: bucket, open: last.close,
          high: Math.max(last.close, close),
          low:  Math.min(last.close, close), close,
        }].slice(-100);
      }
      processSignal(built, currentPair);
      return built;
    });
  };

  useEffect(() => {
    clearInterval(intervalRef.current);
    clearInterval(tickRef.current);
    setCandles([]); setSignal(null); setLivePrice(null);
    prevSigRef.current = null;

    // Seed sim immediately so chart shows right away
    const seed = seedCandles(pair);
    setCandles(seed);
    processSignal(seed, pair);
    setMode("sim");

    // Try live via proxy
    tryLive(pair, tf).then(ok => {
      if (ok) {
        intervalRef.current = setInterval(() => tryLive(pair, tf), 15000);
      } else {
        // Fallback simulation
        tickRef.current = setInterval(() => simTick(pair, tf), 2000);
      }
    });

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(tickRef.current);
    };
  }, [pair, tf]);

  const dirColor = signal?.direction === "UP"  ? "#00FF88"
                 : signal?.direction === "DOWN" ? "#FF3B5C" : "#94A3B8";

  return (
    <div style={{ background:"#080C18", minHeight:"100vh", color:"#E2E8F0",
      fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:40 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes ripple  { 0%{box-shadow:0 0 0 0 rgba(0,255,136,0.4)} 100%{box-shadow:0 0 0 20px rgba(0,255,136,0)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        @keyframes flash   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        button { border:none; outline:none; }
        button:active { opacity:0.7; }
      `}</style>

      {/* Header */}
      <div style={{ background:"#0B0F1E", borderBottom:"1px solid #1A2540",
        padding:"14px 18px", display:"flex", justifyContent:"space-between",
        alignItems:"center", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, background:"linear-gradient(135deg,#00D4FF,#0055FF)",
            borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>📡</div>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono'", fontSize:15, fontWeight:700, letterSpacing:-0.5 }}>
              SIGNAL<span style={{ color:"#00D4FF" }}>PRO</span>
            </div>
            <div style={{ fontSize:10, color:"#334155" }}>Live Forex · EMA 8/21</div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
            <div style={{ width:7, height:7, borderRadius:"50%",
              background: mode==="live" ? "#00FF88" : "#00D4FF",
              animation:"blink 2s infinite" }} />
            <span style={{ fontSize:11, fontFamily:"'JetBrains Mono'", fontWeight:700,
              color: mode==="live" ? "#00FF88" : "#00D4FF" }}>
              {mode==="live" ? "LIVE" : "PRACTICE"}
            </span>
          </div>
          {lastUpdate && (
            <div style={{ fontSize:9, color:"#334155", fontFamily:"'JetBrains Mono'", marginTop:2 }}>
              {lastUpdate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding:"14px 14px 0", maxWidth:480, margin:"0 auto" }}>

        {/* Mode banner */}
        {mode === "sim" && (
          <div style={{ background:"#06101A", border:"1px solid #00D4FF33",
            borderRadius:12, padding:"11px 14px", marginBottom:10,
            display:"flex", gap:10, alignItems:"center" }}>
            <span style={{ fontSize:16 }}>🔵</span>
            <div style={{ fontSize:11, color:"#334155", lineHeight:1.5 }}>
              <strong style={{ color:"#00D4FF" }}>Connecting to live data...</strong> Using
              realistic simulation while connecting. Will switch to LIVE automatically.
            </div>
          </div>
        )}

        {/* Pair selector */}
        <div style={{ background:"#0F1628", border:"1px solid #1A2540",
          borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
          <div style={{ fontSize:10, color:"#334155", letterSpacing:1.2,
            fontWeight:700, textTransform:"uppercase", marginBottom:8 }}>Currency Pair</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
            {PAIRS.map(p => (
              <button key={p.label} onClick={() => setPair(p)} style={{
                background:  p.label===pair.label ? "#00D4FF18" : "#080C18",
                border:     `1px solid ${p.label===pair.label ? "#00D4FF" : "#1A2540"}`,
                borderRadius:8, padding:"8px 2px",
                color:       p.label===pair.label ? "#00D4FF" : "#475569",
                fontSize:9.5, fontWeight:700, cursor:"pointer",
                fontFamily:"'JetBrains Mono'", transition:"all 0.15s",
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* Timeframe */}
        <div style={{ background:"#0F1628", border:"1px solid #1A2540",
          borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
          <div style={{ fontSize:10, color:"#334155", letterSpacing:1.2,
            fontWeight:700, textTransform:"uppercase", marginBottom:8 }}>Candle Timeframe</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
            {TIMEFRAMES.map(t => (
              <button key={t.label} onClick={() => setTf(t)} style={{
                background:  t.label===tf.label ? "#00D4FF18" : "#080C18",
                border:     `1px solid ${t.label===tf.label ? "#00D4FF" : "#1A2540"}`,
                borderRadius:8, padding:"10px",
                color:       t.label===tf.label ? "#00D4FF" : "#475569",
                fontSize:12, fontWeight:700, cursor:"pointer",
                fontFamily:"'JetBrains Mono'", transition:"all 0.15s",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Price + Chart */}
        <div style={{ background:"#0F1628", border:"1px solid #1A2540",
          borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between",
            alignItems:"flex-start", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:10, color:"#334155", letterSpacing:1.2,
                fontWeight:700, textTransform:"uppercase", marginBottom:4 }}>
                {pair.label} · {mode==="live" ? "Live" : "Practice"}
              </div>
              <div style={{
                fontSize:30, fontWeight:800, fontFamily:"'JetBrains Mono'", letterSpacing:-1,
                color: livePrice && prevPrice
                  ? (livePrice > prevPrice ? "#00FF88" : livePrice < prevPrice ? "#FF3B5C" : "#E2E8F0")
                  : "#E2E8F0",
                transition:"color 0.3s",
              }}>
                {livePrice ? livePrice.toFixed(pair.decimals)
                           : <span style={{ color:"#1E2A42", fontSize:20 }}>──────</span>}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10, color:"#334155" }}>CANDLES</div>
              <div style={{ fontSize:13, fontFamily:"'JetBrains Mono'", color:"#475569" }}>
                {candles.length}
              </div>
              <div style={{ fontSize:9, color:"#1E2A42", marginTop:4 }}>
                <span style={{ color:"#00D4FF" }}>━</span> EMA8&nbsp;
                <span style={{ color:"#FF8C00" }}>━</span> EMA21
              </div>
            </div>
          </div>
          <MiniChart candles={candles.slice(-60)} sig={signal} />
        </div>

        {/* Signal card */}
        {signal && (
          <div key={pulseKey} style={{
            background: signal.direction==="UP"  ? "#00FF8806"
                      : signal.direction==="DOWN" ? "#FF3B5C06" : "#1A254006",
            border:`1.5px solid ${dirColor}`,
            borderRadius:12, padding:"14px 16px", marginBottom:10,
            animation: signal.crossover ? "ripple 0.7s ease-out" : "none",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#334155", letterSpacing:1.2,
                fontWeight:700, textTransform:"uppercase" }}>Signal Direction</div>
              {signal.crossover && (
                <div style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                  color:"#00D4FF", fontWeight:700, animation:"flash 1s ease 3" }}>
                  ⚡ CROSSOVER
                </div>
              )}
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{
                width:52, height:52, borderRadius:12, fontSize:26,
                display:"flex", alignItems:"center", justifyContent:"center",
                background: signal.direction==="UP"  ? "#00FF8820"
                           : signal.direction==="DOWN" ? "#FF3B5C20" : "#1E2A4230",
                border:`1px solid ${dirColor}44`,
              }}>
                {signal.direction==="UP" ? "↑" : signal.direction==="DOWN" ? "↓" : "—"}
              </div>
              <div>
                <div style={{ fontSize:28, fontWeight:800, fontFamily:"'JetBrains Mono'",
                  color:dirColor, letterSpacing:-1, lineHeight:1 }}>
                  {signal.direction}
                </div>
                <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{signal.trend}</div>
              </div>
            </div>

            {/* Strength bar */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:10, color:"#334155", fontWeight:700,
                  textTransform:"uppercase", letterSpacing:1 }}>Trend Strength</span>
                <span style={{ fontSize:11, fontFamily:"'JetBrains Mono'",
                  fontWeight:700, color:dirColor }}>{signal.strength}%</span>
              </div>
              <div style={{ height:5, background:"#0D1320", borderRadius:999, overflow:"hidden" }}>
                <div style={{
                  height:"100%", borderRadius:999, transition:"width 1s ease",
                  width:`${signal.strength}%`,
                  background: signal.direction==="UP"
                    ? "linear-gradient(90deg,#00994D,#00FF88)"
                    : signal.direction==="DOWN"
                    ? "linear-gradient(90deg,#991F33,#FF3B5C)"
                    : "#334155",
                }} />
              </div>
            </div>

            {/* EMA values */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                { label:"EMA 8",  val:signal.ema8,  color:"#00D4FF" },
                { label:"EMA 21", val:signal.ema21, color:"#FF8C00" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background:"#080C18",
                  border:`1px solid ${color}33`, borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontSize:10, color, fontWeight:700, letterSpacing:0.8 }}>{label}</div>
                  <div style={{ fontSize:12, fontFamily:"'JetBrains Mono'",
                    fontWeight:600, marginTop:2, color:"#CBD5E1" }}>
                    {val.toFixed(pair.decimals)}
                  </div>
                </div>
              ))}
            </div>

            {/* Entry checklist */}
            {signal.direction !== "NEUTRAL" && (
              <div style={{ background:"#080C18", border:"1px solid #1A2540",
                borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:"#334155", fontWeight:700,
                  letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
                  Entry Checklist
                </div>
                {[
                  { text: signal.direction==="UP" ? "EMA8 above EMA21" : "EMA8 below EMA21", ok:true },
                  { text: signal.crossover ? "Fresh crossover confirmed" : "No crossover yet — wait for candle close", ok:signal.crossover },
                  { text: "Set stop-loss beyond recent swing", ok:false },
                  { text: "Confirm bias on higher timeframe", ok:false },
                ].map((item, i) => (
                  <div key={i} style={{ fontSize:11,
                    color: item.ok ? "#94A3B8" : "#475569", marginBottom:3, paddingLeft:2 }}>
                    {item.ok ? "✅" : "⚠️"} {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={{ background:"#0F1628", border:"1px solid #1A2540",
            borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontSize:10, color:"#334155", letterSpacing:1.2,
              fontWeight:700, textTransform:"uppercase", marginBottom:10 }}>
              Crossover History
            </div>
            {history.map((h, i) => (
              <div key={i} style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"7px 0",
                borderBottom: i < history.length - 1 ? "1px solid #0D1320" : "none",
                animation: i===0 ? "slideIn 0.3s ease" : "none",
              }}>
                <span style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                  color:"#334155", minWidth:72 }}>{h.time}</span>
                <span style={{ fontSize:10, color:"#475569",
                  fontFamily:"'JetBrains Mono'" }}>{h.pair}</span>
                <span style={{ fontSize:11, fontWeight:700, fontFamily:"'JetBrains Mono'",
                  color: h.dir==="UP" ? "#00FF88" : "#FF3B5C" }}>
                  {h.dir==="UP" ? "↑" : "↓"} {h.price}
                </span>
                <span style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                  color:"#334155" }}>{h.strength}%</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize:10, color:"#1E2A42", textAlign:"center",
          lineHeight:1.7, padding:"4px 8px" }}>
          ⚠️ Educational use only. Not financial advice.<br />
          Always use stop-losses and your own analysis.
        </div>
      </div>
    </div>
  );
}
