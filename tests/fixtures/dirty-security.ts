// TEST FIXTURE — intentionally contains violations for /security-scan
// See tests/EXPECTED.md for the full list of expected findings.

import crypto from 'crypto';

// violation: hardcoded credentials (Critical)
const API_KEY = 'sk-live-abc123def456';
const DB_PASSWORD = 'admin123';
const JWT_SECRET = 'my-super-secret-jwt-key';

// violation: token exposed in URL — will appear in logs and browser history (High)
export function buildAuthUrl(token: string): string {
  return `https://api.example.com/auth?token=${token}&key=${API_KEY}`;
}

// violation: no RBAC check; IDOR via user-controlled query param; SQL injection (Critical)
export function getUserById(req: any): string {
  const id = req.query.id;
  return `SELECT * FROM users WHERE id = '${id}'`;
}

// violation: MD5 is cryptographically broken for password hashing (High)
export function hashPassword(password: string): string {
  return crypto.createHash('md5').update(password).digest('hex');
}
