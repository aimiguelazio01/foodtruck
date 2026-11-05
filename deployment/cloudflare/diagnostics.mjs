// Structured diagnostics for `wrangler tail --format json`. One JSON line per event.
// Never log bodies, emails, cookies, tokens, passwords, query strings or full URLs.

// Fixed path segments of the API; anything else (ids, slugs, file names) becomes ":param".
const staticSegments = new Set(['api', 'v1', 'app-settings', 'auth', 'branding', 'businesses', 'company', 'complete',
  'customer', 'customer-app', 'events', 'forgot-password', 'history', 'images', 'installation', 'inventory', 'login',
  'logout', 'manage', 'me', 'media', 'movements', 'network', 'orders', 'organizations', 'payment', 'permissions',
  'platform-backup', 'products', 'public', 'register', 'resend-verification', 'reset-password', 'restore', 'settings',
  'status', 'stock', 'tasks', 'uploads', 'users', 'verify']);

export function routePattern(pathname) {
  return pathname.split('/').map(segment => (segment === '' || staticSegments.has(segment) ? segment : ':param')).join('/');
}

export function routeOf(request) {
  let pathname = '';
  try { pathname = new URL(request.url).pathname; } catch { /* keep empty */ }
  return `${request.method} ${routePattern(pathname)}`;
}

// Error messages may echo inputs (a URL, an address, a token): strip those and cap the length.
export function cleanMessage(value) {
  return String(value ?? '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, '<email>')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '<credential>')
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, '<redacted>')
    .slice(0, 200);
}

export const newRequestId = () => crypto.randomUUID().slice(0, 8);

export function logEvent(fields) {
  console.error(JSON.stringify({ source: 'foodtruck-api', ...fields }));
}

export function logFailure({ request, stage, error, requestId, status }) {
  logEvent({
    event: 'api-error',
    route: request ? routeOf(request) : undefined,
    stage,
    status,
    error: error?.name ?? (error === undefined ? undefined : 'Error'),
    message: error === undefined ? undefined : cleanMessage(error?.message ?? error),
    requestId,
    ray: request?.headers?.get('cf-ray') ?? undefined,
  });
}
