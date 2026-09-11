javascript
export default async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing "url" query parameter'
    });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({
      error: 'Invalid target URL'
    });
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': req.headers['accept'] || '*/*'
      }
    });

    let data = await response.text();
    const contentType = response.headers.get('content-type') || '';

    /*
     * Only modify Spotify pages.
     * Every other website passes through normally.
     */
    const isSpotify =
      parsedUrl.hostname === 'spotify.com' ||
      parsedUrl.hostname.endsWith('.spotify.com');

    if (isSpotify && contentType.includes('text/html')) {
      const proxyPath = '/api/relay';

      /*
       * Convert a Spotify URL into a URL handled by this relay.
       */
      const makeProxyUrl = (url) => {
        try {
          const absoluteUrl = new URL(url, parsedUrl.toString());

          const spotify =
            absoluteUrl.hostname === 'spotify.com' ||
            absoluteUrl.hostname.endsWith('.spotify.com');

          // Don't proxy non-Spotify URLs.
          if (!spotify) {
            return url;
          }

          return `${proxyPath}?url=${encodeURIComponent(
            absoluteUrl.toString()
          )}`;
        } catch {
          return url;
        }
      };

      /*
       * Rewrite Spotify HTML attributes such as:
       *
       * href="/search"
       * src="/something"
       * action="/search"
       *
       * into URLs pointing back through /api/relay.
       */
      data = data.replace(
        /(\b(?:href|src|action|poster|data-src)\s*=\s*)(["'])([^"']+)\2/gi,
        (match, prefix, quote, value) => {
          /*
           * Only rewrite root-relative URLs.
           *
           * Example:
           * /search
           *
           * Do not touch:
           * https://example.com
           * //example.com
           * #something
           * javascript:...
           */
          if (
            value.startsWith('/') &&
            !value.startsWith('//') &&
            !value.startsWith('/api/relay')
          ) {
            return `${prefix}${quote}${makeProxyUrl(value)}${quote}`;
          }

          return match;
        }
      );

      /*
       * Handle protocol-relative URLs:
       *
       * //open.spotify.com/...
       */
      data = data.replace(
        /(\b(?:href|src|action|poster|data-src)\s*=\s*)(["'])(\/\/[^"']+)\2/gi,
        (match, prefix, quote, value) => {
          const absoluteUrl = `https:${value}`;

          try {
            const url = new URL(absoluteUrl);

            const spotify =
              url.hostname === 'spotify.com' ||
              url.hostname.endsWith('.spotify.com');

            if (!spotify) {
              return match;
            }

            return `${prefix}${quote}${makeProxyUrl(
              absoluteUrl
            )}${quote}`;
          } catch {
            return match;
          }
        }
      );

      /*
       * Handle HTML forms separately.
       *
       * Example:
       * <form action="/search">
       */
      data = data.replace(
        /(<form[^>]*\baction\s*=\s*)(["'])([^"']+)\2/gi,
        (match, prefix, quote, value) => {
          if (
            value.startsWith('/') &&
            !value.startsWith('//') &&
            !value.startsWith('/api/relay')
          ) {
            return `${prefix}${quote}${makeProxyUrl(value)}${quote}`;
          }

          return match;
        }
      );
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.setHeader('Cache-Control', 'no-store');

    return res.status(response.status).send(data);

  } catch (error) {
    console.error('Fetch error:', error);

    return res.status(500).json({
      error: 'Failed to fetch the target URL',
      details: error.message
    });
  }
}
