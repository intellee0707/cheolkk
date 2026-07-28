// Deep End — Gemini API 중계 (Cloudflare Pages Functions, 진단 v3 + 모델 라우팅 v1)
// 진단: /api/chat?test=<DIAG_TOKEN> 으로 접속하면 설정 상태와 구글 연결 테스트 결과를 보여줍니다.
//       DIAG_TOKEN 환경변수를 설정하지 않으면 진단 기능은 꺼진 상태로 동작합니다.
// 환경변수: GEMINI_API_KEY (필수)
//           GEMINI_MODEL (선택, 기본 gemini-3.1-flash-lite — 깊은 대화용)
//           GEMINI_MODEL_LITE (선택, 기본 gemini-2.5-flash-lite — 짧은 리액션용)
//           DIAG_TOKEN (선택, 진단 모드 열쇠. 아무 문자열이나 길게)
// 라우팅: 클라이언트가 body.tier==='lite'를 보내면 라이트 모델 사용(허용 목록 방식 — 임의 모델명은 받지 않음)
const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function callGemini(env, model, body) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(body)
    }
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const model = env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const modelLite = env.GEMINI_MODEL_LITE || 'gemini-2.5-flash-lite';
  const key = env.GEMINI_API_KEY || '';

  /* ---------- 진단 모드 (DIAG_TOKEN이 일치할 때만) ----------
     이 경로는 실제 Gemini 호출을 한 번 발생시키므로 공개해두면
     아무나 반복 호출해 할당량과 요금을 소모시킬 수 있다. 반드시 잠가둔다. */
  if (request.method === 'GET') {
    const diag = env.DIAG_TOKEN || '';
    const given = new URL(request.url).searchParams.get('test') || '';
    if (!diag || given !== diag) return J({ error: 'method' }, 405);

    const info = {
      진단: 'Deep End API 상태 점검 (Cloudflare)',
      모델: model,
      라이트_모델: modelLite,
      키_존재: !!key,
      키_미리보기: key ? key.slice(0, 4) + '...(' + key.length + '자)' : '(없음)'
    };
    if (!key) {
      info.결론 = '이 프로젝트에 GEMINI_API_KEY 환경변수가 없습니다.';
      return J(info);
    }
    try {
      const r = await callGemini(env, model, {
        contents: [{ role: 'user', parts: [{ text: '테스트입니다. 한 단어로만 답하세요.' }] }],
        generationConfig: { maxOutputTokens: 30 }
      });
      const d = await r.json();
      if (r.ok) {
        info.구글_연결 = '성공 ✅';
        info.테스트_응답 = (((d.candidates || [])[0] || {}).content?.parts || []).map(p => p.text).join('').trim();
        info.결론 = '모든 설정이 정상입니다.';
      } else {
        info.구글_연결 = '실패 (' + r.status + ')';
        info.구글_에러_원문 = d.error ? (d.error.status + ': ' + d.error.message) : JSON.stringify(d);
        info.결론 = '구글이 요청을 거절했습니다. 위의 구글_에러_원문을 확인하세요.';
      }
    } catch (e) {
      info.구글_연결 = '네트워크 오류';
      info.구글_에러_원문 = String((e && e.message) || e);
    }
    return J(info);
  }

  /* ---------- 실제 대화 중계 ---------- */
  if (request.method !== 'POST') return J({ error: 'method' }, 405);
  try {
    const { system, messages, tier } = await request.json().catch(() => ({}));
    if (!key) { console.error('[chat] no_key'); return J({ error: 'no_key' }, 500); }
    // 허용 목록 라우팅: 'lite'일 때만 라이트 모델, 그 외 전부 기본 모델
    const useModel = tier === 'lite' ? modelLite : model;
    const maxTok = tier === 'lite' ? 400 : 1000;
    const contents = (messages || []).slice(-30).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: '(대화 시작)' }] });
    const r = await callGemini(env, useModel, {
      systemInstruction: { parts: [{ text: String(system || '') }] },
      contents,
      generationConfig: { maxOutputTokens: maxTok, temperature: 1.0 }
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data.error && data.error.message;
      console.error('[chat] upstream', r.status, useModel, msg);
      return J({ error: 'upstream', detail: msg }, 502);
    }
    const cand = (data.candidates || [])[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
    if (!text) { console.error('[chat] empty', useModel, JSON.stringify(data).slice(0, 300)); return J({ error: 'empty' }, 502); }
    return J({ text });
  } catch (e) {
    console.error('[chat] crash', e);
    return J({ error: String((e && e.message) || e) }, 500);
  }
}
