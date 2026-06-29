
'use strict';
require('dotenv').config({ path: __dirname + '/.env.production' });
const express  = require('express');
const axios    = require('axios');
const app      = express();
const PORT     = process.env.PORT || 4001;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const MODEL      = process.env.OPENAI_MODEL || 'gpt-4o';

app.use(express.json());

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ralph-ai-service',
    model: MODEL,
    openai_configured: !!OPENAI_KEY,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ── Simple completion ──────────────────────────────────────────────────────
app.post('/ai/complete', async (req, res) => {
  const { prompt, system, max_tokens = 1000 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL,
      max_tokens,
      messages: [
        { role: 'system', content: system || 'You are a helpful M&E assistant for Ralph Analytics.' },
        { role: 'user',   content: prompt }
      ]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    res.json({ text: resp.data.choices[0].message.content, usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});

// ── Audit analysis ─────────────────────────────────────────────────────────
app.post('/ai/analyse-audit', async (req, res) => {
  const { auditData, standard } = req.body;
  if (!auditData) return res.status(400).json({ error: 'auditData required' });
  const prompt = `You are an expert ${standard || 'RBA'} compliance analyst.
Analyse this field audit data and provide:
1. Overall compliance score (0-100)
2. Top 3 critical findings
3. Recommended corrective actions
4. Risk level (Low/Medium/High/Critical)

Audit data: ${JSON.stringify(auditData).slice(0, 3000)}

Respond in JSON: { score, findings: [], actions: [], riskLevel }`;
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    const parsed = JSON.parse(resp.data.choices[0].message.content);
    res.json({ ...parsed, usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});

// ── Standards gap analysis ──────────────────────────────────────────────────
app.post('/ai/gap-analysis', async (req, res) => {
  const { currentFindings, standard, organisation } = req.body;
  if (!currentFindings) return res.status(400).json({ error: 'currentFindings required' });
  const prompt = `You are a ${standard || 'RBA'} compliance expert.
Organisation: ${organisation || 'Unknown'}
Findings: ${JSON.stringify(currentFindings).slice(0, 2000)}

Provide a gap analysis with:
1. Compliance gaps by section
2. Priority remediation steps
3. Estimated effort (Low/Medium/High) per gap

Respond in JSON: { gaps: [{ section, gap, priority, effort }], summary }`;
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    res.json({ ...JSON.parse(resp.data.choices[0].message.content), usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});

// ── Report narrative ────────────────────────────────────────────────────────
app.post('/ai/generate-narrative', async (req, res) => {
  const { reportData, tone = 'professional', audience = 'donor' } = req.body;
  if (!reportData) return res.status(400).json({ error: 'reportData required' });
  const prompt = `Write a ${tone} M&E report narrative for a ${audience} audience.
Report data: ${JSON.stringify(reportData).slice(0, 2000)}
Write 3-4 paragraphs covering: executive summary, key findings, outcomes, recommendations.`;
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    res.json({ narrative: resp.data.choices[0].message.content, usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});


// ── Translation ────────────────────────────────────────────────────────────
app.post('/ai/translate', async (req, res) => {
  const { text, targetLanguage, sourceLanguage = 'auto', domain = 'general', tone = 'professional' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage required' });
  const domainCtx = {
    'audit':       'compliance auditing, supply chain management, and ESG reporting',
    'legal':       'legal and regulatory compliance',
    'technical':   'technical documentation and engineering',
    'general':     'general business communication',
    'me':          'monitoring and evaluation, NGO programme reporting',
  }[domain] || 'general business communication';
  const prompt = `You are an expert translator specialising in ${domainCtx}.
Translate the following text from ${sourceLanguage === 'auto' ? 'the detected language' : sourceLanguage} to ${targetLanguage}.
Tone: ${tone}. Preserve formatting, paragraph breaks, and technical terminology.
Return JSON: { translation, detectedLanguage, wordCount, notes }

Text:
${text.slice(0, 4000)}`;
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL, max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    const parsed = JSON.parse(resp.data.choices[0].message.content);
    res.json({ ...parsed, usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});

// ── Terminology extraction ─────────────────────────────────────────────────
app.post('/ai/extract-terms', async (req, res) => {
  const { text, language = 'en', domain = 'audit' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const prompt = `Extract key technical terms and glossary entries from this ${domain} document.
For each term provide: term, definition, context, and suggested translations into French (fr), Spanish (es), Simplified Chinese (zh).
Return JSON: { terms: [{ term, definition, context, translations: { fr, es, zh } }] }

Text:
${text.slice(0, 3000)}`;
  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL, max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' } });
    res.json({ ...JSON.parse(resp.data.choices[0].message.content), usage: resp.data.usage });
  } catch (err) {
    res.status(502).json({ error: 'OpenAI error', detail: err.response?.data?.error?.message || err.message });
  }
});

app.listen(PORT, () => console.log('[ralph-ai-service] listening on :' + PORT));
