// Deploy only after setting KTO_SERVICE_KEY and WEB_ORIGIN as Supabase secrets.
// This keeps the public-data service key out of browsers and limits access to signed-in users.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers }
});

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';
  const allowedOrigin = Deno.env.get('WEB_ORIGIN') || '';
  if (!allowedOrigin || origin !== allowedOrigin) return json({ error: 'Origin not allowed' }, 403);
  const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' } });

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: 'Authentication required' }, 401, cors);

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const serviceKey = Deno.env.get('KTO_SERVICE_KEY');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !serviceKey) return json({ error: 'Invalid request or server configuration' }, 400, cors);

  const apiUrl = new URL('https://apis.data.go.kr/B551011/KorService2/locationBasedList2');
  apiUrl.search = new URLSearchParams({ serviceKey, MobileOS: 'ETC', MobileApp: 'mise', _type: 'json', contentTypeId: '39', mapX: String(lon), mapY: String(lat), radius: '2000', numOfRows: '30' }).toString();
  const response = await fetch(apiUrl);
  if (!response.ok) return json({ error: 'Tour API temporarily unavailable' }, 502, cors);
  const payload = await response.json();
  const items = payload?.response?.body?.items?.item || [];
  const places = (Array.isArray(items) ? items : [items]).filter(Boolean).map((item) => ({
    id: `kto-${item.contentid}`,
    name: item.title || '관광공사 등록 음식점',
    cuisine: '관광공사 음식점',
    where: item.addr1 || item.addr2 || '현재 위치 주변',
    distance: '주변',
    match: '관광공사 등록',
    trust: 87,
    source: '한국관광공사 TourAPI',
    verified: '방금 확인',
    desc: item.tel ? `전화 ${item.tel}` : '상세 정보는 관광공사 출처에서 확인하세요.',
    tags: ['한국관광공사', '음식점']
  }));
  return json({ places }, 200, { ...cors, 'Cache-Control': 'private, max-age=300' });
});
