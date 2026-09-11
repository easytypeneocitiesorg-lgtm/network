export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }
  try {
    const response = await fetch(targetUrl);
    const data = await response.text();
    
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    res.status(response.status).send(data);
    
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: 'Failed to fetch the target URL' });
  }
}
