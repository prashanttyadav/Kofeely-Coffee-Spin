// tests/draw.test.js – Random draw simulation: verify exact frequency distribution
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, '..', 'test_draw.db');
process.env.DB_PATH = TEST_DB;

beforeAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
});

const db = require('../db');

afterAll(() => {
  db.closeDb();
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('Shuffled Bag Draw', () => {
  const expectedFreqs = {
    1: 20,  // 10% Off
    2: 20,  // 15% Off
    3: 15,  // 20% Off
    4: 15,  // 30% Off
    5: 10,  // 40% Off
    6: 10,  // 50% Off
    7: 7,   // 65% Off
    8: 3,   // 80% Off
  };

  test('1000 spins: each block of 100 matches exact frequencies', () => {
    // Initialize database
    db.getDb();

    // Run 1000 draws (10 blocks of 100)
    for (let block = 0; block < 10; block++) {
      const counts = {};
      for (let i = 1; i <= 8; i++) counts[i] = 0;

      for (let spin = 0; spin < 100; spin++) {
        const result = db.drawFromBag();
        expect(result).toHaveProperty('offer_id');
        expect(result).toHaveProperty('offer_text');
        expect(result).toHaveProperty('sentence');
        expect(result).toHaveProperty('position');
        expect(result.position).toBeGreaterThanOrEqual(0);
        expect(result.position).toBeLessThanOrEqual(7);
        counts[result.offer_id]++;
      }

      // Check exact frequencies in this block
      for (let id = 1; id <= 8; id++) {
        expect(counts[id]).toBe(expectedFreqs[id]);
      }
    }
  });

  test('bag resets when offers are updated', () => {
    const d = db.getDb();

    // Draw a few to partially empty the bag
    for (let i = 0; i < 10; i++) db.drawFromBag();

    // Update offers with new frequencies
    const newOffers = [
      { id: 1, offer_text: 'A', frequency: 25, sentence: 'S1' },
      { id: 2, offer_text: 'B', frequency: 25, sentence: 'S2' },
      { id: 3, offer_text: 'C', frequency: 15, sentence: 'S3' },
      { id: 4, offer_text: 'D', frequency: 10, sentence: 'S4' },
      { id: 5, offer_text: 'E', frequency: 10, sentence: 'S5' },
      { id: 6, offer_text: 'F', frequency: 10, sentence: 'S6' },
      { id: 7, offer_text: 'G', frequency: 3,  sentence: 'S7' },
      { id: 8, offer_text: 'H', frequency: 2,  sentence: 'S8' },
    ];
    db.updateOffers(newOffers);

    // Now draw 100 and verify new frequencies
    const counts = {};
    for (let i = 1; i <= 8; i++) counts[i] = 0;

    for (let spin = 0; spin < 100; spin++) {
      const result = db.drawFromBag();
      counts[result.offer_id]++;
    }

    expect(counts[1]).toBe(25);
    expect(counts[2]).toBe(25);
    expect(counts[3]).toBe(15);
    expect(counts[4]).toBe(10);
    expect(counts[5]).toBe(10);
    expect(counts[6]).toBe(10);
    expect(counts[7]).toBe(3);
    expect(counts[8]).toBe(2);

    // Reset offers back to seed data
    const seedOffers = [
      { id: 1, offer_text: '10% Off', frequency: 20, sentence: 'Woh!' },
      { id: 2, offer_text: '15% Off', frequency: 20, sentence: 'Woh!' },
      { id: 3, offer_text: '20% Off', frequency: 15, sentence: 'Wohh!' },
      { id: 4, offer_text: '30% Off', frequency: 15, sentence: 'Wooh!' },
      { id: 5, offer_text: '40% Off', frequency: 10, sentence: 'Woohh!' },
      { id: 6, offer_text: '50% Off', frequency: 10, sentence: 'Woohhh!!' },
      { id: 7, offer_text: '65% Off', frequency: 7,  sentence: 'Woooohhhhh!!!' },
      { id: 8, offer_text: '80% Off', frequency: 3,  sentence: 'Wohhhh!!!!' },
    ];
    db.updateOffers(seedOffers);
  });

  test('positions are uniformly distributed (no position-offer correlation)', () => {
    const positionCounts = {};
    for (let i = 0; i < 8; i++) positionCounts[i] = 0;

    // Draw enough to check position distribution
    const draws = 800;
    for (let i = 0; i < draws; i++) {
      const result = db.drawFromBag();
      positionCounts[result.position]++;
    }

    // Each position should appear roughly 100 times (800/8)
    // Allow ±40 for random variation
    for (let p = 0; p < 8; p++) {
      expect(positionCounts[p]).toBeGreaterThan(50);
      expect(positionCounts[p]).toBeLessThan(150);
    }
  });
});
