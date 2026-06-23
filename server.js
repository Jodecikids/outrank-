const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { analyzeKeyword, generateContent } = require('./services/ai');
const { sendWelcomeEmail, notifyAdmin } = require('./services/email');
const { createCheckoutSession, handleWebhook } = require('./services/stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'signups.json');

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send('Missing signature');

  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    await handleWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe] Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readSignups() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeSignups(signups) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(signups, null, 2), 'utf-8');
}

app.post('/api/waitlist', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const signups = readSignups();
  if (signups.some(s => s.email === email)) return res.status(409).json({ error: 'This email is already on the waitlist.' });

  const entry = { id: crypto.randomUUID(), name: name.trim(), email: email.trim().toLowerCase(), date: new Date().toISOString() };
  signups.push(entry);
  writeSignups(signups);

  console.log(`[Waitlist] New signup: ${entry.name} <${entry.email}> (total: ${signups.length})`);

  await Promise.allSettled([
    sendWelcomeEmail(entry.name, entry.email),
    notifyAdmin(entry.name, entry.email)
  ]);

  res.status(201).json({ success: true, message: "You're on the list!", total: signups.length });
});

app.get('/api/waitlist/stats', (req, res) => {
  res.json({ total: readSignups().length });
});

app.post('/api/analyze', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword || typeof keyword !== 'string') return res.status(400).json({ error: 'Keyword is required.' });

  try {
    const result = await analyzeKeyword(keyword.trim());
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[AI] Analysis error:', err.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

app.post('/api/generate', async (req, res) => {
  const { keyword, type } = req.body;
  if (!keyword) return res.status(400).json({ error: 'Keyword is required.' });

  try {
    const result = await generateContent(keyword.trim(), type || 'brief');
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[AI] Generation error:', err.message);
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

app.post('/api/create-checkout', async (req, res) => {
  const { plan, billing, email, name } = req.body;
  if (!plan || !billing) return res.status(400).json({ error: 'Plan and billing are required.' });

  const result = await createCheckoutSession(plan, billing, { email, name });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    aiConfigured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
    emailConfigured: !!(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Outrank] Server running at http://localhost:${PORT}`);
});
