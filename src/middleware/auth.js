/**
 * JWT Authentication Middleware
 * Verifies Bearer token on every /api/* request (except /api/login)
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

// Parse agent users from env — supports JSON array or single user
function loadAgentUsers() {
  const raw = process.env.AGENT_USERS || '';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fallback: single user from legacy env vars
    const user = process.env.AGENT_USER;
    const pass = process.env.AGENT_PASS;
    if (user && pass) return [{ user, pass }];
    return [{ user: 'admin', pass: 'changeme123' }];
  }
}

/**
 * POST /api/login
 * Body: { username, password }
 * Returns: { token, expiresIn }
 */
function loginHandler(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const agents = loadAgentUsers();
  const match = agents.find(a => a.user === username && a.pass === password);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign(
    { username, role: 'agent' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({ token, expiresIn: JWT_EXPIRY, username });
}

/**
 * Middleware: verifies Authorization: Bearer <token>
 * Attaches req.user = { username, role } on success
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid token.';
    res.status(401).json({ error: msg });
  }
}

module.exports = { loginHandler, requireAuth };
