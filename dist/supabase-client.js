(() => {
  const config = window.MISE_CONFIG || {};
  let client = null;

  function configured() {
    return Boolean(config.supabaseUrl && config.supabasePublishableKey && window.supabase);
  }

  function getClient() {
    if (!configured()) return null;
    if (!client) client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    return client;
  }

  async function getSession() {
    const db = getClient();
    if (!db) return null;
    const { data } = await db.auth.getSession();
    return data.session || null;
  }

  async function requestMagicLink(email) {
    const db = getClient();
    if (!db) throw new Error('등록 저장소가 아직 연결되지 않았습니다.');
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    if (error) throw error;
  }

  async function submitPlace(payload) {
    const db = getClient();
    if (!db) throw new Error('등록 저장소가 아직 연결되지 않았습니다.');
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData.user) throw new Error('이메일 로그인 후 등록할 수 있습니다.');
    const { error } = await db.from('place_submissions').insert({ ...payload, submitted_by: userData.user.id });
    if (error) throw error;
  }

  async function searchKto(latitude, longitude) {
    const db = getClient();
    if (!db) return [];
    const { data: { session } } = await db.auth.getSession();
    if (!session) return [];
    const response = await fetch(`${config.supabaseUrl}/functions/v1/kto-nearby?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`, {
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` }
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.places) ? payload.places : [];
  }

  async function signOut() {
    const db = getClient();
    if (db) await db.auth.signOut();
  }

  window.MiseSupabase = { configured, getSession, requestMagicLink, submitPlace, searchKto, signOut };
})();
