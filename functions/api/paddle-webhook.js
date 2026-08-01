// Deep End — Paddle 웹훅 수신 (Cloudflare Pages Functions)
//
// 하는 일: Paddle이 보내는 결제 알림을 받아 서명을 검증하고, Supabase의
//          user_data.data.su 에 구독 상태를 기록한다. 앱은 이 값만 신뢰한다.
//
// 필요한 환경변수 (Cloudflare → Settings → Variables, 모두 Secret 권장)
//   PADDLE_WEBHOOK_SECRET  Paddle → Developer tools → Notifications 에서 발급한 서명 키
//   PADDLE_PRICE_MONTHLY   월간 구독 Price ID (pri_...)
//   PADDLE_PRICE_YEARLY    연간 구독 Price ID (pri_...)
//   PADDLE_PRICE_TOPUP     말풍선 충전 Price ID (pri_...)
//   SUPABASE_URL           예: https://kbkypprqxiqitdrombbg.supabase.co
//   SUPABASE_SERVICE_KEY   Supabase → Settings → API → service_role 키 (절대 공개 금지)
//
// Paddle 쪽 설정: Notifications → 이 주소를 등록
//   https://<사이트주소>/api/paddle-webhook
//   구독할 이벤트: transaction.completed, subscription.created,
//                  subscription.updated, subscription.canceled

const TOPUP_BUBBLES = 300; // 충전 1회당 지급량 (앱의 SUB.TOPUP과 같아야 한다)

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Paddle-Signature 헤더 검증. 형식: ts=<초>;h1=<hex>  서명 대상: `${ts}:${rawBody}` */
async function verify(secret, header, rawBody) {
  if (!secret || !header) return false;
  let ts = '', h1 = '';
  for (const part of header.split(';')) {
    const [k, v] = part.split('=');
    if (k === 'ts') ts = v;
    else if (k === 'h1') h1 = v;
  }
  if (!ts || !h1) return false;

  // 재생 공격 방지: 5분 넘게 지난 요청은 거절
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!isFinite(age) || age > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ts + ':' + rawBody));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

  // 길이가 같을 때만 상수 시간 비교 (타이밍 공격 방지)
  if (hex.length !== h1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ h1.charCodeAt(i);
  return diff === 0;
}

/** user_data.data.su 를 읽어 patch를 병합해 다시 저장한다 */
async function patchSub(env, userId, patch) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  const r = await fetch(
    `${base}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}&select=data`,
    { headers }
  );
  if (!r.ok) throw new Error('read failed ' + r.status);
  const rows = await r.json();

  // 로그인만 하고 아직 동기화 전인 유저일 수 있으므로, 없으면 새로 만든다
  const data = (rows[0] && rows[0].data) || {};
  const su = Object.assign(
    { since: 0, start: 0, paidUntil: 0, paidSince: 0, extra: 0, trialUsed: 0 },
    data.su || {}
  );
  data.su = Object.assign(su, typeof patch === 'function' ? patch(su) : patch);

  const w = await fetch(`${base}/rest/v1/user_data`, {
    method: 'POST',
    headers: Object.assign({ 'Prefer': 'resolution=merge-duplicates' }, headers),
    body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() })
  });
  if (!w.ok) throw new Error('write failed ' + w.status + ' ' + (await w.text()).slice(0, 200));
}

/** 이벤트에서 우리 유저 ID 찾기. 체크아웃에서 custom_data로 넣어 보낸 값 */
const uid = (d) => (d && d.custom_data && (d.custom_data.user_id || d.custom_data.userId)) || '';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return J({ error: 'method' }, 405);

  const raw = await request.text();
  const ok = await verify(env.PADDLE_WEBHOOK_SECRET, request.headers.get('Paddle-Signature'), raw);
  // 서명이 안 맞으면 그대로 거절한다. 이 검증이 결제 위조를 막는 유일한 장치다.
  if (!ok) { console.error('[paddle] bad signature'); return J({ error: 'signature' }, 401); }

  let ev;
  try { ev = JSON.parse(raw); } catch (e) { return J({ error: 'json' }, 400); }

  const type = ev.event_type || '';
  const d = ev.data || {};
  const userId = uid(d);
  if (!userId) { console.error('[paddle] no user_id', type); return J({ ok: true, skip: 'no_user' }); }

  try {
    if (type === 'transaction.completed') {
      // 충전(단건)만 여기서 처리한다. 구독 결제도 이 이벤트를 발생시키므로 Price ID로 가른다.
      const items = d.items || [];
      let topups = 0;
      for (const it of items) {
        const pid = (it.price && it.price.id) || it.price_id;
        if (pid && pid === env.PADDLE_PRICE_TOPUP) topups += (it.quantity || 1);
      }
      if (topups > 0) {
        await patchSub(env, userId, (su) => ({ extra: (su.extra || 0) + TOPUP_BUBBLES * topups }));
        return J({ ok: true, topup: topups });
      }
      return J({ ok: true, skip: 'not_topup' });
    }

    if (type === 'subscription.created' || type === 'subscription.updated') {
      const active = d.status === 'active' || d.status === 'trialing';
      // 다음 결제일까지를 이용 기간으로 본다. 해지 예약 시에는 남은 기간의 끝까지 유지된다.
      const until = d.next_billed_at
        ? Date.parse(d.next_billed_at)
        : (d.current_billing_period && d.current_billing_period.ends_at
            ? Date.parse(d.current_billing_period.ends_at) : 0);
      await patchSub(env, userId, (su) => ({
        paidUntil: active && until ? until : (su.paidUntil || 0),
        paidSince: su.paidSince || Date.parse(d.started_at || '') || Date.now()
      }));
      return J({ ok: true, until });
    }

    if (type === 'subscription.canceled') {
      // 즉시 끊지 않는다. 이미 낸 기간까지는 쓸 수 있어야 한다.
      const ends = (d.current_billing_period && d.current_billing_period.ends_at)
        ? Date.parse(d.current_billing_period.ends_at)
        : (d.canceled_at ? Date.parse(d.canceled_at) : Date.now());
      await patchSub(env, userId, () => ({ paidUntil: ends }));
      return J({ ok: true, ends });
    }

    return J({ ok: true, skip: type });
  } catch (e) {
    console.error('[paddle]', type, String((e && e.message) || e));
    // 500을 돌려주면 Paddle이 재시도한다
    return J({ error: String((e && e.message) || e) }, 500);
  }
}
