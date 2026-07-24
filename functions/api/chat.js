// 철크크 API 중계 (Cloudflare Pages Function)
// GitHub 저장소에 "functions/api/chat.js" 경로로 저장하세요.
// 클라이언트 계약: POST /api/chat {system, messages} → {text}

export async function onRequestPost(context) {
  try {
    const { system, messages } = await context.request.json();
    const key = context.env.GEMINI_API_KEY;
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
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!r.ok) {
      const t = await r.text();
      return json({ error: 'gemini ' + r.status, detail: t.slice(0, 200) }, 502);
    }

    const data = await r.json();
    const text = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(p => p.text || '').join('');

    if (!text) return json({ error: 'empty' }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
