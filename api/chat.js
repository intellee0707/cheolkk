// 철크크 — Gemini API 중계 함수 (진단 기능 포함 버전)
// 브라우저로 /api/chat 을 직접 열면(GET) 현재 설정 상태와 구글 연결 테스트 결과를 보여줍니다.
// 환경변수: GEMINI_API_KEY (필수), GEMINI_MODEL (선택, 기본 gemini-2.5-flash-lite)

export default async function handler(req, res) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const key = process.env.GEMINI_API_KEY || '';

  /* ---------- 진단 모드 (브라우저에서 직접 열었을 때) ---------- */
  if (req.method === 'GET') {
    const info = {
      진단: '철크크 API 상태 점검',
      모델: model,
      키_존재: !!key,
      키_형식_정상: key.startsWith('AIza'),
      키_미리보기: key ? key.slice(0, 4) + '...(' + key.length + '자)' : '(없음)'
    };
    if (!key) {
      info.결론 = '이 프로젝트에 GEMINI_API_KEY 환경변수가 없습니다. 키를 넣은 프로젝트가 다른 프로젝트일 수 있어요.';
      return res.status(200).json(info);
    }
    if (!key.startsWith('AIza')) {
      info.결론 = '키가 AIza로 시작하지 않습니다. aistudio.google.com/apikey 에서 발급한 키가 맞는지 확인하세요.';
      return res.status(200).json(info);
    }
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: '테스트입니다. 한 단어로만 답하세요.' }] }],
            generationConfig: { maxOutputTokens: 30 }
          })
        }
      );
      const d = await r.json();
      if (r.ok) {
        info.구글_연결 = '성공 ✅';
        info.테스트_응답 = ((d.candidates || [])[0]?.content?.parts || []).map(p => p.text).join('').trim();
        info.결론 = '모든 설정이 정상입니다. 앱에서 대화가 될 거예요.';
      } else {
        info.구글_연결 = '실패 (' + r.status + ')';
        info.구글_에러_원문 = d.error ? (d.error.status + ': ' + d.error.message) : JSON.stringify(d);
        info.결론 = '구글이 요청을 거절했습니다. 위의 구글_에러_원문을 확인하세요.';
      }
    } catch (e) {
      info.구글_연결 = '네트워크 오류';
      info.구글_에러_원문 = String(e && e.message || e);
    }
    return res.status(200).json(info);
  }

  /* ---------- 실제 대화 중계 (앱이 호출) ---------- */
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const { system, messages } = req.body || {};
    if (!key) { console.error('[chat] no_key'); res.status(500).json({ error: 'no_key' }); return; }

    const contents = (messages || []).slice(-30).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: '(대화 시작)' }] });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
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
    if (!r.ok) {
      const msg = data.error && data.error.message;
      console.error('[chat] upstream', r.status, msg);
      res.status(502).json({ error: 'upstream', detail: msg });
      return;
    }
    const cand = (data.candidates || [])[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
    if (!text) { console.error('[chat] empty', JSON.stringify(data).slice(0, 300)); res.status(502).json({ error: 'empty' }); return; }

    res.status(200).json({ text });
  } catch (e) {
    console.error('[chat] crash', e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
