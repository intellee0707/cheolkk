// Deep End — 신고·문의 접수 (Cloudflare Pages Functions)
//
// 하는 일: 앱에서 보낸 신고·문의를 Supabase의 reports 표에 적는다.
//          AI 답변 신고는 스토어 정책상 필요한 기능이라, 로그인하지 않은 사람도 보낼 수 있어야 한다.
//
// 필요한 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY (이미 등록돼 있음)
// 먼저 reports 표를 만들어야 한다 (reports.sql 참고)

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const KINDS = ['content', 'bug', 'other'];   // 답변 신고 / 오류 / 그 밖의 문의

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return J({ error: 'method' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return J({ error: 'json' }, 400); }

  const kind = KINDS.includes(body.kind) ? body.kind : 'other';
  const text = String(body.text || '').slice(0, 4000);
  if (text.trim().length < 2) return J({ error: 'empty' }, 400);

  // 신고 대상 대화 몇 줄 (선택). 길면 잘라서 보관한다.
  const ctx = String(body.context || '').slice(0, 4000);

  const row = {
    kind,
    text,
    context: ctx || null,
    lang: String(body.lang || '').slice(0, 8),
    who: String(body.who || '').slice(0, 128) || null,   // 로그인한 경우의 계정 식별자
    ua: String(request.headers.get('User-Agent') || '').slice(0, 300),
    app_version: String(body.version || '').slice(0, 40)
  };

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const r = await fetch(base + '/rest/v1/reports', {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!r.ok) {
    console.error('[report]', r.status, (await r.text()).slice(0, 200));
    return J({ error: 'save_failed' }, 500);
  }
  return J({ ok: true });
}
