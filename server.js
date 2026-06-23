const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'signups.json');

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

function readSignups() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeSignups(signups) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(signups, null, 2), 'utf-8');
}

app.post('/api/waitlist', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const signups = readSignups();

  if (signups.some(s => s.email === email)) {
    return res.status(409).json({ error: 'This email is already on the waitlist.' });
  }

  const entry = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    date: new Date().toISOString()
  };

  signups.push(entry);
  writeSignups(signups);

  console.log(`[Waitlist] New signup: ${entry.name} <${entry.email}> (total: ${signups.length})`);

  res.status(201).json({
    success: true,
    message: 'You\'re on the list!',
    total: signups.length
  });
});

app.get('/api/waitlist/stats', (req, res) => {
  const signups = readSignups();
  res.json({ total: signups.length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Outrank] Server running at http://localhost:${PORT}`);
});
