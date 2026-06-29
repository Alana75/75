
'use strict';
require('dotenv').config({ path: __dirname + '/.env.production' });
const express = require('express');
const twilio  = require('twilio');
const app     = express();
const PORT    = process.env.PORT || 4002;

const accountSid    = process.env.TWILIO_ACCOUNT_SID || '';
const authToken     = process.env.TWILIO_AUTH_TOKEN  || '';
const fromPhone     = process.env.TWILIO_PHONE_NUMBER || '';
const fromWhatsApp  = process.env.TWILIO_WHATSAPP_NUMBER || '';

const twilioClient = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ralph-messaging-service',
    twilio_configured: !!(accountSid && authToken),
    sms_number: fromPhone ? fromPhone.slice(0,6) + '****' : null,
    whatsapp_number: fromWhatsApp ? fromWhatsApp.slice(0,6) + '****' : null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ── Send SMS ────────────────────────────────────────────────────────────────
app.post('/messaging/sms', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  if (!twilioClient) return res.status(503).json({ error: 'Twilio not configured' });
  try {
    const msg = await twilioClient.messages.create({ from: fromPhone, to, body });
    res.json({ success: true, sid: msg.sid, status: msg.status });
  } catch (err) {
    res.status(502).json({ error: 'Twilio error', detail: err.message });
  }
});

// ── Send WhatsApp ───────────────────────────────────────────────────────────
app.post('/messaging/whatsapp', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  if (!twilioClient) return res.status(503).json({ error: 'Twilio not configured' });
  const waFrom = fromWhatsApp.startsWith('whatsapp:') ? fromWhatsApp : 'whatsapp:' + fromWhatsApp;
  const waTo   = to.startsWith('whatsapp:') ? to : 'whatsapp:' + to;
  try {
    const msg = await twilioClient.messages.create({ from: waFrom, to: waTo, body });
    res.json({ success: true, sid: msg.sid, status: msg.status });
  } catch (err) {
    res.status(502).json({ error: 'Twilio error', detail: err.message });
  }
});

// ── Audit notification helper ───────────────────────────────────────────────
app.post('/messaging/notify-audit', async (req, res) => {
  const { to, channel = 'sms', auditSite, auditorName, standard } = req.body;
  if (!to) return res.status(400).json({ error: 'to required' });
  const body = `Ralph Analytics: Field audit submitted for ${auditSite || 'your site'} by ${auditorName || 'auditor'} (${standard || 'RBA'}). Log in to review results: https://ralph-analytics.com/client`;
  const endpoint = channel === 'whatsapp' ? '/messaging/whatsapp' : '/messaging/sms';
  // Internal call
  const axios = require('axios');
  try {
    const r = await axios.post('http://localhost:' + PORT + endpoint, { to, body });
    res.json(r.data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Twilio webhook (inbound) ─────────────────────────────────────────────────
app.post('/messaging/webhook', (req, res) => {
  const { From, Body } = req.body;
  console.log('[inbound]', From, ':', Body);
  // Auto-reply
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Thank you for contacting Ralph Analytics. Our team will follow up shortly. https://ralph-analytics.com</Message></Response>`;
  res.type('text/xml').send(twiml);
});

app.listen(PORT, () => console.log('[ralph-messaging-service] listening on :' + PORT));
