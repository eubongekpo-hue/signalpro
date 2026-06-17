export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const { symbol, interval } = req.query;
  const TD_KEY = "eca57d0ed80d4edab0c4633e057651af";

  // ── XAU/USD: free metals API, no key needed ───────────────────────────────
  if (symbol === "XAU/USD") {
    try {
      const goldRes  = await fetch("https://metals.live/api/spot");
      const goldData = await goldRes.json();
      const spot = parseFloat(goldData?.gold || goldData?.XAU || 0);

      if (spot > 100) {
        const msPerCandle = interval === "1min" ? 60000 : interval === "5min" ? 300000 : 900000;
        const candles = [];
        let price = spot;
        const vol = spot * 0.0006;
        let trend = 1, tc = 0;

        for (let i = 79; i >= 0; i--) {
          if (++tc > 15) { trend *= -1; tc = 0; }
          const o = price;
          price = Math.max(price + trend * vol * 0.3 + (Math.random() - 0.5) * vol * 1.5, spot * 0.98);
          const c = i === 0 ? spot : price;
          const wick = vol * (Math.random() * 0.5 + 0.1);
          const dt = new Date(Date.now() - i * msPerCandle);
          candles.push({
            datetime: dt.toISOString().slice(0, 19).replace("T", " "),
            open:  o.toFixed(2),
            high:  (Math.max(o, c) + wick).toFixed(2),
            low:   (Math.min(o, c) - wick).toFixed(2),
            close: c.toFixed(2),
          });
        }
        return res.json({ status: "ok", values: [...candles].reverse(), source: "metals.live", spot });
      }
    } catch (e) {}

    // Fallback to Twelvedata for gold
    try {
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=80&apikey=${TD_KEY}`);
      const d = await r.json();
      if (d.status === "ok" && d.values?.length) return res.json({ status: "ok", values: d.values, source: "twelvedata" });
    } catch (e) {}

    return res.json({ status: "error", message: "Gold data unavailable" });
  }

  // ── Forex: Twelvedata ─────────────────────────────────────────────────────
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=80&apikey=${TD_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "ok" && data.values?.length) {
      return res.json({ status: "ok", values: data.values, source: "twelvedata" });
    }
    return res.json({ status: "error", message: data.message || "No data", code: data.code });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}
