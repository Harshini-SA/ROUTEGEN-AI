// Central API base URL for the backend (FastAPI).
// Override in dev via VITE_API_URL in the repo-root .env if the backend
// ever moves off the default port.
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://localhost:8000';
