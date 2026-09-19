(() => {
  const config = window.MISE_CONFIG || {};
  const apiBase = String(config.registrationApiUrl || '').replace(/\/$/, '');

  function configured() { return Boolean(apiBase); }
  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '등록 서비스에 연결하지 못했습니다.');
    return payload;
  }
  async function getSession() { return configured() ? (await request('/api/session')).session || null : null; }
  async function requestMagicLink(email) { return request('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) }); }
  async function submitPlace(payload) { return request('/api/place-submissions', { method: 'POST', body: JSON.stringify(payload) }); }
  async function signOut() { if (configured()) await request('/api/auth/sign-out', { method: 'POST' }); }
  async function searchKto(latitude, longitude) { return configured() ? (await request(`/api/kto-nearby?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`)).places || [] : []; }
  window.MiseNeon = { configured, getSession, requestMagicLink, submitPlace, searchKto, signOut };
})();
