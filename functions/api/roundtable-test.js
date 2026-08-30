// 원탁 실험 전용 API — 프로덕션 chat.js와 완전히 분리된 별도 엔드포인트입니다.
// GitHub에 정확히 이 경로로 새 파일 생성: functions/api/roundtable-test.js
// (기존 파일은 전혀 건드리지 않습니다. Paddle·tier 로직과 무관)
// 실험이 끝나면 이 파일은 삭제하셔도 무방합니다.

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestPost(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { system, messages } = await context.request.json();
    const key = (context.env.GEMINI_API_KEY || '').trim();
    const model = context.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    if (!key) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수 없음' }), { status: 500, headers: cors });
    }

    const contents = (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: String(system || '') }] },
          contents,
          generationConfig: { temperature: 0.95, maxOutputTokens: 500 }
        })
      }
    );

    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: 'gemini ' + r.status, detail: t.slice(0, 300) }), { status: 502, headers: cors });
    }
    const data = await r.json();
    const text = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(p => p.text || '').join('');
    if (!text) return new Response(JSON.stringify({ error: 'empty' }), { status: 502, headers: cors });

    return new Response(JSON.stringify({ text }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: cors });
  }
}
