// Use saved proxy URL from settings, fall back to localhost:3001 for local dev
const SERVER_BASE = localStorage.getItem('ctrl_proxy_url') || `http://${window.location.hostname}:3001`;

// Role-based page guard — runs on every dashboard page
(function() {
  const h = location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || /^192\.168\./.test(h) || /^10\./.test(h);
  if (isLocal) return; // skip guard on local dev

  let session = null;
  try { session = JSON.parse(localStorage.getItem('sb_session') || 'null'); } catch {}
  if (!session) return; // auth guard in page head handles redirect

  const allowed = session.allowed_pages;
  if (!allowed || !Array.isArray(allowed)) return; // owner from username/pw login — no restriction

  // Derive current page from URL path
  const parts = location.pathname.split('/').filter(Boolean);
  // Path is either /:slug/:page or /:page
  const page = parts.length >= 2 ? parts[1] : parts[0];
  if (!page || page === 'dashboard') return; // dashboard root always allowed

  if (!allowed.includes(page)) {
    // Redirect to first allowed page
    const slug = session.client_slug || parts[0];
    const fallback = allowed[0] || 'tasks';
    location.replace('/' + slug + '/' + fallback);
  }
})();
