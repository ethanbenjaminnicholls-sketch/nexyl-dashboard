const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL is missing; database operations will fail until it is set.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => console.error('[DB] Idle client error:', err.message));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_configs (
      guild_id TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS warnings (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT,
      user_tag TEXT,
      moderator_id TEXT,
      reason TEXT NOT NULL DEFAULT 'No reason provided',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS warnings_guild_user_idx ON warnings(guild_id, user_id);
    CREATE TABLE IF NOT EXISTS guild_logs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      actor_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS guild_logs_guild_idx ON guild_logs(guild_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS guild_sessions (
      guild_id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS nexyl_sessions (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nexyl_sessions_pkey'
          AND conrelid = 'nexyl_sessions'::regclass
      ) THEN
        ALTER TABLE nexyl_sessions
          ADD CONSTRAINT nexyl_sessions_pkey PRIMARY KEY (sid);
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS nexyl_sessions_expire_idx ON nexyl_sessions (expire);
  `);
}

async function getConfig(guildId) {
  const { rows } = await pool.query('SELECT config FROM guild_configs WHERE guild_id = $1', [guildId]);
  return rows[0]?.config || {};
}

async function setConfig(guildId, config) {
  const { rows } = await pool.query(
    `INSERT INTO guild_configs (guild_id, config, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (guild_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW() RETURNING config`,
    [guildId, JSON.stringify(config)]
  );
  return rows[0].config;
}

async function addWarning(guildId, data = {}) {
  const { rows } = await pool.query(
    `INSERT INTO warnings (guild_id, user_id, user_tag, moderator_id, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [guildId, data.userId || data.user_id || null, data.userTag || data.user_tag || null,
      data.moderatorId || data.moderator_id || null, String(data.reason || 'No reason provided').slice(0, 1000)]
  );
  await addLog(guildId, { type: 'warning', message: `Warning issued to ${data.userTag || data.userId || data.user_id || 'unknown user'}: ${data.reason || 'No reason provided'}`, actorId: data.moderatorId || data.moderator_id });
  return rows[0];
}

async function getWarnings(guildId, limit = 100) {
  const { rows } = await pool.query(
    'SELECT * FROM warnings WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
    [guildId, Math.min(Math.max(Number(limit) || 100, 1), 250)]
  );
  return rows;
}

async function addLog(guildId, data = {}) {
  const { rows } = await pool.query(
    'INSERT INTO guild_logs (guild_id, type, message, actor_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [guildId, String(data.type || 'info').slice(0, 40), String(data.message || '').slice(0, 2000), data.actorId || data.actor_id || null]
  );
  return rows[0];
}

async function getLogs(guildId, limit = 100) {
  const { rows } = await pool.query(
    'SELECT * FROM guild_logs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
    [guildId, Math.min(Math.max(Number(limit) || 100, 1), 250)]
  );
  return rows;
}

async function getSession(guildId) {
  const { rows } = await pool.query('SELECT data FROM guild_sessions WHERE guild_id = $1', [guildId]);
  return rows[0]?.data || {};
}

async function setSession(guildId, data) {
  const { rows } = await pool.query(
    `INSERT INTO guild_sessions (guild_id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW() RETURNING data`,
    [guildId, JSON.stringify(data || {})]
  );
  return rows[0].data;
}

module.exports = { pool, initDb, getConfig, setConfig, addWarning, getWarnings, addLog, getLogs, getSession, setSession };
