// tests/api.test.js – API endpoint tests
const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a separate test database
const TEST_DB = path.join(__dirname, '..', 'test_kofeely.db');
process.env.DB_PATH = TEST_DB;

// Clean up before each test suite
beforeAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
});

const app = require('../server');
const db = require('../db');

afterAll(() => {
  db.closeDb();
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('PIN Verification', () => {
  test('wrong PIN returns 401 with correct error message', async () => {
    const res = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '0000' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Please ask the cart owner for the correct PIN.');
  });

  test('empty PIN returns 401', async () => {
    const res = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '' });
    expect(res.status).toBe(401);
  });

  test('correct PIN returns token and round', async () => {
    const res = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '7236' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('round');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });
});

describe('Spin API', () => {
  test('spin without token returns 401', async () => {
    const res = await request(app)
      .post('/api/spin')
      .send({});
    expect(res.status).toBe(401);
  });

  test('spin with invalid token returns 401', async () => {
    const res = await request(app)
      .post('/api/spin')
      .send({ token: 'invalid-token-123' });
    expect(res.status).toBe(401);
  });

  test('spin with valid token returns offer', async () => {
    // Get a valid token first
    const pinRes = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '7236' });
    const { token } = pinRes.body;

    const spinRes = await request(app)
      .post('/api/spin')
      .send({ token });
    expect(spinRes.status).toBe(200);
    expect(spinRes.body).toHaveProperty('offer_text');
    expect(spinRes.body).toHaveProperty('sentence');
    expect(spinRes.body).toHaveProperty('position');
    expect(spinRes.body).toHaveProperty('round');
    expect(spinRes.body.position).toBeGreaterThanOrEqual(0);
    expect(spinRes.body.position).toBeLessThanOrEqual(7);
  });

  test('second spin with same token returns already_used', async () => {
    const pinRes = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '7236' });
    const { token } = pinRes.body;

    // First spin
    await request(app).post('/api/spin').send({ token });

    // Second spin – should return the same result with already_used flag
    const res = await request(app)
      .post('/api/spin')
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body.already_used).toBe(true);
  });
});

describe('Round API', () => {
  test('returns current round number', async () => {
    const res = await request(app).get('/api/round');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('round');
    expect(typeof res.body.round).toBe('number');
  });
});

describe('Admin Login', () => {
  test('wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect password, try again');
  });

  test('correct password returns success', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: '11OctKofeelyCoffee' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Admin Pages (without login)', () => {
  test('GET /admin redirects to login', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('GET /admin/pin redirects to login', async () => {
    const res = await request(app).get('/admin/pin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('GET /admin/password redirects to login', async () => {
    const res = await request(app).get('/admin/password');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('GET /admin/offers redirects to login', async () => {
    const res = await request(app).get('/admin/offers');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('API /api/admin/offers without session returns 401', async () => {
    const res = await request(app).get('/api/admin/offers');
    expect(res.status).toBe(401);
  });
});

describe('Admin PIN Change', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(app);
    await agent.post('/api/admin/login').send({ password: '11OctKofeelyCoffee' });
  });

  test('wrong admin password → error', async () => {
    const res = await agent
      .post('/api/admin/pin')
      .send({ admin_password: 'wrongpass', new_pin: '1234' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Enter the correct admin password');
  });

  test('correct admin password → PIN changes', async () => {
    const res = await agent
      .post('/api/admin/pin')
      .send({ admin_password: '11OctKofeelyCoffee', new_pin: '9999' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Old PIN should fail
    const oldRes = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '7236' });
    expect(oldRes.status).toBe(401);

    // New PIN should work
    const newRes = await request(app)
      .post('/api/verify-pin')
      .send({ pin: '9999' });
    expect(newRes.status).toBe(200);

    // Reset PIN back for other tests
    await agent
      .post('/api/admin/pin')
      .send({ admin_password: '11OctKofeelyCoffee', new_pin: '7236' });
  });

  test('invalid PIN format rejected', async () => {
    const res = await agent
      .post('/api/admin/pin')
      .send({ admin_password: '11OctKofeelyCoffee', new_pin: '12' });
    expect(res.status).toBe(400);
  });
});

describe('Admin Password Change', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(app);
    await agent.post('/api/admin/login').send({ password: '11OctKofeelyCoffee' });
  });

  test('wrong current password → error', async () => {
    const res = await agent
      .post('/api/admin/password')
      .send({ current_password: 'wrongpass', new_password: 'newpassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Enter the correct admin password');
  });

  test('correct current password → password changes', async () => {
    const newPass = 'NewSecurePass!1';
    const res = await agent
      .post('/api/admin/password')
      .send({ current_password: '11OctKofeelyCoffee', new_password: newPass });
    expect(res.status).toBe(200);

    // Old password should fail
    const oldRes = await request(app)
      .post('/api/admin/login')
      .send({ password: '11OctKofeelyCoffee' });
    expect(oldRes.status).toBe(401);

    // New password should work
    const newRes = await request(app)
      .post('/api/admin/login')
      .send({ password: newPass });
    expect(newRes.status).toBe(200);

    // Reset password back
    const agent2 = request.agent(app);
    await agent2.post('/api/admin/login').send({ password: newPass });
    await agent2
      .post('/api/admin/password')
      .send({ current_password: newPass, new_password: '11OctKofeelyCoffee' });
  });

  test('short password rejected', async () => {
    const res = await agent
      .post('/api/admin/password')
      .send({ current_password: '11OctKofeelyCoffee', new_password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('Admin Offers', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(app);
    await agent.post('/api/admin/login').send({ password: '11OctKofeelyCoffee' });
  });

  test('GET offers returns 8 offers', async () => {
    const res = await agent.get('/api/admin/offers');
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(8);
    expect(res.body.offers[0].offer_text).toBe('10% Off');
  });

  test('frequencies not summing to 100 rejected', async () => {
    const badOffers = Array.from({ length: 8 }, (_, i) => ({
      offer_text: `Offer ${i + 1}`,
      frequency: 10,
      sentence: `Sentence ${i + 1}`
    }));
    // Sum = 80, not 100
    const res = await agent
      .post('/api/admin/offers')
      .send({ offers: badOffers });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Frequencies must add up to 100');
  });

  test('offer text too long rejected', async () => {
    const badOffers = Array.from({ length: 8 }, (_, i) => ({
      offer_text: i === 0 ? 'A'.repeat(25) : `Offer ${i + 1}`,
      frequency: i === 0 ? 30 : 10,
      sentence: `Sentence ${i + 1}`
    }));
    const res = await agent
      .post('/api/admin/offers')
      .send({ offers: badOffers });
    expect(res.status).toBe(400);
  });

  test('valid offers save successfully', async () => {
    const validOffers = [
      { offer_text: '5% Off',  frequency: 25, sentence: 'Nice!' },
      { offer_text: '10% Off', frequency: 25, sentence: 'Great!' },
      { offer_text: '15% Off', frequency: 15, sentence: 'Wow!' },
      { offer_text: '20% Off', frequency: 15, sentence: 'Amazing!' },
      { offer_text: '25% Off', frequency: 10, sentence: 'Super!' },
      { offer_text: '30% Off', frequency: 5,  sentence: 'Awesome!' },
      { offer_text: '50% Off', frequency: 3,  sentence: 'Incredible!' },
      { offer_text: '75% Off', frequency: 2,  sentence: 'Legendary!' },
    ];
    const res = await agent
      .post('/api/admin/offers')
      .send({ offers: validOffers });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify they were saved
    const getRes = await agent.get('/api/admin/offers');
    expect(getRes.body.offers[0].offer_text).toBe('5% Off');

    // Reset to seed data
    const seedOffers = [
      { offer_text: '10% Off', frequency: 20, sentence: 'Woh!' },
      { offer_text: '15% Off', frequency: 20, sentence: 'Woh!' },
      { offer_text: '20% Off', frequency: 15, sentence: 'Wohh!' },
      { offer_text: '30% Off', frequency: 15, sentence: 'Wooh!' },
      { offer_text: '40% Off', frequency: 10, sentence: 'Woohh!' },
      { offer_text: '50% Off', frequency: 10, sentence: 'Woohhh!!' },
      { offer_text: '65% Off', frequency: 7,  sentence: 'Woooohhhhh!!!' },
      { offer_text: '80% Off', frequency: 3,  sentence: 'Wohhhh!!!!' },
    ];
    await agent.post('/api/admin/offers').send({ offers: seedOffers });
  });
});

describe('Page Routes', () => {
  test('GET / returns 200', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Check your luck!');
  });

  test('GET /wheel returns 200 (page loads, JS handles redirect)', async () => {
    const res = await request(app).get('/wheel');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Lucky Wheel!');
  });

  test('GET /admin/login returns 200', async () => {
    const res = await request(app).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin Password');
  });
});
