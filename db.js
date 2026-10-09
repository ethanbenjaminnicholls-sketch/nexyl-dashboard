const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : false
});
const defaults = {
  prefix: "!",
  moderation: { enabled: true, logChannelId: "", warnRoleId: "", muteRoleId: "" },
  verification: { enabled: false, channelId: "", roleId: "", message: "Use !verify to verify." },
  tickets: { enabled: false, categoryId: "", supportRoleId: "" },
  antiNuke: { enabled: false, threshold: 5, windowSeconds: 10 },
  giveaways: { enabled: false },
  wordResponses: { enabled: false, responses: {} },
  welcome: { enabled: false, channelId: "", message: "Welcome {user} to {server}!" },
  erlc: { enabled: false, apiKey: "", serverCode: "" }
};
function merge(c={}) {
  const out = { ...defaults, ...c };
  for (const k of Object.keys(defaults)) {
    if (defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k])) out[k] = { ...defaults[k], ...(c[k] || {}) };
  }
  return out;
}
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_configs (guild_id TEXT PRIMARY KEY, config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS warnings (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS warnings_guild_user_idx ON warnings(guild_id, user_id);
    CREATE TABLE IF NOT EXISTS logs (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, action TEXT NOT NULL, user_id TEXT, moderator_id TEXT, details TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS logs_guild_created_idx ON logs(guild_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS sessions (guild_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT FALSE, message_id TEXT, channel_id TEXT, votes JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
}
async function getConfig(id) {
  const r = await pool.query("SELECT config FROM guild_configs WHERE guild_id=$1", [id]);
  return merge(r.rows[0]?.config || {});
}
async function setConfig(id, config) {
  const c = merge(config);
  await pool.query(`INSERT INTO guild_configs(guild_id,config) VALUES($1,$2::jsonb)
    ON CONFLICT(guild_id) DO UPDATE SET config=EXCLUDED.config,updated_at=NOW()`, [id, JSON.stringify(c)]);
  return c;
}
async function addWarning(g,u,m,reason) {
  const r = await pool.query("INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES($1,$2,$3,$4) RETURNING *",[g,u,m,reason]);
  return r.rows[0];
}
async function getWarnings(g,u) {
  return (await pool.query("SELECT * FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC",[g,u])).rows;
}
async function addLog(g,action,u,m,details) {
  await pool.query("INSERT INTO logs(guild_id,action,user_id,moderator_id,details) VALUES($1,$2,$3,$4,$5)",[g,action,u||null,m||null,details||""]);
}
async function getLogs(g) {
  return (await pool.query("SELECT * FROM logs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 150",[g])).rows;
}
async function getSession(g) {
  return (await pool.query("SELECT * FROM sessions WHERE guild_id=$1",[g])).rows[0] || null;
}
async function setSession(g,d) {
  const old = await getSession(g);
  const v = {active:false,message_id:null,channel_id:null,votes:[],...(old||{}),...(d||{})};
  await pool.query(`INSERT INTO sessions(guild_id,active,message_id,channel_id,votes,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW())
    ON CONFLICT(guild_id) DO UPDATE SET active=EXCLUDED.active,message_id=EXCLUDED.message_id,channel_id=EXCLUDED.channel_id,votes=EXCLUDED.votes,updated_at=NOW()`,
    [g,!!v.active,v.message_id,v.channel_id,JSON.stringify(v.votes||[])]);
  return v;
}
module.exports = { pool, initDb, getConfig, setConfig, addWarning, getWarnings, addLog, getLogs, getSession, setSession };
