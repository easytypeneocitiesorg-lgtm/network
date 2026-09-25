export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    // Build headers that streaming CDNs actually accept
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      // Critical for most stream hosts
      Referer: new URL(targetUrl).origin + '/',
      Origin: new URL(targetUrl).origin,
    };

    // Forward Range header so seeking works
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await fetch(targetUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
    });

    const finalUrl = response.url;
    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    const proxyBase = `https://${req.headers.host}/api/relay?url=`;

    const rewriteUrl = (urlStr) => {
      if (
        !urlStr ||
        urlStr.startsWith('data:') ||
        urlStr.startsWith('javascript:') ||
        urlStr.startsWith('#') ||
        urlStr.startsWith('blob:') ||
        urlStr.startsWith(proxyBase)
      ) {
        return urlStr;
      }
      try {
        const absolute = new URL(urlStr, finalUrl).href;
        return proxyBase + encodeURIComponent(absolute);
      } catch {
        return urlStr;
      }
    };

    // Mirror important response headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=30');

    // Pass through Range responses so video seeking works
    if (response.headers.get('content-range')) {
      res.setHeader('Content-Range', response.headers.get('content-range'));
      res.status(206);
    } else {
      res.status(response.status);
    }
    if (response.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', response.headers.get('accept-ranges'));
    }
    if (response.headers.get('content-length')) {
      res.setHeader('Content-Length', response.headers.get('content-length'));
    }

    // ---------- 1. HTML ----------
    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Kill integrity / crossorigin that break our injected scripts
      html = html.replace(/\s+(integrity|crossorigin)\s*=\s*(["']).*?\2/gi, '');

      // Rewrite static attributes
      html = html.replace(
        /\b(src|href|action|data-src|data-url|poster)\s*=\s*(["'])(.*?)\2/gi,
        (m, attr, quote, val) => `${attr}=${quote}${rewriteUrl(val)}${quote}`
      );

      // Aggressive interceptor that also catches HLS, MediaSource, createObjectURL, etc.
      const interceptorScript = `
<script>
(function () {
  const proxyBase = '${proxyBase}';
  const targetBase = '${finalUrl}';

  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (
      url.startsWith('data:') ||
      url.startsWith('javascript:') ||
      url.startsWith('#') ||
      url.startsWith('blob:') ||
      url.startsWith(proxyBase) ||
      url.startsWith('chrome-extension:')
    ) return url;
    try {
      return proxyBase + encodeURIComponent(new URL(url, targetBase).href);
    } catch (e) {
      return url;
    }
  }

  // ---- fetch ----
  const _fetch = window.fetch;
  window.fetch = function (input, init = {}) {
    const method = ((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // Only proxy safe methods; leave uploads alone
    if (method === 'GET' || method === 'HEAD') {
      if (typeof input === 'string') {
        input = toProxy(input);
      } else if (input instanceof Request) {
        input = new Request(toProxy(input.url), {
          method: input.method,
          headers: input.headers,
          mode: input.mode,
          credentials: input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          integrity: input.integrity,
        });
      }
    }
    return _fetch.call(this, input, init);
  };

  // ---- XHR ----
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (String(method).toUpperCase() === 'GET' || String(method).toUpperCase() === 'HEAD') {
      url = toProxy(url);
    }
    return _open.call(this, method, url, ...rest);
  };

  // ---- setAttribute ----
  const _setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = name.toLowerCase();
    if (
      ['src', 'href', 'action', 'data-src', 'data-url', 'poster'].includes(n) &&
      typeof value === 'string' &&
      !this.hasAttribute('data-no-proxy')
    ) {
      value = toProxy(value);
    }
    return _setAttribute.call(this, name, value);
  };

  // ---- property setters (img, script, video, audio, source, track, iframe, link) ----
  const elements = [
    HTMLImageElement, HTMLScriptElement, HTMLVideoElement,
    HTMLAudioElement, HTMLSourceElement, HTMLTrackElement,
    HTMLIFrameElement, HTMLLinkElement
  ];
  ['src', 'href', 'poster'].forEach(attr => {
    elements.forEach(proto => {
      if (!proto) return;
      const desc = Object.getOwnPropertyDescriptor(proto.prototype, attr);
      if (desc && desc.set) {
        const originalSet = desc.set;
        Object.defineProperty(proto.prototype, attr, {
          set(val) {
            if (this.hasAttribute && this.hasAttribute('data-no-proxy')) {
              originalSet.call(this, val);
            } else {
              originalSet.call(this, toProxy(val));
            }
          },
          get: desc.get,
          configurable: true
        });
      }
    });
  });

  // ---- Workers ----
  if (window.Worker) {
    const _Worker = window.Worker;
    window.Worker = function (url, opts) {
      return new _Worker(toProxy(url), opts);
    };
    window.Worker.prototype = _Worker.prototype;
  }

  // ---- URL.createObjectURL (some players generate blob: then replace) ----
  // We leave it alone; the subsequent network requests will still be intercepted.

  // ---- Navigation stay-inside ----
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a');
    if (a && a.hasAttribute('href') && !a.hasAttribute('data-no-proxy')) {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        e.preventDefault();
        location.href = toProxy(href);
      }
    }
  }, true);

  // Extra: rewrite any already-present <source> or <video> src after DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('video, audio, source, track').forEach(el => {
      if (el.src) el.src = toProxy(el.src);
      if (el.getAttribute('src')) el.setAttribute('src', toProxy(el.getAttribute('src')));
    });
  });
})();
</script>`;

      html = html.includes('<head>')
        ? html.replace('<head>', `<head>\n${interceptorScript}`)
        : interceptorScript + '\n' + html;

      return res.send(html);
    }

    // ---------- 2. CSS ----------
    if (contentType.includes('text/css')) {
      let css = await response.text();
      css = css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (m, q, val) => {
        if (val.startsWith('data:')) return m;
        return `url(${q}${rewriteUrl(val)}${q})`;
      });
      return res.send(css);
    }

    // ---------- 3. HLS / DASH manifests ----------
    // .m3u8 and .mpd are text; we must rewrite every URI inside them
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL') ||
      contentType.includes('application/dash+xml') ||
      targetUrl.includes('.m3u8') ||
      targetUrl.includes('.mpd')
    ) {
      let text = await response.text();

      // Rewrite every absolute or relative URL that appears in the playlist
      text = text.replace(
        /(URI=["']?)([^"'\s>]+)/gi,
        (m, prefix, uri) => `${prefix}${rewriteUrl(uri)}`
      );
      // Also catch bare lines that are URLs (common in m3u8)
      text = text
        .split('\n')
        .map(line => {
          const trimmed = line.trim();
          if (
            trimmed &&
            !trimmed.startsWith('#') &&
            (trimmed.startsWith('http') || trimmed.includes('.ts') || trimmed.includes('.m4s') || trimmed.includes('.mp4'))
          ) {
            return rewriteUrl(trimmed);
          }
          return line;
        })
        .join('\n');

      res.setHeader('Content-Type', contentType);
      return res.send(text);
    }

    // ---------- 4. Everything else (video segments, JS, images, etc.) ----------
    const buf = Buffer.from(await response.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error('relay error:', err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Failed to fetch target', detail: String(err) });
  }
}
