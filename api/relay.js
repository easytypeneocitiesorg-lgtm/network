export default async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const response = await fetch(targetUrl);
    let data = await response.text();
    
    const contentType = response.headers.get('content-type');
    
    // Only rewrite links if the fetched content is an HTML document
    if (contentType && contentType.includes('text/html')) {
      // Regex to find all href, src, and action attributes in the HTML
      const urlRegex = /(href|src|action)=["']([^"']+)["']/gi;
      
      data = data.replace(urlRegex, (match, attr, urlVal) => {
        // Skip data URIs, javascript functions, or anchor links
        if (urlVal.startsWith('data:') || urlVal.startsWith('javascript:') || urlVal.startsWith('#')) {
          return match;
        }

        try {
          // Resolve relative URLs (like /search) against the original target URL
          const absoluteUrl = new URL(urlVal, targetUrl).href;
          
          // Rewrite the attribute to point back to the local relay
          const rewrittenUrl = `/api/relay?url=${encodeURIComponent(absoluteUrl)}`;
          return `${attr}="${rewrittenUrl}"`;
        } catch (e) {
          // If URL parsing fails, return the original unmodified attribute
          return match;
        }
      });
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    res.status(response.status).send(data);
    
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: 'Failed to fetch the target URL' });
  }
}
