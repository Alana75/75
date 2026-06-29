
// ── Contact Form ──────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, organisation, email, phone, service, standard, message } = req.body;
  if (!name || !organisation || !email || !service || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || process.env.ADMIN_EMAIL || 'admin@ralph-analytics.com',
        pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || ''
      }
    });
    const html = `
      <div style="font-family:Inter,sans-serif;max-width:600px;background:#1a1f2e;color:#eef0f6;border-radius:12px;overflow:hidden;">
        <div style="background:#E8521A;padding:24px 28px;">
          <div style="font-size:18px;font-weight:900;color:#fff;">New Consultation Enquiry — Ralph Analytics</div>
        </div>
        <div style="padding:28px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#8892aa;width:160px;">Name</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#8892aa;">Organisation</td><td style="padding:8px 0;font-weight:600;">${organisation}</td></tr>
            <tr><td style="padding:8px 0;color:#8892aa;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}" style="color:#E8521A;">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#8892aa;">Phone</td><td style="padding:8px 0;">${phone || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#8892aa;">Service Area</td><td style="padding:8px 0;font-weight:600;">${service}</td></tr>
            <tr><td style="padding:8px 0;color:#8892aa;">Standard</td><td style="padding:8px 0;">${standard || '—'}</td></tr>
          </table>
          <div style="margin-top:20px;padding:16px;background:#212639;border-radius:8px;border-left:3px solid #E8521A;">
            <div style="font-size:12px;color:#8892aa;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Message</div>
            <div style="font-size:14px;line-height:1.7;">${message}</div>
          </div>
          <div style="margin-top:20px;font-size:12px;color:#4a5268;">Sent from ralph-analytics.com contact form</div>
        </div>
      </div>`;
    await transporter.sendMail({
      from: '"Ralph Analytics" <admin@ralph-analytics.com>',
      to: 'admin@ralph-analytics.com',
      replyTo: email,
      subject: `New Enquiry: ${service} — ${organisation}`,
      html
    });
    console.log(`[contact] Enquiry from ${name} (${organisation}) — ${service}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[contact] Email error:', err.message);
    // Still return success to not expose email config issues
    // Log it for manual follow-up
    console.log('[contact] FALLBACK LOG:', JSON.stringify({ name, organisation, email, service, message }));
    res.json({ success: true });
  }
});
