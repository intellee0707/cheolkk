// 철크크 API 중계 v2 (자가진단 포함)
// GitHub의 functions/api/chat.js 내용을 이걸로 전체 교체하세요.
// 브라우저에서 /api/chat?test=1 을 열면 상태를 알려줍니다.

export async function onRequestGet(context) {
  const key = (context.env.GEMINI_API_KEY || '').trim();
  const model = context.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const info = {
    ok: true,
    functionAlive: true,
    keySet: !!key,
    keyLength: key ? key.length : 0,
    keyPrefix: key ? key.slice(0, 5) : '',
    model
  };

  const url = new URL(context.request.url);
  if (url.searchParams.get('test') === '1' && key) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '안녕이라고 한 단어로만 답해' }] }] })
        }
      );
      info.geminiStatus = r.status;
      const t = await r.text();
      info.geminiSays = t.slice(0, 300);
    } catch (e) {
      info.geminiError = String((e && e.message) || e);
    }
  }
  return json(info);
}

export async function onRequestPost(context) {
  try {
    const { system, messages } = await context.request.json();
    const key = (context.env.GEMINI_API_KEY || '').trim();
    const model = context.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    if (!key) return json({ error: 'GEMINI_API_KEY missing' }, 500);

    const contents = (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

    const body = {
      contents,
      systemInstruction: { parts: [{ text: String(system || '') }] },
      generationConfig: { temperature: 0.9, maxOutputTokens: 1000 }
    };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }
    );

    if (!r.ok) {
      const t = await r.text();
      return json({ error: 'gemini ' + r.status, detail: t.slice(0, 300) }, 502);
    }

    const data = await r.json();
    const text = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(p => p.text || '').join('');

    if (!text) return json({ error: 'empty', detail: JSON.stringify(data).slice(0, 300) }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
