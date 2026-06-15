export default async function handler(req, res) {
  const { symbol, interval } = req.query;
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=80&apikey=304179a7e4f24aacae4e576902f323f1`;
  const response = await fetch(url);
  const data = await response.json();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(data);
}
