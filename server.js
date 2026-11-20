// server.js – Express server for Kofeely Lucky Wheel
const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'kofeely-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Initialize database on startup
db.getDb();

// Cleanup expired tickets every 10 minutes
setInterval(() => db.cleanupExpiredTickets(), 10 * 60 * 1000);

// --- Utility: HTML-escape output ---
function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

// --- Admin session middleware ---
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  // For API routes, return JSON 401; for page routes, redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/admin/login');
}

// ========== PAGE ROUTES ==========

// Page 1: Customer entry
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Page 2: Lucky Wheel
app.get('/wheel', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'wheel.html'));
});

// Page 3: Admin login
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

// Page 4: Admin menu (protected)
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Page 5: Change Spin PIN (protected)
app.get('/admin/pin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-pin.html'));
});

// Page 6: Change Admin Password (protected)
app.get('/admin/password', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-password.html'));
});

// Page 7: Update Offers (protected)
app.get('/admin/offers', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-offers.html'));
});

// ========== API ROUTES ==========

// --- Customer APIs ---

// Verify spin PIN → issue a single-use spin ticket
app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  const correctPin = db.getSetting('spin_pin');

  if (!pin || pin !== correctPin) {
    return res.status(401).json({
      error: 'Please ask the cart owner for the correct PIN.'
    });
  }

  const token = uuidv4();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
  db.createSpinTicket(token, expiresAt);

  const round = parseInt(db.getSetting('pin_round'), 10);
  res.json({ token, round });
});

// Get current round number (lightweight, no auth needed)
app.get('/api/round', (req, res) => {
  const round = parseInt(db.getSetting('pin_round'), 10);
  res.json({ round });
});

// Spin the wheel → draw from bag
app.post('/api/spin', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(401).json({ error: 'No spin ticket' });
  }

  const ticket = db.getSpinTicket(token);
  if (!ticket) {
    return res.status(401).json({ error: 'Invalid spin ticket' });
  }
  if (ticket.used) {
    // Return the existing result for idempotency
    if (ticket.result_offer_id) {
      const offer = db.getDb().prepare(
        'SELECT offer_text, sentence FROM offers WHERE id = ?'
      ).get(ticket.result_offer_id);
      if (offer) {
        const round = parseInt(db.getSetting('pin_round'), 10);
        return res.json({
          offer_text: offer.offer_text,
          sentence: offer.sentence,
          position: ticket.result_position,
          round,
          already_used: true
        });
      }
    }
    return res.status(401).json({ error: 'Spin ticket already used' });
  }
  if (ticket.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Spin ticket expired' });
  }

  // Draw from the bag
  const result = db.drawFromBag();

  // Mark ticket as used with the result
  db.useSpinTicket(token, result.offer_id, result.position);

  const round = parseInt(db.getSetting('pin_round'), 10);
  res.json({
    offer_text: result.offer_text,
    sentence: result.sentence,
    position: result.position,
    round
  });
});

// --- Admin APIs ---

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const hash = db.getSetting('admin_password_hash');

  if (!password || !bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'Incorrect password, try again' });
  }

  req.session.isAdmin = true;
  res.json({ success: true });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Check admin session
app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Change Spin PIN
app.post('/api/admin/pin', requireAdmin, (req, res) => {
  const { admin_password, new_pin } = req.body;

  // Verify admin password
  const hash = db.getSetting('admin_password_hash');
  if (!admin_password || !bcrypt.compareSync(admin_password, hash)) {
    return res.status(401).json({ error: 'Enter the correct admin password' });
  }

  // Validate new PIN: 4–8 digits
  if (!new_pin || !/^\d{4,8}$/.test(new_pin)) {
    return res.status(400).json({ error: 'PIN must be 4–8 digits.' });
  }

  db.setSetting('spin_pin', new_pin);
  // Increment round so old device-cached results are invalidated
  const currentRound = parseInt(db.getSetting('pin_round'), 10);
  db.setSetting('pin_round', String(currentRound + 1));

  res.json({ success: true, message: 'Spin PIN updated successfully!' });
});

// Change admin password
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { current_password, new_password } = req.body;

  // Verify current password
  const hash = db.getSetting('admin_password_hash');
  if (!current_password || !bcrypt.compareSync(current_password, hash)) {
    return res.status(401).json({ error: 'Enter the correct admin password' });
  }

  // Validate new password: at least 8 characters
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.setSetting('admin_password_hash', newHash);

  res.json({ success: true, message: 'Admin password updated successfully!' });
});

// Get offers
app.get('/api/admin/offers', requireAdmin, (req, res) => {
  const offers = db.getOffers();
  res.json({ offers });
});

// Update offers
app.post('/api/admin/offers', requireAdmin, (req, res) => {
  const { offers } = req.body;

  if (!Array.isArray(offers) || offers.length !== 8) {
    return res.status(400).json({ error: 'Exactly 8 offers are required.' });
  }

  let totalFreq = 0;
  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    if (!o.offer_text || typeof o.offer_text !== 'string' ||
        o.offer_text.length < 1 || o.offer_text.length > 24) {
      return res.status(400).json({
        error: `Offer ${i + 1}: text must be 1–24 characters.`
      });
    }
    if (!o.sentence || typeof o.sentence !== 'string' ||
        o.sentence.length < 1 || o.sentence.length > 80) {
      return res.status(400).json({
        error: `Offer ${i + 1}: sentence must be 1–80 characters.`
      });
    }
    const freq = parseInt(o.frequency, 10);
    if (isNaN(freq) || freq < 0 || freq > 100 || freq !== Number(o.frequency)) {
      return res.status(400).json({
        error: `Offer ${i + 1}: frequency must be a whole number 0–100.`
      });
    }
    o.frequency = freq;
    totalFreq += freq;
  }

  if (totalFreq !== 100) {
    return res.status(400).json({
      error: `Frequencies must add up to 100 (now ${totalFreq})`
    });
  }

  // Map to the expected format with ids
  const mapped = offers.map((o, i) => ({
    id: i + 1,
    offer_text: o.offer_text,
    frequency: o.frequency,
    sentence: o.sentence
  }));

  db.updateOffers(mapped);
  res.json({ success: true, message: 'Offers updated successfully!' });
});

// ========== START SERVER ==========
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🫘 Kofeely Lucky Wheel running at http://localhost:${PORT}`);
  });
}

module.exports = app;
