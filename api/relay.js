export default async function handler(req, res) {
  let targetUrl = req.query.url;
  /*
   * ============================================================
   * SPOTIFY PATH HANDLING
   * ============================================================
   *
   * Normal proxy requests still work exactly like before:
   *
   * /api/relay?url=https://example.com
   *
   * Spotify can also make requests such as:
   *
   * /api/relay/search
   * /api/relay/collection/tracks
   *
   * Those are converted back into Spotify URLs.
   */

  const requestPath = req.url.split('?')[0];

  if (!targetUrl && requestPath.startsWith('/api/relay/')) {
    const spotifyPath = requestPath.substring('/api/relay'.length);

    targetUrl = `https://open.spotify.com${spotifyPath}`;

    // Preserve query parameters for Spotify.
    const queryIndex = req.url.indexOf('?');

    if (queryIndex !== -1) {
      const queryString = req.url.substring(queryIndex + 1);

      if (queryString) {
        targetUrl += `?${queryString}`;
      }
    }
  }

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
    const response = await fetch(parsedUrl.toString());

    let data = await response.text();

    const contentType = response.headers.get('content-type') || '';

    /*
     * ============================================================
     * SPOTIFY-ONLY HTML REWRITING
     * ============================================================
     *
     * Nothing below this point modifies non-Spotify websites.
     */

    const isSpotify =
      parsedUrl.hostname === 'open.spotify.com' ||
      parsedUrl.hostname === 'spotify.com' ||
      parsedUrl.hostname.endsWith('.spotify.com');

    if (isSpotify && contentType.includes('text/html')) {

      /*
       * Convert Spotify root-relative links:
       *
       *     /search
       *
       * into:
       *
       *     /api/relay/search
       *
       * This keeps navigation inside your proxy.
       */

      data = data.replace(
        /(\b(?:href|src|action|poster|data-src)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi,
        function (match, prefix, quote, path) {

          if (path.startsWith('/api/relay')) {
            return match;
          }

          return (
            prefix +
            quote +
            '/api/relay' +
            path +
            quote
          );
        }
      );

      /*
       * Handle forms separately as well.
       */

      data = data.replace(
        /(<form[^>]*\baction\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi,
        function (match, prefix, quote, path) {

          if (path.startsWith('/api/relay')) {
            return match;
          }

          return (
            prefix +
            quote +
            '/api/relay' +
            path +
            quote
          );
        }
      );
    }

    /*
     * Keep the original proxy's response behavior.
     */

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    return res.status(response.status).send(data);

  } catch (error) {
    console.error('Fetch error:', error);

    return res.status(500).json({
      error: 'Failed to fetch the target URL'
    });
  }
}
