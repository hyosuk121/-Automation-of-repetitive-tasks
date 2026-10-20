// Vercel's plain Node functions use an explicit rewrite for nested API paths.
// Keep query filters while normalizing the rewrite to the shared HTTP router.
export function vercelHandler(handle) {
  return (req, res) => {
    const url = new URL(req.url, 'http://internal');
    const route = url.searchParams.get('__route');
    if (url.pathname === '/api/handler' && route !== null) {
      url.pathname = '/api/' + route;
    }
    url.searchParams.delete('__route');
    req.url = url.pathname + url.search;
    return handle(req, res);
  };
}
