(() => {
  const config = window.MISE_CONFIG || {};
  const apiBase = String(config.registrationApiUrl || '').replace(/\/$/, '');
  const authUrl = String(config.neonAuthUrl || '').replace(/\/$/, '');
  let authClientPromise;

  function apiConfigured() { return Boolean(apiBase); }
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
  async function publicRequest(path) {
    const response = await fetch(`${apiBase}${path}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '공식 관광 데이터를 불러오지 못했습니다.');
    return payload;
  }
  async function getSession() { return configured() ? (await authResult(client => client.getSession())) || null : null; }
  async function signIn(email, password) { return authResult(client => client.signIn.email({ email, password })); }
  async function signUp(email, password) { return authResult(client => client.signUp.email({ email, password, name: email.split('@')[0] || 'mise user' })); }
  async function submitPlace(payload) { return request('/place-submissions', { method: 'POST', body: JSON.stringify(payload) }); }
  async function signOut() { if (configured()) await authResult(client => client.signOut()); }
  async function searchKto(latitude, longitude) { return apiConfigured() ? (await publicRequest(`/kto-nearby?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`)).places || [] : []; }
  const daeguDistricts = [
    ['중구', 35.8694, 128.6062], ['동구', 35.8867, 128.6356], ['서구', 35.8718, 128.5592],
    ['남구', 35.8460, 128.5977], ['북구', 35.8859, 128.5828], ['수성구', 35.8582, 128.6307],
    ['달서구', 35.8299, 128.5327], ['달성군', 35.7747, 128.4313], ['군위군', 36.2429, 128.5729],
  ];
  function daeguDistrict(latitude, longitude) {
    if (latitude < 35.60 || latitude > 36.35 || longitude < 128.30 || longitude > 128.85) return null;
    return daeguDistricts.reduce((nearest, district) => {
      const distance = Math.hypot((district[1] - latitude) * 111, (district[2] - longitude) * 90);
      return distance < nearest.distance ? { name: district[0], distance } : nearest;
    }, { name: '중구', distance: Number.POSITIVE_INFINITY }).name;
  }
  async function staticDaegu(latitude, longitude) {
    const district = daeguDistrict(latitude, longitude);
    if (!district) return null;
    const response = await fetch(new URL('data/daegu-restaurants.json', document.baseURI), { cache: 'no-cache' });
    if (!response.ok) throw new Error('대구시 공식 데이터 스냅샷을 읽지 못했습니다.');
    const snapshot = await response.json();
    const places = Array.isArray(snapshot.districts?.[district]) ? snapshot.districts[district].slice(0, 30) : [];
    return { places, providers: ['대구광역시 대구푸드'], region: `대구광역시 ${district}`, fetchedAt: snapshot.fetchedAt };
  }
  async function searchRegional(latitude, longitude) {
    try { const snapshot = await staticDaegu(latitude, longitude); if (snapshot) return snapshot; } catch {}
    try { return apiConfigured() ? await publicRequest(`/regional-nearby?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`) : { places: [], providers: [] }; } catch { return { places: [], providers: [] }; }
  }
  window.MiseNeon = { configured, getSession, signIn, signUp, submitPlace, searchKto, searchRegional, signOut };
})();
