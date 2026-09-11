export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  let decodedTarget;
  try {
    decodedTarget = decodeURIComponent(targetUrl);
  } catch {
    decodedTarget = targetUrl;
  }

  // Safety: don’t let it proxy itself forever
  if (decodedTarget.includes('network-nine-alpha.vercel.app')) {
    return res.status(400).json({ error: 'Refusing to proxy own domain' });
  }

  try {
    const response = await fetch(decodedTarget, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://open.spotify.com/',
        'Origin': 'https://open.spotify.com',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');
    const isTextLike = isHtml ||
      contentType.includes('javascript') ||
      contentType.includes('css') ||
      contentType.includes('json') ||
      contentType.startsWith('text/');

    // Strip headers that break framing / embedding
    const skip = new Set([
      'content-encoding', 'content-length', 'transfer-encoding',
      'content-security-policy', 'content-security-policy-report-only',
      'x-frame-options', 'frame-options', 'x-content-type-options',
      'strict-transport-security'
    ]);

    response.headers.forEach((value, key) => {
      if (!skip.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (isTextLike) {
      let body = await response.text();

      if (isHtml) {
        const proxyPrefix = 'https://network-nine-alpha.vercel.app/api/relay?url=';

        // Only rewrite absolute Spotify + CDN URLs that are NOT already proxied
        body = body.replace(
          /https?:\/\/(?:[a-z0-9-]+\.)*(?:spotify\.com|spotifycdn\.com|scdn\.co)[^"'\\\s>]*/gi,
          (match) => {
            if (match.includes('network-nine-alpha.vercel.app')) return match;
            return proxyPrefix + encodeURIComponent(match);
          }
        );

        // Also catch protocol-relative ones
        body = body.replace(
          /\/\/(?:[a-z0-9-]+\.)*(?:spotify\.com|spotifycdn\.com|scdn\.co)[^"'\\\s>]*/gi,
          (match) => {
            if (match.includes('network-nine-alpha.vercel.app')) return match;
            return proxyPrefix + encodeURIComponent('https:' + match);
          }
        );
      }

      res.status(response.status).send(body);
    } else {
      // Binary (fonts, images, etc.)
      const buf = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(buf);
    }
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed', message: err.message });
  }
}
