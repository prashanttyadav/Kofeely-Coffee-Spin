// db.js – SQLite database setup, seed data, and helper functions
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kofeely.db');

let db;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  init(db);
  return db;
}

function init(db) {
  // --- Schema ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offers (
      id        INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 8),
      offer_text TEXT NOT NULL,
      frequency  INTEGER NOT NULL CHECK(frequency BETWEEN 0 AND 100),
      sentence   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bag (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER NOT NULL REFERENCES offers(id)
    );

    CREATE TABLE IF NOT EXISTS spin_tickets (
      token      TEXT PRIMARY KEY,
      used       INTEGER NOT NULL DEFAULT 0,
      result_offer_id INTEGER,
      result_position INTEGER,
      expires_at INTEGER NOT NULL
    );
  `);

  // --- Seed only on first run ---
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM settings').get();
  if (existing.cnt === 0) {
    const hash = bcrypt.hashSync('11OctKofeelyCoffee', 10);
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    ins.run('spin_pin', '7236');
    ins.run('admin_password_hash', hash);
    ins.run('pin_round', '1');

    const seedOffers = [
      { id: 1, text: '10% Off', freq: 20, sentence: 'Woh!'           },
      { id: 2, text: '15% Off', freq: 20, sentence: 'Woh!'           },
      { id: 3, text: '20% Off', freq: 15, sentence: 'Wohh!'          },
      { id: 4, text: '30% Off', freq: 15, sentence: 'Wooh!'          },
      { id: 5, text: '40% Off', freq: 10, sentence: 'Woohh!'         },
      { id: 6, text: '50% Off', freq: 10, sentence: 'Woohhh!!'       },
      { id: 7, text: '65% Off', freq:  7, sentence: 'Woooohhhhh!!!'  },
      { id: 8, text: '80% Off', freq:  3, sentence: 'Wohhhh!!!!'     },
    ];
    const insOffer = db.prepare(
      'INSERT INTO offers (id, offer_text, frequency, sentence) VALUES (?, ?, ?, ?)'
    );
    for (const o of seedOffers) {
      insOffer.run(o.id, o.text, o.freq, o.sentence);
    }

    refillBag(db);
  }
}

/** Fill the bag with 100 tickets matching current offer frequencies, shuffled. */
function refillBag(database) {
  const d = database || getDb();
  d.prepare('DELETE FROM bag').run();

  const offers = d.prepare('SELECT id, frequency FROM offers').all();
  const tickets = [];
  for (const o of offers) {
    for (let i = 0; i < o.frequency; i++) {
      tickets.push(o.id);
    }
  }
  // Fisher-Yates shuffle
  for (let i = tickets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tickets[i], tickets[j]] = [tickets[j], tickets[i]];
  }

  const ins = d.prepare('INSERT INTO bag (offer_id) VALUES (?)');
  const insertAll = d.transaction(() => {
    for (const t of tickets) ins.run(t);
  });
  insertAll();
}

/** Draw one ticket from the bag (atomic). Returns { offer_text, sentence, position }. */
function drawFromBag() {
  const d = getDb();

  const draw = d.transaction(() => {
    // Check if bag is empty and refill if needed
    const count = d.prepare('SELECT COUNT(*) AS cnt FROM bag').get().cnt;
    if (count === 0) {
      refillBag(d);
    }

    // Pick a random ticket
    const ticket = d.prepare(
      'SELECT id, offer_id FROM bag ORDER BY RANDOM() LIMIT 1'
    ).get();

    // Remove it from the bag
    d.prepare('DELETE FROM bag WHERE id = ?').run(ticket.id);

    // Get the offer details
    const offer = d.prepare(
      'SELECT offer_text, sentence FROM offers WHERE id = ?'
    ).get(ticket.offer_id);

    // Random position (0–7) independent of the offer
    const position = Math.floor(Math.random() * 8);

    return {
      offer_id: ticket.offer_id,
      offer_text: offer.offer_text,
      sentence: offer.sentence,
      position
    };
  });

  return draw();
}

// --- Settings helpers ---

function getSetting(key) {
  return getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function setSetting(key, value) {
  getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
}

function getOffers() {
  return getDb().prepare('SELECT id, offer_text, frequency, sentence FROM offers ORDER BY id').all();
}

function updateOffers(offers) {
  const d = getDb();
  const upd = d.prepare(
    'UPDATE offers SET offer_text = ?, frequency = ?, sentence = ? WHERE id = ?'
  );
  const updateAll = d.transaction(() => {
    for (const o of offers) {
      upd.run(o.offer_text, o.frequency, o.sentence, o.id);
    }
  });
  updateAll();
  refillBag(d);
}

// --- Spin ticket helpers ---

function createSpinTicket(token, expiresAt) {
  getDb().prepare(
    'INSERT INTO spin_tickets (token, expires_at) VALUES (?, ?)'
  ).run(token, expiresAt);
}

function getSpinTicket(token) {
  return getDb().prepare('SELECT * FROM spin_tickets WHERE token = ?').get(token);
}

function useSpinTicket(token, offerId, position) {
  getDb().prepare(
    'UPDATE spin_tickets SET used = 1, result_offer_id = ?, result_position = ? WHERE token = ?'
  ).run(offerId, position, token);
}

// --- Cleanup expired tickets periodically ---
function cleanupExpiredTickets() {
  getDb().prepare('DELETE FROM spin_tickets WHERE expires_at < ?').run(Date.now());
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  refillBag,
  drawFromBag,
  getSetting,
  setSetting,
  getOffers,
  updateOffers,
  createSpinTicket,
  getSpinTicket,
  useSpinTicket,
  cleanupExpiredTickets,
  closeDb,
  DB_PATH
};
