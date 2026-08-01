// Deep End — 익명 이용 통계 수신 (Cloudflare Pages Functions)
//
// 받는 것: 사건 이름, 기기 표식, 숫자, 짧은 부가정보.
// 받지 않는 것: 계정 ID, 이메일, 대화·일기 내용.
// 여러 사건을 한 번에 배열로 받아 요청 수를 줄인다.
//
// 필요한 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY (이미 등록돼 있음)
// 먼저 stats.sql 을 실행해 표를 만들어야 한다.

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// 허용하는 사건 이름만 받는다 (오염 방지)
const EVENTS = new Set([
  'open',        // 앱 실행
  'ob_start',    // 온보딩 시작
  'ob_quiz',     // 온보딩에서 성향 테스트 사용
  'ob_teams',    // 온보딩에서 추천 조합 사용
  'ob_done',     // 온보딩 완료 (n=걸린 초)
  'msg',         // 유저 메시지 전송 (meta=철학자 id 또는 group)
  'diary',       // 한 줄 일기 작성
  'letter_read', // 편지 열람
  'limit_hit',   // 한도 도달 화면 노출
  'trial_start', // 체험 시작
  'sub_open',    // 구독 시트 열림
  'sub_done',    // 구독 결제 완료
  'topup_done',  // 충전 결제 완료
  'push_on',     // 알림 허용
  'report',      // 신고 제출 (meta=종류)
  'quiz_profile','teams_profile' // 프로필 화면에서 테스트/조합 재사용
]);

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return J({ error: 'method' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return J({ error: 'json' }, 400); }

  const device = String(body.device || '').slice(0, 40);
  if (!/^[a-z0-9-]{8,40}$/i.test(device)) return J({ error: 'device' }, 400);

  const list = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
  const lang = String(body.lang || '').slice(0, 8);
  const day = Number.isFinite(body.day) ? Math.max(0, Math.min(3650, Math.floor(body.day))) : null;

  const rows = [];
  for (const e of list) {
    if (!e || !EVENTS.has(e.ev)) continue;
    rows.push({
      device,
      ev: e.ev,
      n: Number.isFinite(e.n) ? Math.floor(e.n) : null,
      meta: e.meta ? String(e.meta).slice(0, 60) : null,
      lang, day
    });
  }
  if (!rows.length) return J({ ok: true, saved: 0 });

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const r = await fetch(base + '/rest/v1/stats', {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!r.ok) {
    console.error('[stats]', r.status, (await r.text()).slice(0, 150));
    return J({ error: 'save' }, 500);
  }
  return J({ ok: true, saved: rows.length });
}
