// Use saved proxy URL from settings, fall back to localhost:3001 for local dev
const SERVER_BASE = localStorage.getItem('ctrl_proxy_url') || `http://${window.location.hostname}:3001`;
