// Deep End — 통계 대시보드 (Cloudflare Pages Functions)
//
// 쓰는 법: 브라우저에서 https://cheolkk.pages.dev/api/dash?token=DIAG_TOKEN값
//          (DIAG_TOKEN은 이미 Cloudflare에 등록해 둔 진단용 열쇠를 그대로 쓴다)
//
// 하는 일: stats 표를 읽어 사람이 읽을 수 있는 요약 화면으로 만들어 준다.
//          집계는 여기서 하므로 SQL을 몰라도 된다.

const EV_KO = {
  open:'앱 실행', ob_start:'온보딩 시작', ob_quiz:'온보딩·성향테스트', ob_teams:'온보딩·추천조합',
  ob_done:'온보딩 완료', msg:'메시지 전송', diary:'한 줄 일기', letter_read:'편지 열람',
  limit_hit:'한도 도달', trial_start:'체험 시작', sub_open:'구독창 열람', sub_done:'구독 결제',
  topup_done:'충전 결제', push_on:'알림 허용', report:'신고·문의',
  quiz_profile:'프로필·성향테스트', teams_profile:'프로필·추천조합'
};
const PH_KO = {
  nietzsche:'니체', schopenhauer:'쇼펜하우어', kant:'칸트', epicurus:'에피쿠로스',
  socrates:'소크라테스', confucius:'공자', zhuangzi:'장자', kierkegaard:'키르케고르',
  aurelius:'아우렐리우스', group:'단톡방'
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function page(body) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deep End 통계</title><style>
:root{--ink:#12141d;--soft:#1a1d28;--line:#2a2e3d;--paper:#efe8da;--dim:#8d8879;--candle:#d9a05b}
*{box-sizing:border-box}
body{background:var(--ink);color:var(--paper);font-family:-apple-system,'Apple SD Gothic Neo','Segoe UI',sans-serif;margin:0;padding:24px 16px 80px;line-height:1.6}
.wrap{max-width:860px;margin:0 auto}
h1{font-size:20px;color:var(--candle);margin:0 0 4px}
.sub{font-size:12px;color:var(--dim);margin-bottom:24px}
h2{font-size:14px;color:var(--candle);margin:32px 0 10px;letter-spacing:.02em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.card{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px}
.card .n{font-size:26px;font-weight:700;color:var(--paper);line-height:1.2}
.card .l{font-size:11.5px;color:var(--dim);margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--soft);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;font-size:13px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:600;font-size:11.5px;letter-spacing:.03em}
tr:last-child td{border-bottom:0}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:6px;background:var(--candle);border-radius:3px;min-width:2px}
.empty{color:var(--dim);font-size:13px;padding:18px;background:var(--soft);border:1px solid var(--line);border-radius:12px}
.note{font-size:11.5px;color:var(--dim);margin-top:8px;line-height:1.7}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  if (!env.DIAG_TOKEN || token !== env.DIAG_TOKEN) {
    return new Response(page('<h1>접근할 수 없습니다</h1><div class="sub">주소 끝에 ?token=… 을 붙여 주세요.</div>'),
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY };

  let rows = [], reports = [];
  try {
    const r = await fetch(`${base}/rest/v1/stats?select=created_at,device,ev,meta,lang,day&order=created_at.desc&limit=20000`, { headers });
    rows = r.ok ? await r.json() : [];
    const r2 = await fetch(`${base}/rest/v1/reports?select=created_at,kind,text,handled&order=created_at.desc&limit=20`, { headers });
    reports = r2.ok ? await r2.json() : [];
  } catch (e) {
    return new Response(page('<h1>불러오지 못했습니다</h1><div class="sub">' + esc(String(e.message || e)) + '</div>'),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (!rows.length) {
    return new Response(page(`<h1>Deep End 통계</h1><div class="sub">아직 쌓인 기록이 없습니다.</div>
      <div class="empty">앱을 열고 메시지를 몇 개 보낸 뒤 10초쯤 기다렸다가 새로고침해 보세요.</div>`),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // ---- 집계 ----
  const now = Date.now();
  const devAll = new Set(), dev7 = new Set(), dev1 = new Set();
  const byEv = {}, byEvDev = {}, byPh = {}, byDate = {}, byLang = {}, byDay = {};
  const funnel = { limit_hit: new Set(), sub_open: new Set(), sub_done: new Set(), trial_start: new Set() };

  for (const x of rows) {
    const t = Date.parse(x.created_at);
    devAll.add(x.device);
    if (now - t < 7 * 864e5) dev7.add(x.device);
    if (now - t < 864e5) dev1.add(x.device);

    byEv[x.ev] = (byEv[x.ev] || 0) + 1;
    (byEvDev[x.ev] = byEvDev[x.ev] || new Set()).add(x.device);
    if (x.ev === 'msg' && x.meta) byPh[x.meta] = (byPh[x.meta] || 0) + 1;
    if (x.ev === 'open') {
      const d = x.created_at.slice(0, 10);
      (byDate[d] = byDate[d] || new Set()).add(x.device);
      if (x.day != null) (byDay[x.day] = byDay[x.day] || new Set()).add(x.device);
    }
    if (x.lang) (byLang[x.lang] = byLang[x.lang] || new Set()).add(x.device);
    if (funnel[x.ev]) funnel[x.ev].add(x.device);
  }

  const sortDesc = (o, val = v => v) => Object.entries(o).sort((a, b) => val(b[1]) - val(a[1]));
  const setSize = v => v.size;

  // ---- 화면 ----
  let h = `<h1>Deep End 통계</h1>
  <div class="sub">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 기준 · 최근 ${rows.length.toLocaleString()}건</div>`;

  h += `<div class="cards">
    <div class="card"><div class="n">${devAll.size}</div><div class="l">전체 기기</div></div>
    <div class="card"><div class="n">${dev7.size}</div><div class="l">최근 7일 활동</div></div>
    <div class="card"><div class="n">${dev1.size}</div><div class="l">오늘 활동</div></div>
    <div class="card"><div class="n">${(byEv.msg || 0).toLocaleString()}</div><div class="l">누적 메시지</div></div>
  </div>`;

  // 전환 깔때기
  const f = ['limit_hit', 'trial_start', 'sub_open', 'sub_done'];
  const fmax = Math.max(1, ...f.map(k => funnel[k].size));
  h += `<h2>결제까지 가는 길</h2><table><tr><th>단계</th><th>사람 수</th><th style="width:40%"></th></tr>`;
  for (const k of f) {
    const n = funnel[k].size;
    h += `<tr><td>${EV_KO[k]}</td><td class="num">${n}</td>
      <td><div class="bar" style="width:${Math.round(n / fmax * 100)}%"></div></td></tr>`;
  }
  const conv = funnel.limit_hit.size ? (funnel.sub_done.size / funnel.limit_hit.size * 100).toFixed(1) : '—';
  h += `</table><div class="note">한도에 부딪힌 사람 중 ${conv}% 가 결제까지 갔습니다.</div>`;

  // 철학자 인기
  const phs = sortDesc(byPh);
  if (phs.length) {
    const pmax = phs[0][1];
    h += `<h2>철학자별 대화량</h2><table><tr><th>철학자</th><th>메시지</th><th style="width:40%"></th></tr>`;
    for (const [id, n] of phs) {
      h += `<tr><td>${esc(PH_KO[id] || id)}</td><td class="num">${n.toLocaleString()}</td>
        <td><div class="bar" style="width:${Math.round(n / pmax * 100)}%"></div></td></tr>`;
    }
    h += `</table>`;
  }

  // 날짜별
  const dates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  if (dates.length) {
    const dmax = Math.max(...dates.map(d => d[1].size));
    h += `<h2>날짜별 사용자</h2><table><tr><th>날짜</th><th>기기 수</th><th style="width:40%"></th></tr>`;
    for (const [d, s] of dates) {
      h += `<tr><td>${esc(d)}</td><td class="num">${s.size}</td>
        <td><div class="bar" style="width:${Math.round(s.size / dmax * 100)}%"></div></td></tr>`;
    }
    h += `</table>`;
  }

  // 리텐션
  const days = Object.entries(byDay).map(([d, s]) => [Number(d), s.size]).sort((a, b) => a[0] - b[0]).slice(0, 15);
  if (days.length > 1) {
    const base0 = days[0][1] || 1;
    h += `<h2>설치 후 며칠까지 남는가</h2><table><tr><th>며칠째</th><th>기기 수</th><th>유지율</th></tr>`;
    for (const [d, n] of days) {
      h += `<tr><td>${d}일</td><td class="num">${n}</td><td class="num">${(n / base0 * 100).toFixed(0)}%</td></tr>`;
    }
    h += `</table>`;
  }

  // 언어
  const langs = sortDesc(byLang, setSize);
  if (langs.length) {
    h += `<h2>언어</h2><table><tr><th>언어</th><th>기기 수</th></tr>`;
    for (const [l, s] of langs) h += `<tr><td>${esc({ ko: '한국어', en: 'English', ja: '日本語' }[l] || l)}</td><td class="num">${s.size}</td></tr>`;
    h += `</table>`;
  }

  // 전체 사건
  h += `<h2>사건별 집계</h2><table><tr><th>사건</th><th>횟수</th><th>사람 수</th></tr>`;
  for (const [ev, n] of sortDesc(byEv)) {
    h += `<tr><td>${esc(EV_KO[ev] || ev)}</td><td class="num">${n.toLocaleString()}</td><td class="num">${byEvDev[ev].size}</td></tr>`;
  }
  h += `</table>`;

  // 신고
  h += `<h2>최근 신고·문의</h2>`;
  if (!reports.length) h += `<div class="empty">아직 접수된 내용이 없습니다.</div>`;
  else {
    h += `<table><tr><th>날짜</th><th>종류</th><th>내용</th></tr>`;
    for (const r of reports) {
      const kind = { content: '답변 신고', bug: '오류', other: '문의' }[r.kind] || r.kind;
      h += `<tr><td>${esc(r.created_at.slice(5, 16).replace('T', ' '))}</td><td>${esc(kind)}</td>
        <td>${esc(String(r.text).slice(0, 90))}${r.handled ? ' ✓' : ''}</td></tr>`;
    }
    h += `</table>`;
  }

  h += `<div class="note">이 화면은 개인을 식별하지 않는 통계만 보여줍니다. 대화·일기 내용은 포함되지 않습니다.<br>
  기기 수는 브라우저 기준이라, 같은 사람이 폰과 PC를 쓰면 둘로 셉니다.</div>`;

  return new Response(page(h), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
