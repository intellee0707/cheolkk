// Deep End — 구독 관리 포털 열기 (Cloudflare Pages Functions)
//
// 하는 일: 로그인한 유저를 확인한 뒤, Paddle 고객 포털 주소를 만들어 돌려준다.
//          유저는 그 페이지에서 해지·플랜 변경·결제수단 변경·영수증 확인을 할 수 있다.
//
// 필요한 환경변수 (Cloudflare → Settings → Variables)
//   PADDLE_API_KEY    Paddle → Developer tools → Authentication → API key
//                     (샌드박스 키는 pdl_sdbx_..., 실서비스 키는 pdl_live_...)
//   PADDLE_ENV        'sandbox' 또는 'production' (없으면 sandbox로 본다)
//   SUPABASE_URL      이미 등록돼 있음
//   SUPABASE_SERVICE_KEY  이미 등록돼 있음
//
// 클라이언트는 자기 로그인 토큰을 Authorization 헤더에 담아 POST 한다.

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return J({ error: 'method' }, 405);

  // 1) 로그인 확인 — 남의 구독을 열지 못하도록 토큰을 Supabase에 되물어 검증한다
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return J({ error: 'no_token' }, 401);

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const who = await fetch(base + '/auth/v1/user', {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
  });
  if (!who.ok) return J({ error: 'bad_token' }, 401);
  const user = await who.json();
  const userId = user && user.id;
  if (!userId) return J({ error: 'bad_token' }, 401);

  // 2) 이 유저의 Paddle 고객 번호 찾기 (웹훅이 결제할 때 적어둔 값)
  const r = await fetch(
    `${base}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}&select=data`,
    { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY } }
  );
  if (!r.ok) return J({ error: 'read_failed' }, 500);
  const rows = await r.json();
  const su = (rows[0] && rows[0].data && rows[0].data.su) || {};

  // 고객번호는 웹훅이 적어두지만, 웹훅이 늦거나 놓쳤을 때를 대비해
  // 클라이언트가 결제창에서 직접 받은 값도 보조로 받는다.
  let cid = su.cid || '';
  if (!cid) {
    try {
      const body = await request.json();
      if (body && typeof body.cid === 'string' && /^ctm_[a-z0-9]+$/i.test(body.cid)) cid = body.cid;
    } catch (_) {}
  }
  if (!cid) return J({ error: 'no_customer' }, 404);   // 아직 결제한 적이 없는 유저

  // 3) Paddle에 포털 주소를 요청한다 (한 번 쓰고 마는 임시 주소)
  const host = (env.PADDLE_ENV === 'production') ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  const payload = su.sid ? JSON.stringify({ subscription_ids: [su.sid] }) : '{}';
  const p = await fetch(`${host}/customers/${cid}/portal-sessions`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.PADDLE_API_KEY, 'Content-Type': 'application/json' },
    body: payload
  });
  const pd = await p.json();
  if (!p.ok) {
    console.error('[portal]', p.status, JSON.stringify(pd).slice(0, 300));
    return J({ error: 'paddle', detail: (pd.error && pd.error.detail) || '' }, 502);
  }

  const urls = (pd.data && pd.data.urls) || {};
  const url = (urls.general && urls.general.overview) || '';
  if (!url) return J({ error: 'no_url' }, 502);
  return J({ url });
}
