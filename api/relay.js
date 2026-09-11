export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
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

  if (decodedTarget.includes('network-nine-alpha.vercel.app')) {
    return res.status(400).json({ error: 'Refusing to proxy own domain' });
  }

  try {
    const response = await fetch(decodedTarget, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': req.headers['accept'] || '*/*',
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

    const skip = new Set([
      'content-encoding', 'content-length', 'transfer-encoding',
      'content-security-policy', 'content-security-policy-report-only',
      'x-frame-options', 'frame-options',
      'strict-transport-security'
    ]);

    response.headers.forEach((value, key) => {
      if (!skip.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (isTextLike) {
      let body = await response.text();

      if (isHtml) {
        const proxyPrefix = 'https://network-nine-alpha.vercel.app/api/relay?url=';

        // Rewrite absolute Spotify / CDN URLs
        body = body.replace(
          /https?:\/\/(?:[a-z0-9-]+\.)*(?:spotify\.com|spotifycdn\.com|scdn\.co)[^"'\\\s>]*/gi,
          (match) => {
            if (match.includes('network-nine-alpha.vercel.app')) return match;
            return proxyPrefix + encodeURIComponent(match);
          }
        );

        body = body.replace(
          /\/\/(?:[a-z0-9-]+\.)*(?:spotify\.com|spotifycdn\.com|scdn\.co)[^"'\\\s>]*/gi,
          (match) => {
            if (match.includes('network-nine-alpha.vercel.app')) return match;
            return proxyPrefix + encodeURIComponent('https:' + match);
          }
        );

        // Inject interceptor that rewrites relative /api/* calls at runtime
        const interceptor = `
<script>
(function() {
  const PROXY = 'https://network-nine-alpha.vercel.app/api/relay?url=';
  const ORIGIN = 'https://open.spotify.com';

  function shouldProxy(url) {
    if (!url) return false;
    if (url.startsWith('http') && !url.includes('spotify') && !url.includes('scdn.co')) return false;
    if (url.startsWith('/api/') || url.startsWith('/v1/') || url.includes('/token') || url.includes('spclient') || url.includes('apresolve')) return true;
    return false;
  }

  function rewrite(url) {
    if (url.startsWith('/')) {
      return PROXY + encodeURIComponent(ORIGIN + url);
    }
    if (url.startsWith('http') && (url.includes('spotify.com') || url.includes('scdn.co'))) {
      return PROXY + encodeURIComponent(url);
    }
    return url;
  }

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input && input.url);
    if (shouldProxy(url)) {
      const newUrl = rewrite(url);
      if (typeof input === 'string') {
        return originalFetch(newUrl, init);
      } else {
        return originalFetch(new Request(newUrl, input), init);
      }
    }
    return originalFetch(input, init);
  };

  // Patch XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (shouldProxy(url)) {
      url = rewrite(url);
    }
    return originalOpen.call(this, method, url, ...rest);
  };
})();
</script>
`;

        // Inject as early as possible
        body = body.replace(/<head[^>]*>/i, (match) => match + interceptor);
      }

      res.status(response.status).send(body);
    } else {
      const buf = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(buf);
    }
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed', message: err.message });
  }
}
