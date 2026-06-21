import { useState, useEffect, useRef, useCallback } from "react";

const PAIRS = [
  { label: "XAU/USD", symbol: "XAU/USD", decimals: 2,  base: 3316.00, vol: 2.5,    strengthScale: 800  },
  { label: "EUR/USD", symbol: "EUR/USD", decimals: 5,  base: 1.08450, vol: 0.00035, strengthScale: 80000 },
  { label: "GBP/USD", symbol: "GBP/USD", decimals: 5,  base: 1.27230, vol: 0.00045, strengthScale: 80000 },
  { label: "USD/JPY", symbol: "USD/JPY", decimals: 3,  base: 149.520, vol: 0.055,   strengthScale: 3000  },
  { label: "CHF/JPY", symbol: "CHF/JPY", decimals: 3,  base: 168.340, vol: 0.065,   strengthScale: 3000  },
];

const TIMEFRAMES = [
  { label: "1 min",  interval: "1min",  seconds: 60  },
  { label: "5 min",  interval: "5min",  seconds: 300 },
  { label: "15 min", interval: "15min", seconds: 900 },
];

// ── Sound ─────────────────────────────────────────────────────────────────────
function playAlert(direction) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = direction === "UP" ? [523, 659, 784] : [784, 659, 523];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.45, t + 0.05);
      gain.gain.linearRampToValueAtTime(0, t + 0.16);
      osc.start(t); osc.stop(t + 0.2);
    });
  } catch {}
}

// ── EMA ───────────────────────────────────────────────────────────────────────
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

// ── ATR ───────────────────────────────────────────────────────────────────────
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── Swing levels ──────────────────────────────────────────────────────────────
function getSwingLevels(candles, lookback = 10) {
  const recent = candles.slice(-lookback);
  return {
    swingHigh: Math.max(...recent.map(c => c.high)),
    swingLow:  Math.min(...recent.map(c => c.low)),
  };
}

// ── SL/TP ─────────────────────────────────────────────────────────────────────
function calcSLTP(candles, direction, price, decimals) {
  const atr = calcATR(candles);
  if (!atr) return null;
  const { swingHigh, swingLow } = getSwingLevels(candles);
  const buffer = atr * 0.3;
  let sl, tp1, tp2, tp3;
  if (direction === "UP") {
    sl = Math.min(swingLow - buffer, price - atr * 1.5);
    const risk = price - sl;
    tp1 = price + risk * 1;
    tp2 = price + risk * 2;
    tp3 = price + risk * 3;
  } else {
    sl = Math.max(swingHigh + buffer, price + atr * 1.5);
    const risk = sl - price;
    tp1 = price - risk * 1;
    tp2 = price - risk * 2;
    tp3 = price - risk * 3;
  }
  const risk = Math.abs(price - sl);
  return {
    sl:  sl.toFixed(decimals),
    tp1: tp1.toFixed(decimals),
    tp2: tp2.toFixed(decimals),
    tp3: tp3.toFixed(decimals),
    atr: atr.toFixed(decimals),
    riskPct:  ((risk / price) * 100).toFixed(2),
    riskPips: risk.toFixed(decimals),
  };
}

// ── Trend strength scaled per pair ────────────────────────────────────────────
function calcStrength(emaDiff, price, scale) {
  // Use percentage distance between EMAs, scaled to 0-100
  const pctDiff = (Math.abs(emaDiff) / price) * 100;
  // Scale: 0.01% diff = ~20%, 0.05% = ~60%, 0.1% = ~85%, 0.2% = ~99%
  const raw = Math.log1p(pctDiff * scale) / Math.log1p(scale) * 100;
  return Math.min(99, Math.max(1, Math.round(raw)));
}

// ── Signal computation ────────────────────────────────────────────────────────
function computeSignals(closes, pair) {
  if (closes.length < 13) return null;
  const last  = closes[closes.length - 1];
  const scale = pair.strengthScale;

  // Fast: EMA 5/13
  const e5  = calcEMA(closes, 5);
  const e13 = calcEMA(closes, 13);
  const le5  = e5[e5.length-1],   pe5  = e5.length  > 1 ? e5[e5.length-2]  : le5;
  const le13 = e13[e13.length-1], pe13 = e13.length > 1 ? e13[e13.length-2]: le13;
  const fastCross = (pe5 <= pe13 && le5 > le13) || (pe5 >= pe13 && le5 < le13);
  const fastDir   = le5 > le13 ? "UP" : le5 < le13 ? "DOWN" : "NEUTRAL";
  const fastStr   = calcStrength(le5 - le13, last, scale);

  // Slow: EMA 8/21
  let slowDir = "NEUTRAL", slowCross = false, slowStr = 0;
  let e8 = [], e21 = [], le8 = 0, le21 = 0;
  if (closes.length >= 26) {
    e8  = calcEMA(closes, 8);
    e21 = calcEMA(closes, 21);
    le8  = e8[e8.length-1];
    le21 = e21[e21.length-1];
    const pe8  = e8.length  > 1 ? e8[e8.length-2]  : le8;
    const pe21 = e21.length > 1 ? e21[e21.length-2]: le21;
    slowCross = (pe8 <= pe21 && le8 > le21) || (pe8 >= pe21 && le8 < le21);
    slowDir   = le8 > le21 ? "UP" : le8 < le21 ? "DOWN" : "NEUTRAL";
    slowStr   = calcStrength(le8 - le21, last, scale);
  }

  const confirmed = fastDir === slowDir && slowDir !== "NEUTRAL";
  const direction = confirmed ? slowDir : fastDir;
  const crossover = slowCross || (fastCross && confirmed);

  // Combined strength — weighted average, boosted if both agree
  let strength;
  if (confirmed && slowStr > 0) {
    strength = Math.min(99, Math.round((fastStr * 0.4 + slowStr * 0.6) * 1.15));
  } else {
    strength = fastStr;
  }

  const trend = strength >= 70 ? "Strong Trend"
              : strength >= 45 ? "Moderate"
              : strength >= 25 ? "Developing"
              : "Weak / Ranging";

  return {
    direction, strength, trend, crossover, confirmed,
    fastDir, fastCross, fastStr,
    slowDir, slowCross, slowStr,
    ema5:  le5,  ema13: le13,
    ema8:  le8,  ema21: le21,
    allEma5: e5, allEma13: e13, allEma8: e8, allEma21: e21,
    price: last,
  };
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
      ctx.strokeStyle = bull ? "#00FF88" : "#FF3B5C"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
      ctx.fillStyle = bull ? "#00FF8840" : "#FF3B5C40";
      const y1 = toY(Math.max(c.open, c.close)), y2 = toY(Math.min(c.open, c.close));
      ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
    });

    if (sig) {
      const draw = (arr, color, width = 1.5) => {
        if (arr.length < 2) return;
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width;
        arr.forEach((v, i) => i === 0
          ? ctx.moveTo(toX(candles.length - arr.length + i), toY(v))
          : ctx.lineTo(toX(candles.length - arr.length + i), toY(v)));
        ctx.stroke();
      };
      draw(sig.allEma5.slice(-candles.length),  "#00FF8899", 1.2);
      draw(sig.allEma13.slice(-candles.length), "#FF3B5C99", 1.2);
      draw(sig.allEma8.slice(-candles.length),  "#00D4FF", 2);
      draw(sig.allEma21.slice(-candles.length), "#FF8C00", 2);
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
  const [sltp,       setSltp]       = useState(null);
  const [livePrice,  setLivePrice]  = useState(null);
  const [prevPrice,  setPrevPrice]  = useState(null);
  const [history,    setHistory]    = useState([]);
  const [pulseKey,   setPulseKey]   = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [mode,       setMode]       = useState("loading");
  const [alertOn,    setAlertOn]    = useState(true);
  const [lastAlert,  setLastAlert]  = useState(null);
  const prevSigRef  = useRef(null);
  const intervalRef = useRef(null);
  const alertOnRef  = useRef(true);
  const liveRef     = useRef(false);
  const pairRef     = useRef(pair);

  useEffect(() => { alertOnRef.current = alertOn; }, [alertOn]);
  useEffect(() => { pairRef.current = pair; }, [pair]);

  const processCandles = useCallback((built, currentPair) => {
    if (!built.length) return;
    const closes = built.map(c => c.close);
    const latest = closes[closes.length - 1];
    setLivePrice(prev => { setPrevPrice(prev); return latest; });

    const sig = computeSignals(closes, currentPair);
    if (sig && sig.direction !== "NEUTRAL") {
      setSltp(calcSLTP(built, sig.direction, latest, currentPair.decimals));
    } else {
      setSltp(null);
    }

    if (sig && prevSigRef.current) {
      if (sig.crossover && sig.direction !== prevSigRef.current.direction) {
        setPulseKey(k => k + 1);
        if (alertOnRef.current) playAlert(sig.direction);
        setLastAlert({
          dir: sig.direction, confirmed: sig.confirmed,
          time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" }),
        });
        setHistory(h => [{
          time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" }),
          dir: sig.direction, price: latest.toFixed(currentPair.decimals),
          pair: currentPair.label, strength: sig.strength, confirmed: sig.confirmed,
        }, ...h].slice(0, 10));
      }
    }
    prevSigRef.current = sig;
    setSignal(sig);
    setLastUpdate(new Date());
  }, []);

  const tryLive = useCallback(async (currentPair, currentTf) => {
    try {
      const url  = `/api/proxy?symbol=${encodeURIComponent(currentPair.symbol)}&interval=${currentTf.interval}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.status === "ok" && data.values?.length) {
        const built = [...data.values].reverse().map(v => ({
          time:  new Date(v.datetime).getTime(),
          open:  parseFloat(v.open), high: parseFloat(v.high),
          low:   parseFloat(v.low),  close: parseFloat(v.close),
        }));
        setCandles(built);
        processCandles(built, currentPair);
        if (!liveRef.current) { liveRef.current = true; setMode("live"); }
        return true;
      }
    } catch {}
    return false;
  }, [processCandles]);

  useEffect(() => {
    clearInterval(intervalRef.current);
    setCandles([]); setSignal(null); setSltp(null);
    setLivePrice(null); setLastAlert(null);
    prevSigRef.current = null; liveRef.current = false; setMode("loading");

    tryLive(pair, tf).then(ok => {
      if (ok) {
        intervalRef.current = setInterval(() => tryLive(pairRef.current, tf), 10_000);
      } else {
        setMode("error");
      }
    });
    return () => clearInterval(intervalRef.current);
  }, [pair, tf]);

  const dirColor = signal?.direction === "UP"  ? "#00FF88"
                 : signal?.direction === "DOWN" ? "#FF3B5C" : "#94A3B8";

  // Strength color
  const strColor = !signal ? "#94A3B8"
                 : signal.strength >= 70 ? "#00FF88"
                 : signal.strength >= 45 ? "#F59E0B"
                 : "#FF3B5C";

  return (
    <div style={{ background:"#080C18", minHeight:"100vh", color:"#E2E8F0",
      fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:40 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes ripple{0%{box-shadow:0 0 0 0 rgba(0,255,136,0.4)}100%{box-shadow:0 0 0 20px rgba(0,255,136,0)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes flash{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes alertPop{0%{transform:scale(0.9);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        button{border:none;outline:none;}
        button:active{opacity:0.7;}
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
            <div style={{ fontSize:10, color:"#334155" }}>EMA 5/13 · 8/21 · SL/TP</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => setAlertOn(a => !a)} style={{
            background: alertOn ? "#00FF8820" : "#1A2540",
            border:`1px solid ${alertOn ? "#00FF88" : "#334155"}`,
            borderRadius:8, padding:"6px 10px", cursor:"pointer",
            display:"flex", alignItems:"center", gap:5,
          }}>
            <span style={{ fontSize:14 }}>{alertOn ? "🔔" : "🔕"}</span>
            <span style={{ fontSize:10, fontFamily:"'JetBrains Mono'", fontWeight:700,
              color: alertOn ? "#00FF88" : "#475569" }}>{alertOn ? "ON" : "OFF"}</span>
          </button>
          <div style={{ textAlign:"right" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
              {mode === "loading"
                ? <div style={{ width:10, height:10, border:"2px solid #F59E0B",
                    borderTopColor:"transparent", borderRadius:"50%",
                    animation:"spin 0.8s linear infinite" }} />
                : <div style={{ width:7, height:7, borderRadius:"50%",
                    background: mode==="live" ? "#00FF88" : "#FF3B5C",
                    animation:"blink 2s infinite" }} />
              }
              <span style={{ fontSize:11, fontFamily:"'JetBrains Mono'", fontWeight:700,
                color: mode==="live" ? "#00FF88" : mode==="loading" ? "#F59E0B" : "#FF3B5C" }}>
                {mode==="live" ? "LIVE" : mode==="loading" ? "CONNECTING" : "ERROR"}
              </span>
            </div>
            {lastUpdate && (
              <div style={{ fontSize:9, color:"#334155", fontFamily:"'JetBrains Mono'", marginTop:2 }}>
                {lastUpdate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding:"14px 14px 0", maxWidth:480, margin:"0 auto" }}>

        {/* Alert Banner */}
        {lastAlert && (
          <div style={{
            background: lastAlert.dir==="UP" ? "#00FF8815" : "#FF3B5C15",
            border:`2px solid ${lastAlert.dir==="UP" ? "#00FF88" : "#FF3B5C"}`,
            borderRadius:12, padding:"12px 16px", marginBottom:10,
            display:"flex", alignItems:"center", gap:12, animation:"alertPop 0.4s ease",
          }}>
            <div style={{ fontSize:28 }}>{lastAlert.dir==="UP" ? "🟢" : "🔴"}</div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, fontFamily:"'JetBrains Mono'",
                color: lastAlert.dir==="UP" ? "#00FF88" : "#FF3B5C" }}>
                ⚡ {lastAlert.dir==="UP" ? "BUY SIGNAL" : "SELL SIGNAL"}
                {lastAlert.confirmed &&
                  <span style={{ fontSize:11, marginLeft:8, color:"#00D4FF" }}>CONFIRMED</span>}
              </div>
              <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>
                EMA Crossover · {lastAlert.time} · {pair.label}
              </div>
            </div>
            <button onClick={() => setLastAlert(null)} style={{
              marginLeft:"auto", background:"transparent",
              color:"#334155", fontSize:18, cursor:"pointer", padding:"4px 8px" }}>✕</button>
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
                {pair.label} · Live Price
              </div>
              <div style={{
                fontSize:30, fontWeight:800, fontFamily:"'JetBrains Mono'", letterSpacing:-1,
                color: livePrice && prevPrice
                  ? (livePrice > prevPrice ? "#00FF88" : livePrice < prevPrice ? "#FF3B5C" : "#E2E8F0")
                  : "#E2E8F0",
                transition:"color 0.3s",
              }}>
                {livePrice ? livePrice.toFixed(pair.decimals)
                           : <span style={{ color:"#1E2A42", fontSize:18 }}>Connecting...</span>}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10, color:"#334155" }}>CANDLES</div>
              <div style={{ fontSize:13, fontFamily:"'JetBrains Mono'", color:"#475569" }}>
                {candles.length}
              </div>
              <div style={{ fontSize:8, color:"#1E2A42", marginTop:4, lineHeight:1.8 }}>
                <span style={{ color:"#00FF88" }}>━</span> EMA5&nbsp;
                <span style={{ color:"#FF3B5C" }}>━</span> EMA13<br/>
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
              <div style={{ display:"flex", gap:6 }}>
                {signal.crossover && (
                  <div style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                    color:"#00D4FF", fontWeight:700, animation:"flash 1s ease 3" }}>
                    ⚡ CROSSOVER
                  </div>
                )}
                {signal.confirmed && (
                  <div style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                    color:"#00FF88", fontWeight:700 }}>✓ CONFIRMED</div>
                )}
              </div>
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
                  color:dirColor, letterSpacing:-1, lineHeight:1 }}>{signal.direction}</div>
                <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{signal.trend}</div>
              </div>
            </div>

            {/* Strength bar */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:10, color:"#334155", fontWeight:700,
                  textTransform:"uppercase", letterSpacing:1 }}>Trend Strength</span>
                <span style={{ fontSize:11, fontFamily:"'JetBrains Mono'",
                  fontWeight:700, color:strColor }}>{signal.strength}%</span>
              </div>
              <div style={{ height:6, background:"#0D1320", borderRadius:999, overflow:"hidden" }}>
                <div style={{
                  height:"100%", borderRadius:999, transition:"width 1s ease",
                  width:`${signal.strength}%`,
                  background: signal.strength >= 70
                    ? "linear-gradient(90deg,#00994D,#00FF88)"
                    : signal.strength >= 45
                    ? "linear-gradient(90deg,#B45309,#F59E0B)"
                    : "linear-gradient(90deg,#991F33,#FF3B5C)",
                }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                fontSize:8, color:"#334155", marginTop:3 }}>
                <span>Weak</span><span>Developing</span><span>Moderate</span><span>Strong</span>
              </div>
            </div>

            {/* EMA values */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:12 }}>
              {[
                { label:"EMA 5",  val:signal.ema5,  color:"#00FF88" },
                { label:"EMA 13", val:signal.ema13, color:"#FF3B5C" },
                { label:"EMA 8",  val:signal.ema8,  color:"#00D4FF" },
                { label:"EMA 21", val:signal.ema21, color:"#FF8C00" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background:"#080C18",
                  border:`1px solid ${color}33`, borderRadius:8, padding:"6px 8px" }}>
                  <div style={{ fontSize:9, color, fontWeight:700 }}>{label}</div>
                  <div style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                    fontWeight:600, marginTop:2, color:"#CBD5E1" }}>
                    {val ? val.toFixed(pair.decimals) : "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* SL/TP */}
            {sltp && signal.direction !== "NEUTRAL" && (
              <div style={{ background:"#080C18", border:"1px solid #1A2540",
                borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#334155", fontWeight:700,
                  letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
                  SL / TP Levels
                  <span style={{ fontSize:9, color:"#475569", marginLeft:6, fontWeight:400 }}>
                    ATR: {sltp.atr} · Risk: {sltp.riskPct}%
                  </span>
                </div>
                <div style={{ background:"#FF3B5C12", border:"1px solid #FF3B5C33",
                  borderRadius:8, padding:"8px 10px", marginBottom:6,
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:9, color:"#FF3B5C", fontWeight:700 }}>🛑 STOP LOSS</div>
                    <div style={{ fontSize:8, color:"#475569", marginTop:1 }}>
                      {signal.direction==="UP" ? "Below recent swing low" : "Above recent swing high"}
                    </div>
                  </div>
                  <div style={{ fontSize:16, fontWeight:800,
                    fontFamily:"'JetBrains Mono'", color:"#FF3B5C" }}>{sltp.sl}</div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                  {[
                    { label:"TP 1", val:sltp.tp1, rr:"1:1", color:"#F59E0B" },
                    { label:"TP 2", val:sltp.tp2, rr:"1:2", color:"#00D4FF" },
                    { label:"TP 3", val:sltp.tp3, rr:"1:3", color:"#00FF88" },
                  ].map(({ label, val, rr, color }) => (
                    <div key={label} style={{ background:`${color}12`,
                      border:`1px solid ${color}44`, borderRadius:8,
                      padding:"8px 6px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color, fontWeight:700 }}>{label}</div>
                      <div style={{ fontSize:10, fontFamily:"'JetBrains Mono'",
                        fontWeight:700, color:"#E2E8F0", marginTop:2 }}>{val}</div>
                      <div style={{ fontSize:8, color:"#475569", marginTop:1 }}>{rr}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entry checklist */}
            {signal.direction !== "NEUTRAL" && (
              <div style={{ background:"#080C18", border:"1px solid #1A2540",
                borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:"#334155", fontWeight:700,
                  letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Entry Checklist</div>
                {[
                  { text:`Fast EMA (5/13): ${signal.fastDir}`, ok: signal.fastDir !== "NEUTRAL" },
                  { text:`Slow EMA (8/21): ${signal.slowDir || "calculating..."}`, ok: signal.slowDir !== "NEUTRAL" && signal.slowDir === signal.fastDir },
                  { text: signal.confirmed ? "Both EMAs agree — strong entry ✓" : "Wait for both EMAs to align", ok: signal.confirmed },
                  { text:"Enter at open of next candle after signal", ok: false },
                  { text:"Move SL to entry after TP1 is hit", ok: false },
                ].map((item, i) => (
                  <div key={i} style={{ fontSize:11,
                    color: item.ok ? "#94A3B8" : "#475569",
                    marginBottom:3, paddingLeft:2 }}>
                    {item.ok ? "✅" : "⚠️"} {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Crossover History */}
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
                <span style={{ fontSize:9, fontFamily:"'JetBrains Mono'",
                  color: h.confirmed ? "#00D4FF" : "#334155" }}>
                  {h.confirmed ? "✓" : "~"}{h.strength}%
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize:10, color:"#1E2A42", textAlign:"center",
          lineHeight:1.7, padding:"4px 8px" }}>
          ⚠️ Educational use only. SL/TP are calculated suggestions, not guarantees.<br/>
          Always apply your own risk management before entering any trade.
        </div>
      </div>
    </div>
  );
}
