export default async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing "url" query parameter'
    });
  }

  try {
    const parsedUrl = new URL(targetUrl);

    const response = await fetch(parsedUrl.toString());
    let data = await response.text();

    const contentType = response.headers.get('content-type') || '';

    /*
     * ============================================================
     * SPOTIFY ONLY
     * ============================================================
     *
     * Nothing is modified for other websites.
     */

    const isSpotify =
      parsedUrl.hostname === 'open.spotify.com' ||
      parsedUrl.hostname === 'spotify.com' ||
      parsedUrl.hostname.endsWith('.spotify.com');

    if (isSpotify && contentType.includes('text/html')) {

      const proxyBase =
        'https://network-nine-alpha.vercel.app/api/relay?url=';

      /*
       * Convert Spotify relative URLs into FULL proxy URLs.
       *
       * Example:
       *
       * /search
       *
       * becomes:
       *
       * https://network-nine-alpha.vercel.app/api/relay?url=https%3A%2F%2Fopen.spotify.com%2Fsearch
       */

      function proxySpotifyUrl(value) {
        try {
          const absoluteUrl = new URL(value, parsedUrl.toString());

          const hostname = absoluteUrl.hostname;

          const spotify =
            hostname === 'open.spotify.com' ||
            hostname === 'spotify.com' ||
            hostname.endsWith('.spotify.com');

          if (!spotify) {
            return value;
          }

          return proxyBase + encodeURIComponent(
            absoluteUrl.toString()
          );

        } catch {
          return value;
        }
      }

      /*
       * Rewrite href, src, action, poster and data-src.
       */
      data = data.replace(
        /(\b(?:href|src|action|poster|data-src)\s*=\s*)(["'])([^"']+)\2/gi,
        function (match, prefix, quote, value) {

          /*
           * Only rewrite relative Spotify URLs.
           *
           * Leave these alone:
           *   https://...
           *   http://...
           *   javascript:...
           *   data:...
           *   #
           */

          if (
            value.startsWith('/') &&
            !value.startsWith('//')
          ) {
            return (
              prefix +
              quote +
              proxySpotifyUrl(value) +
              quote
            );
          }

          /*
           * Handle //open.spotify.com/... URLs.
           */
          if (value.startsWith('//')) {
            return (
              prefix +
              quote +
              proxySpotifyUrl('https:' + value) +
              quote
            );
          }

          return match;
        }
      );

      /*
       * Rewrite CSS url(...) references that point to
       * Spotify-relative resources.
       */
      data = data.replace(
        /url\(\s*(["']?)(\/(?!\/)[^"')]+)\1\s*\)/gi,
        function (match, quote, value) {
          return `url(${quote}${proxySpotifyUrl(value)}${quote})`;
        }
      );
    }

    /*
     * Keep your original response behavior.
     */

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    return res.status(response.status).send(data);

  } catch (error) {
    console.error("Fetch error:", error);

    return res.status(500).json({
      error: 'Failed to fetch the target URL'
    });
  }
}
