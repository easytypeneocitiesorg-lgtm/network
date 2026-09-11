export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const url = new URL(targetUrl);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'Referer': 'https://open.spotify.com/',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');
    const isText = contentType.startsWith('text/') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('css');

    // Forward useful headers (strip the ones that break framing/proxying)
    const headersToSkip = new Set([
      'content-encoding', 'content-length', 'transfer-encoding',
      'content-security-policy', 'content-security-policy-report-only',
      'x-frame-options', 'frame-options',
      'strict-transport-security',
    ]);
    response.headers.forEach((value, key) => {
      if (!headersToSkip.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Always allow CORS from your frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (isHtml || isText) {
      let body = await response.text();

      if (isHtml) {
        const proxyBase = `https://network-nine-alpha.vercel.app/api/relay?url=`;

        // Rewrite absolute Spotify + CDN URLs so they go through the proxy
        body = body
          .replace(/(https?:\/\/(?:open\.)?spotify\.com)/gi, (match) => proxyBase + encodeURIComponent(match))
          .replace(/(https?:\/\/[^"'\s]*spotifycdn\.com)/gi, (match) => proxyBase + encodeURIComponent(match))
          .replace(/(https?:\/\/[^"'\s]*scdn\.co)/gi, (match) => proxyBase + encodeURIComponent(match))
          .replace(/(https?:\/\/[^"'\s]*encore\.scdn\.co)/gi, (match) => proxyBase + encodeURIComponent(match))
          // also catch protocol-relative
          .replace(/(\/\/(?:open\.)?spotify\.com)/gi, (match) => proxyBase + encodeURIComponent('https:' + match))
          .replace(/(\/\/[^"'\s]*spotifycdn\.com)/gi, (match) => proxyBase + encodeURIComponent('https:' + match))
          .replace(/(\/\/[^"'\s]*scdn\.co)/gi, (match) => proxyBase + encodeURIComponent('https:' + match));

        // Optional: inject a base tag so relative paths also try the proxy
        body = body.replace(/<head[^>]*>/i, (match) => {
          return match + `\n<base href="${proxyBase}${encodeURIComponent(url.origin + '/')}">`;
        });
      }

      res.status(response.status).send(body);
    } else {
      // Binary / other: stream it
      const buffer = await response.arrayBuffer();
      res.status(response.status).send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch target', details: error.message });
  }
}
