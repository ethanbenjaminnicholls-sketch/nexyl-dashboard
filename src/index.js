require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { client, startBot } = require('./bot');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PREMIUM_INVITE = process.env.PREMIUM_INVITE || 'https://discord.gg/Adaq94kmnf';
const DISCORD_API = 'https://discord.com/api/v10';
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ name: 'nexyl.sid', secret: process.env.SESSION_SECRET || 'CHANGE_ME_SESSION_SECRET_BEFORE_DEPLOYING', resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 } }));

function oauthConfig() {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) throw new Error('DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be configured.');
  return { clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET, redirectUri: process.env.DISCORD_REDIRECT_URI || 'https://nexyl-dashboard.onrender.com/auth/callback' };
}
function isSnowflake(id) { return typeof id === 'string' && /^\d{17,20}$/.test(id); }
function canManage(guild) {
  if (guild?.owner) return true;
  try { const p = BigInt(guild?.permissions || '0'); return (p & 8n) === 8n || (p & 32n) === 32n; } catch { return false; }
}
function loginRequired(req, res, next) {
  if (!req.session?.discordUser || !req.session?.accessToken) return res.status(401).json({ error: 'Please sign in with Discord.', loginUrl: '/auth/discord' });
  next();
}
async function discordFetch(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const e = new Error(data.message || `Discord returned ${response.status}`); e.status = response.status; throw e; }
  return data;
}
async function userGuilds(req) { return discordFetch(`${DISCORD_API}/users/@me/guilds`, req.session.accessToken); }
async function manageableGuilds(req) {
  const guilds = await userGuilds(req);
  return guilds.filter(canManage).map(g => ({
    id: g.id, name: g.name, owner: !!g.owner,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    botInstalled: !!client.guilds.cache.get(g.id), botOnline: !!client.isReady()
  }));
}
async function verifiedGuild(req, guildId) {
  if (!isSnowflake(guildId)) return null;
  const list = await manageableGuilds(req);
  return list.find(g => g.id === guildId) || null;
}
async function requireGuild(req, res, next) {
  try {
    const id = req.params.guildId || req.body.guildId;
    const guild = await verifiedGuild(req, id);
    if (!guild) return res.status(403).json({ error: 'You must own this server or have Administrator/Manage Server permission.' });
    if (!guild.botInstalled) return res.status(409).json({ error: 'Nexyl is not installed in this server yet.', botInstalled: false, addBotUrl: `/auth/add-bot?guild_id=${id}` });
    req.guild = guild;
    next();
  } catch (e) { console.error('[AUTH] Guild check:', e.message); res.status(e.status || 500).json({ error: 'Could not verify server permissions. Please sign in again.' }); }
}

app.get('/', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(PUBLIC_DIR, 'landing.html')); });
app.get(['/dashboard', '/dashboard.html'], (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')); });
app.get('/dashboard.js', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('application/javascript').sendFile(path.join(__dirname, 'dashboard.js')); });
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', etag: true }));

app.get('/auth/discord', (req, res) => {
  try {
    const { clientId, redirectUri } = oauthConfig();
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify guilds', state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  } catch (e) { console.error('[OAUTH]', e.message); res.status(500).send('Discord login is not configured. Check Render environment variables.'); }
});

async function oauthCallback(req, res) {
  try {
    if (req.query.error) return res.redirect('/?login=cancelled');
    const { code, state } = req.query;
    if (!code || !state || !req.session.oauthState || state !== req.session.oauthState) return res.status(400).send('Login could not be verified. Please return to the website and try again.');
    delete req.session.oauthState;
    const { clientId, clientSecret, redirectUri } = oauthConfig();
    const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri }) });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) { console.error('[OAUTH] Token exchange failed:', tokens); return res.status(401).send('Discord login failed. Check your OAuth redirect URL in the Developer Portal and Render.'); }
    const user = await discordFetch(`${DISCORD_API}/users/@me`, tokens.access_token);
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.discordUser = { id: user.id, username: user.username, global_name: user.global_name || user.username, avatar: user.avatar || null };
    req.session.accessToken = tokens.access_token;
    req.session.tokenExpiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.redirect('/dashboard.html');
  } catch (e) { console.error('[OAUTH] Callback failed:', e.message); res.status(500).send('Could not finish Discord login. Please try again.'); }
}
app.get(['/auth/callback', '/auth/discord/callback'], oauthCallback);

function botInviteUrl(guildId) {
  const { clientId } = oauthConfig();
  const params = new URLSearchParams({ client_id: clientId, scope: 'bot applications.commands', permissions: '8' });
  if (guildId) { params.set('guild_id', guildId); params.set('disable_guild_select', 'true'); }
  return `https://discord.com/oauth2/authorize?${params}`;
}
app.get('/auth/add-bot', loginRequired, async (req, res) => {
  try {
    const id = req.query.guild_id ? String(req.query.guild_id) : null;
    if (id) {
      const guild = await verifiedGuild(req, id);
      if (!guild) return res.status(403).send('You need Administrator or Manage Server permission to add Nexyl to this server.');
      if (guild.botInstalled) return res.redirect('/dashboard.html');
    }
    res.redirect(botInviteUrl(id || undefined));
  } catch (e) { console.error('[BOT INVITE]', e.message); res.status(500).send('Could not create the bot invite. Check DISCORD_CLIENT_ID.'); }
});

app.get('/api/me', (req, res) => res.json({ loggedIn: !!req.session.discordUser, user: req.session.discordUser || null }));
app.get('/api/user', loginRequired, (req, res) => res.json(req.session.discordUser));
app.get('/logout', (req, res) => req.session.destroy(() => { res.clearCookie('nexyl.sid'); res.redirect('/'); }));
app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('nexyl.sid'); res.json({ success: true }); }));
app.get('/api/guilds', loginRequired, async (req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await manageableGuilds(req)); }
  catch (e) { console.error('[GUILDS]', e.message); res.status(e.status || 500).json({ error: 'Could not load your servers. Sign out and back in, then try again.' }); }
});

app.get('/api/config/:guildId', loginRequired, requireGuild, async (req, res) => {
  try { res.json(await db.getConfig(req.params.guildId)); } catch (e) { console.error('[CONFIG GET]', e.message); res.status(500).json({ error: 'Could not load settings.' }); }
});
app.put('/api/config/:guildId', loginRequired, requireGuild, async (req, res) => {
  try {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return res.status(400).json({ error: 'Send a config object.' });
    const saved = await db.setConfig(req.params.guildId, config);
    await db.addLog(req.params.guildId, { type: 'settings', message: 'Dashboard settings updated', actorId: req.session.discordUser.id });
    res.json({ success: true, config: saved });
  } catch (e) { console.error('[CONFIG PUT]', e.message); res.status(500).json({ error: 'Could not save settings.' }); }
});
app.post('/api/config/:guildId', loginRequired, requireGuild, async (req, res) => {
  try { const config = req.body?.config || {}; const saved = await db.setConfig(req.params.guildId, config); res.json({ success: true, config: saved }); }
  catch (e) { console.error('[CONFIG POST]', e.message); res.status(500).json({ error: 'Could not save settings.' }); }
});
app.get('/api/warnings/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json(await db.getWarnings(req.params.guildId)); } catch (e) { console.error('[WARNINGS]', e.message); res.status(500).json({ error: 'Could not load warnings.' }); } });
app.get('/api/logs/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json(await db.getLogs(req.params.guildId)); } catch (e) { console.error('[LOGS]', e.message); res.status(500).json({ error: 'Could not load logs.' }); } });
app.get('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json(await db.getSession(req.params.guildId)); } catch (e) { console.error('[SESSION GET]', e.message); res.status(500).json({ error: 'Could not load session settings.' }); } });
app.put('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { const data = req.body?.data || {}; res.json({ success: true, data: await db.setSession(req.params.guildId, data) }); } catch (e) { console.error('[SESSION PUT]', e.message); res.status(500).json({ error: 'Could not save session settings.' }); } });
app.post('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json({ success: true, data: await db.setSession(req.params.guildId, req.body?.data || req.body || {}) }); } catch (e) { console.error('[SESSION POST]', e.message); res.status(500).json({ error: 'Could not save session settings.' }); } });
app.get('/api/premium', (req, res) => res.json({ invite: PREMIUM_INVITE }));
app.get('/health', (req, res) => res.json({ status: 'ok', botReady: client.isReady(), uptime: Math.floor(process.uptime()) }));
app.use((err, req, res, next) => { console.error('[EXPRESS]', err); if (res.headersSent) return next(err); res.status(500).json({ error: 'Unexpected server error.' }); });

async function start() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'CHANGE_ME_SESSION_SECRET_BEFORE_DEPLOYING') console.warn('[SECURITY] Set a long random SESSION_SECRET in Render.');
  try { await db.initDb(); console.log('[DB] Database ready.'); } catch (e) { console.error('[DB] Database startup failed:', e); process.exit(1); }
  app.listen(PORT, '0.0.0.0', () => console.log(`[WEB] Nexyl dashboard listening on ${PORT}`));
  try { await startBot(); } catch (e) { console.error('[BOT] Bot failed to start:', e.message); }
}
if (require.main === module) start();
module.exports = app;
