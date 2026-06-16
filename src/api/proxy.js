export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const { symbol, interval } = req.query;

  try {
    // Use Twelvedata with the user's API key
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=80&apikey=304179a7e4f24aacae4e576902f323f1&format=JSON`;
    const response = await fetch(url, {
      headers: { "User-Agent": "SignalPro/1.0" }
    });
    const data = await response.json();

    if (data.status === "ok" && data.values?.length) {
      return res.json({ status: "ok", values: data.values, source: "twelvedata" });
    }

    // Fallback: try alternative free source (exchangerate-api for forex)
    return res.json({ status: "error", message: data.message || "No data", code: data.code });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}
