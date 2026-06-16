export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const { symbol, interval } = req.query;

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=80&apikey=eca57d0ed80d4edab0c4633e057651af`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "ok" && data.values?.length) {
      return res.json({ status: "ok", values: data.values });
    }

    return res.json({ status: "error", message: data.message, code: data.code });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}
