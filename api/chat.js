// 철크크 — Gemini API 중계 함수
// 브라우저에 키를 노출하지 않기 위해 서버에서만 Gemini를 호출합니다.
// 환경변수: GEMINI_API_KEY (필수), GEMINI_MODEL (선택, 기본 gemini-2.5-flash-lite)

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const { system, messages } = req.body || {};
    if (!process.env.GEMINI_API_KEY) { res.status(500).json({ error: 'no_key' }); return; }

    // Claude 형식(role: user/assistant) → Gemini 형식(role: user/model) 변환
    // 토큰 절약을 위해 최근 30개 메시지만 전달
    const contents = (messages || []).slice(-30).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: '(대화 시작)' }] });

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: String(system || '') }] },
          contents,
          generationConfig: { maxOutputTokens: 1000, temperature: 1.0 }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'upstream', detail: data.error && data.error.message }); return; }

    const cand = (data.candidates || [])[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
    if (!text) { res.status(502).json({ error: 'empty' }); return; }

    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
