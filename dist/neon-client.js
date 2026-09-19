(() => {
  const config = window.MISE_CONFIG || {};
  const apiBase = String(config.registrationApiUrl || '').replace(/\/$/, '');
  const authUrl = String(config.neonAuthUrl || '').replace(/\/$/, '');
  let authClientPromise;

  function configured() { return Boolean(apiBase && authUrl); }
  async function authClient() {
    if (!configured()) throw new Error('개인 등록 서비스를 아직 연결하지 않았습니다.');
    if (!authClientPromise) authClientPromise = import('https://esm.sh/@neondatabase/auth@latest').then(({ createAuthClient }) => createAuthClient(authUrl));
    return authClientPromise;
  }
  async function authResult(action) {
    const result = await action(await authClient());
    if (result?.error) throw new Error(result.error.message || '인증을 완료하지 못했습니다.');
    return result?.data;
  }
  async function request(path, options = {}) {
    const tokenData = await authResult(client => client.token());
    if (!tokenData?.token) throw new Error('로그인 상태가 만료되었습니다. 다시 로그인해 주세요.');
    const response = await fetch(`${apiBase}${path}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenData.token}`, ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '등록 서비스에 연결하지 못했습니다.');
    return payload;
  }
  async function getSession() { return configured() ? (await authResult(client => client.getSession())) || null : null; }
  async function signIn(email, password) { return authResult(client => client.signIn.email({ email, password })); }
  async function signUp(email, password) { return authResult(client => client.signUp.email({ email, password, name: email.split('@')[0] || 'mise user' })); }
  async function submitPlace(payload) { return request('/place-submissions', { method: 'POST', body: JSON.stringify(payload) }); }
  async function signOut() { if (configured()) await authResult(client => client.signOut()); }
  async function searchKto(latitude, longitude) { return configured() ? (await request(`/kto-nearby?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`)).places || [] : []; }
  window.MiseNeon = { configured, getSession, signIn, signUp, submitPlace, searchKto, signOut };
})();
