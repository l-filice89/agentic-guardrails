// TEST FIXTURE — intentionally contains violations for /cleanup, /sweep, /security-scan, and /review
// See tests/EXPECTED.md for the full list of expected findings.

import express from 'express';

const router = express.Router();

// violation: no auth/ownership check before fetching by ID (IDOR)
router.get('/users/:id', async (req, res) => {
  const userId = req.params.id; // violation: trusts client-controlled ID directly

  console.log('Fetching user:', userId); // violation: raw log, no structured logger or correlation ID

  // violation: SQL injection via string interpolation
  const user = await (req as any).db.query(
    `SELECT * FROM users WHERE id = ${userId}`
  );

  console.log('User found:', JSON.stringify(user)); // violation: logs potentially sensitive data

  res.json(user);
});

// violation: no server-side tenant validation — trusts client-provided tenantId
router.post('/documents', async (req, res) => {
  const { tenantId, content } = req.body;

  const doc = await (req as any).db.query(
    'INSERT INTO documents (tenant_id, content) VALUES (?, ?)',
    [tenantId, content] // violation: tenant ID sourced from request body without backend auth
  );

  res.json({ id: doc.insertId });
});

export default router;
