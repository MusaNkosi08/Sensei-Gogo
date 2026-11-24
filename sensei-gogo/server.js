'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
})();

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 600;
const API_URL = 'https://models.github.ai/inference/chat/completions';
const INDEX = path.join(__dirname, 'index.html');
const LANGS = ['English', 'Afrikaans', 'isiZulu', 'isiXhosa', 'isiNdebele', 'siSwati', 'Sesotho', 'Sepedi', 'Setswana', 'Xitsonga', 'Tshivenda'];
const MODES = ['steps', 'hint', 'kasi', 'exam', 'mark'];
const MAX_MESSAGES = 8;
const MAX_CHARS = 800;
const MAX_FILE_CHARS = 4000;
const MAX_IMAGE_CHARS = 6 * 1024 * 1024;
const TIMEOUT_MS = 45000;

/* ---------- language detection ---------- */
// Weighted markers for each language. Shared Nguni/Sotho words are left out on purpose
// so that the distinctive spellings decide (tjh = isiNdebele, ts/ntf = siSwati, š = Sepedi, ḓ ṱ = Tshivenda).
const W = (re, w) => [re, w];
const MARKERS = {
  Afrikaans: [
    W(/\b(die|nie|ek|jy|julle|hoekom|waarom|asseblief|verduidelik|hierdie|dankie|vraag|antwoord|vergelyking|wiskunde|oplos|bereken|moet|sal|ook|maar|baie|kan jy|wat is|hoe)\b/g, 1),
    W(/(^|\s)'n\s/g, 2),
  ],
  isiZulu: [
    W(/\bngi(?:cela|yacela|yabonga|size|siza|funa|nga|yazi|qonda|chazele|zama)\w*/g, 2),
    W(/\bangi(?:yi|zi|si|li|ku)?(?:qondi|zwa|boni|azi)\w*/g, 2),
    W(/\b(angazi|kanjani|yini|ukuthi|lokhu|manje|futhi|kungani|kuphi|chaza|ungangisiza|ngisize|usizo|isibalo|impendulo|umbuzo|ngiyabonga|yebo|sawubona)\b/g, 2),
    W(/\b(uma|kodwa|khona|lapho|nje)\b/g, 1),
  ],
  isiXhosa: [
    W(/\bndi[a-z]{3,}/g, 2),
    W(/\bandi[a-z]{3,}/g, 2),
    W(/\b(njani|yintoni|enkosi|molo|nceda|ndincede|kwaye|kutheni|phendula|ewe|ngoku|kakuhle|ndiyabulela|nantsi|apha)\b/g, 3),
  ],
  isiNdebele: [
    W(/tjh/g, 3),
    W(/\b(lotjhani|ngiyathokoza|ngibawa|kghani|godu|ukutjho|bona)\b/g, 3),
  ],
  siSwati: [
    W(/tf|dv/g, 3),
    W(/\b(kutsi|ngitsi|sitsi|tsine|letinye|emanti|lokutsi|ngekutsi|nawutsi|tintfo|bantfu|umntfwana)\b/g, 3),
  ],
  Sesotho: [
    W(/\b(jwang|hobane|leboha|utlwisise|joale|haholo|ntlhalosetse|nthuse|eseng|hantle|hore|kea)\b/g, 3),
    W(/\bho\b/g, 2),
    W(/\b(kopa|karabo|potso|thusa|ke|ka)\b/g, 1),
  ],
  Setswana: [
    W(/\b(jang|gonne|tsweetswee|tlhaloganye|jaanong|ntlhalosetsa|thata|sentle|tlhalosa)\b/g, 3),
    W(/\b(go|gore|leboga|kopa|karabo|potso|thusa|ke|ka)\b/g, 1),
  ],
  Sepedi: [
    W(/š/g, 3),
    W(/\b(bjang|bjalo|gobane|kgopela|kgopelo|kwesisa|kwešiša|thuša|eupša|gabotse|hlaloša|ke a leboga)\b/g, 3),
    W(/\b(go|leboga|karabo|potšišo|ke|ka)\b/g, 1),
  ],
  Xitsonga: [
    W(/\bndz\w*/g, 3),
    W(/\b(swi|xi|njhani|hikuva|kambe|inkomu|hlamusela|pfuna|xana|leswi|hikwalaho|nhlamulo|xivutiso|ndzi)\b/g, 3),
  ],
  Tshivenda: [
    W(/[ḓṱṅḽṋ]/g, 3),
    W(/\b(khou|zwi|zwine|livhuwa|ngauri|talutshedza|ṱalutshedza|ndaa|vhathu|ngani)\b/g, 3),
    W(/\b(ndi|vha|hani|ndo|nga)\b/g, 2),
  ],
};
function detectLang(text) {
  const t = ' ' + String(text || '').toLowerCase().normalize('NFC').replace(/[’`]/g, "'") + ' ';
  if (t.replace(/[^a-zà-ÿḓṱṅḽṋš]/g, '').length < 4) return null;
  let best = null, bestScore = 0, second = 0;
  for (const [lang, rules] of Object.entries(MARKERS)) {
    let score = 0;
    for (const [re, w] of rules) score += ((t.match(re) || []).length) * w;
    if (score > bestScore) { second = bestScore; bestScore = score; best = lang; }
    else if (score > second) second = score;
  }
  const min = best === 'Afrikaans' ? 3 : 2;
  if (!best || bestScore < min || bestScore === second) return null;
  const english = (t.match(/\b(the|what|how|why|please|explain|solve|find|calculate|help|and|of|this|with|for|does|straight|line|equation)\b/g) || []).length;
  return { lang: best, mixed: english >= 2 };
}

const ALIASES = [
  ['sesotho sa leboa', 'Sepedi'], ['northern sotho', 'Sepedi'], ['southern sotho', 'Sesotho'],
  ['afrikaans', 'Afrikaans'], ['english', 'English'], ['isizulu', 'isiZulu'], ['zulu', 'isiZulu'],
  ['isixhosa', 'isiXhosa'], ['xhosa', 'isiXhosa'], ['isindebele', 'isiNdebele'], ['ndebele', 'isiNdebele'],
  ['siswati', 'siSwati'], ['swati', 'siSwati'], ['swazi', 'siSwati'], ['sepedi', 'Sepedi'], ['pedi', 'Sepedi'],
  ['setswana', 'Setswana'], ['tswana', 'Setswana'], ['sesotho', 'Sesotho'], ['sotho', 'Sesotho'],
  ['xitsonga', 'Xitsonga'], ['tsonga', 'Xitsonga'], ['tshivenḓa', 'Tshivenda'], ['tshivenda', 'Tshivenda'], ['venda', 'Tshivenda'],
];
function normLang(s) {
  const t = String(s || '').toLowerCase();
  let hit = null, at = Infinity;
  for (const [k, v] of ALIASES) { const i = t.indexOf(k); if (i >= 0 && i < at) { at = i; hit = v; } }
  return hit;
}

function languageRules(target, mixed, hasFile) {
  const list = LANGS.join(', ');
  const who = target
    ? `Reply in ${target}.${mixed ? ` The learner mixed ${target} with English, so write mainly in ${target} and keep the English words they used.` : ''} Do not answer in English unless ${target} is English.`
    : `Reply in the language the learner wrote in. If they mixed languages, mix them the same way.${hasFile ? ' If the uploaded photo or file is written in a South African language, reply in that language.' : ''}`;
  return `LANGUAGE (most important rule):
- ${who}
- isiZulu, isiXhosa, isiNdebele and siSwati are different languages, and so are Sesotho, Sepedi and Setswana. Never swap one for another. Use the correct spelling of the language you reply in (Sepedi uses š, Tshivenda uses ḓ ṱ ṅ ḽ ṋ).
- Do not fall back to English because a topic is technical. Explain in the reply language, keep maths notation standard, and add the English subject term in brackets after a translated term.
- The very first line of every reply must be: LANG: <language you are replying in, one of ${list}>`;
}

function systemPrompt(mode, langBlock) {
  return `You are Sensei Gogo, a warm, wise, encouraging South African gogo (granny) who tutors Grade 12 learners following CAPS: Mathematics, Mathematical Literacy, Physical Sciences, Life Sciences, Accounting, Geography, History and Business Studies. Call the learner "mntwana" now and then.

${langBlock}

Formatting: plain text only. No markdown, no asterisks, no LaTeX. Write maths simply, like x^2, sqrt(x), (a+b)/c. Write the labels below exactly as shown, in English capitals, each at the start of its own line, even when you reply in another language.

Modes:
- steps: SUBJECT: <subject>
  STEP 1: <one short step> ... up to STEP 6 (use only as many steps as needed, at most 6)
  ANSWER: <final answer>
  CHECK: <one practice question of the same type>
- hint: SUBJECT: <subject>
  HINT: <one nudge only, never the answer>
- kasi: same format as steps, but explain using everyday South African examples (taxi fares, spaza shop, stokvel, braai, load shedding, soccer). If you explained this before, explain it in a new way.
- exam: SUBJECT: <subject>
  then several TIP: lines on how marks are awarded in the NSC exam for this type of question, and the common mistakes learners make.
- mark: the learner is answering your last CHECK question. Reply VERDICT: correct, VERDICT: almost or VERDICT: not yet, then one or two short lines of feedback.

Current mode: ${mode}.
If the learner uploaded a photo or file, read the question from it and answer it in the current mode. If it has several questions, answer the first one and say they can ask about the others.
Greetings and general questions about studying: reply normally in a few warm sentences, without the other labels (the LANG line is still required). Politely decline topics that are not about school or studying. If you are unsure of a fact, say so honestly.`;
}

/* ---------- helpers ---------- */
const LOCAL_ORIGIN = /^(null|https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/;
function cors(req) {
  const o = req.headers.origin;
  return o && LOCAL_ORIGIN.test(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
}
function send(req, res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...cors(req),
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) tooBig = true; else chunks.push(c); });
    req.on('end', () => tooBig
      ? reject(Object.assign(new Error('That is too big for Gogo. Try a smaller photo or a shorter file.'), { status: 413 }))
      : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

function cleanAttachment(a) {
  if (!a || typeof a !== 'object') return null;
  const name = String(a.name || 'file').replace(/[\r\n"]/g, ' ').slice(0, 80);
  if (a.kind === 'text' && typeof a.text === 'string' && a.text.trim()) return { kind: 'text', name, text: a.text.trim().slice(0, MAX_FILE_CHARS) };
  if (a.kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.length <= MAX_IMAGE_CHARS && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.dataUrl)) return { kind: 'image', name, dataUrl: a.dataUrl };
  return undefined; // present but invalid
}

/* ---------- routes ---------- */
async function handleDetect(req, res) {
  let p;
  try { p = JSON.parse(await readBody(req, 32 * 1024)); } catch (e) { return send(req, res, e.status || 400, { error: 'Bad request' }); }
  const d = detectLang(p && p.text);
  return send(req, res, 200, { lang: d ? d.lang : null, mixed: d ? d.mixed : false });
}

async function handleChat(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req, 8 * 1024 * 1024)); }
  catch (e) { return send(req, res, e.status || 400, { error: e.status ? e.message : 'Gogo could not read that request.' }); }

  const messages = cleanMessages(payload && payload.messages);
  if (!messages) return send(req, res, 400, { error: 'Please type a question for Gogo first.' });
  const att = cleanAttachment(payload.attachment);
  if (att === undefined) return send(req, res, 400, { error: 'Gogo can only read photos (JPG, PNG, WEBP) and text from documents.' });
  const picked = LANGS.includes(payload.lang) ? payload.lang : null; // null = auto
  const mode = MODES.includes(payload.mode) ? payload.mode : 'steps';

  const token = process.env.GITHUB_TOKEN;
  if (!token) return send(req, res, 500, { error: 'Gogo is not connected yet. Add GITHUB_TOKEN to the .env file and restart the server.' });

  // Language decision: the file's language wins for uploads, then the typed language, then the picker.
  const typed = messages[messages.length - 1].content;
  const found = (att && att.kind === 'text' && detectLang(att.text)) || detectLang(typed);
  const target = found ? found.lang : picked;
  const langBlock = languageRules(target, found ? found.mixed : false, !!att);

  const last = messages[messages.length - 1];
  if (att && att.kind === 'text') last.content = `${last.content}\n\nUploaded file "${att.name}":\n${att.text}`;
  if (att && att.kind === 'image') {
    last.content = [
      { type: 'text', text: `${last.content}\n\n(The learner uploaded a photo "${att.name}". Read the question in it.)` },
      { type: 'image_url', image_url: { url: att.dataUrl, detail: 'high' } },
    ];
  }
  const reminder = target
    ? `Reminder: start with "LANG: ${target}" and write the whole reply in ${target}.`
    : 'Reminder: start with the LANG line and reply in the same language the learner used.';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        messages: [{ role: 'system', content: systemPrompt(mode, langBlock) }, ...messages, { role: 'system', content: reminder }],
      }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error('Upstream error', r.status, data && JSON.stringify(data).slice(0, 300));
      if (r.status === 429) return send(req, res, 429, { error: 'Gogo needs a short rest. Too many questions at once, try again in a minute.' });
      if (r.status === 401 || r.status === 403) return send(req, res, 502, { error: "Gogo's GitHub token was refused. Make sure GITHUB_TOKEN is valid and has the models:read permission." });
      if (r.status === 413 || (data && /too large|context|tokens/i.test(JSON.stringify(data)))) return send(req, res, 413, { error: 'That question or file is too long for Gogo. Try a shorter part of it.' });
      if (att && att.kind === 'image' && r.status === 400) return send(req, res, 400, { error: `Gogo could not read that photo with the model "${MODEL}". Try a clearer photo or a model that accepts images.` });
      return send(req, res, 502, { error: 'Gogo could not get an answer right now. Please try again.' });
    }
    let reply = String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    let lang = target;
    const m = reply.match(/^\s*LANG(?:UAGE)?\s*[:：]\s*([^\n]*)\n?/im);
    if (m) { lang = normLang(m[1]) || lang; reply = reply.replace(m[0], '').trim(); }
    if (!reply) return send(req, res, 502, { error: 'Gogo went quiet. Please ask again.' });
    return send(req, res, 200, { reply, lang: lang || null, detected: found ? found.lang : null });
  } catch (e) {
    if (e.name === 'AbortError') return send(req, res, 504, { error: 'Gogo took too long to answer. Please try again.' });
    console.error('Chat failed:', e.message, e.cause ? e.cause.message || e.cause.code : '');
    return send(req, res, 502, { error: 'The server could not reach GitHub Models. Check the server has internet access.' });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204, cors(req));
      return res.end();
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'Method not allowed' });
      const html = await fs.promises.readFile(INDEX);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
      });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (url.pathname === '/api/health') return send(req, res, 200, { ok: true, connected: !!process.env.GITHUB_TOKEN, model: MODEL });
    if (url.pathname === '/api/detect') {
      if (req.method !== 'POST') return send(req, res, 405, { error: 'Method not allowed' });
      return await handleDetect(req, res);
    }
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return send(req, res, 405, { error: 'Method not allowed' });
      return await handleChat(req, res);
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return send(req, res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(req, res, 500, { error: 'Something went wrong on the server.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Sensei Gogo is ready at http://localhost:${PORT}`);
    if (!process.env.GITHUB_TOKEN) console.warn('Warning: GITHUB_TOKEN is not set. Chat will not work until it is.');
  });
}
module.exports = { server, detectLang, normLang };
