require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { client, startBot } = require('./bot');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PREMIUM_INVITE = process.env.PREMIUM_INVITE || 'https://discord.gg/Adaq94kmnf';
const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || IS_RENDER;
const PgSessionStore = connectPgSimple(session);
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'nexyl.sid',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret',
  store: new PgSessionStore({ pool: db.pool, tableName: 'nexyl_sessions', createTableIfMissing: false, pruneSessionInterval: 15 * 60 }),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', maxAge: SESSION_MAX_AGE }
}));

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
async function ensureAccessToken(req) {
  if (!req.session.accessToken) throw Object.assign(new Error('Discord login expired. Please sign in again.'), { status: 401 });
  if (Number(req.session.tokenExpiresAt || 0) > Date.now() + 60_000) return req.session.accessToken;
  if (!req.session.refreshToken) throw Object.assign(new Error('Discord login expired. Please sign in again.'), { status: 401 });
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: req.session.refreshToken, redirect_uri: redirectUri })
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token) throw Object.assign(new Error('Discord login expired. Please sign in again.'), { status: 401 });
  req.session.accessToken = tokens.access_token;
  req.session.refreshToken = tokens.refresh_token || req.session.refreshToken;
  req.session.tokenExpiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  return req.session.accessToken;
}
async function userGuilds(req) { return discordFetch(`${DISCORD_API}/users/@me/guilds`, await ensureAccessToken(req)); }
async function manageableGuilds(req) {
  const guilds = await userGuilds(req);
  const botReady = client.isReady();
  return guilds.filter(canManage).map(g => ({
    id: g.id, name: g.name, owner: !!g.owner,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    botInstalled: botReady ? Boolean(client.guilds.cache.get(g.id)) : null,
    botOnline: botReady
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
    if (!client.isReady()) return res.status(503).json({ error: 'The Nexyl bot is offline. Check Render → Environment and make sure DISCORD_TOKEN is set correctly.' });
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
    req.session.refreshToken = tokens.refresh_token || null;
    req.session.tokenExpiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.redirect('/dashboard.html');
  } catch (e) { console.error('[OAUTH] Callback failed:', e.message); res.status(500).send('Could not finish Discord login. Please try again.'); }
}
app.get(['/auth/callback', '/auth/discord/callback'], oauthCallback);

function botInviteUrl(guildId) {
  const { clientId } = oauthConfig();
  const params = new URLSearchParams({ client_id: clientId, scope: 'bot applications.commands', permissions: '1099780148230' });
  if (guildId) { params.set('guild_id', guildId); params.set('disable_guild_select', 'true'); }
  return `https://discord.com/oauth2/authorize?${params}`;
}
app.get('/auth/add-bot', loginRequired, async (req, res) => {
  try {
    const id = req.query.guild_id ? String(req.query.guild_id) : null;
    if (id) {
      const guild = await verifiedGuild(req, id);
      if (!guild) return res.status(403).send('You need Administrator or Manage Server permission to add Nexyl to this server.');
      if (guild.botInstalled === true) return res.redirect('/dashboard.html');
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
    if (config.prefix !== undefined && (typeof config.prefix !== 'string' || !config.prefix.trim() || config.prefix.trim().length > 5 || /\s/.test(config.prefix))) return res.status(400).json({ error: 'The command prefix must be 1–5 characters with no spaces.' });
    if (config.logChannelId !== undefined && config.logChannelId !== '' && !isSnowflake(String(config.logChannelId))) return res.status(400).json({ error: 'Log channel ID must be a valid Discord channel ID.' });
    const saved = await db.setConfig(req.params.guildId, { ...config, prefix: (config.prefix || '!').trim(), logChannelId: config.logChannelId || '' });
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
app.post('/api/tickets/:guildId/panel', loginRequired, requireGuild, async (req, res) => {
  try {
    const config = await db.getConfig(req.params.guildId);
    const ticket = config.ticketSettings || {};
    if (!ticket.enabled) return res.status(400).json({ error: 'Enable tickets and save the settings first.' });
    if (!isSnowflake(String(ticket.panelChannelId || ''))) return res.status(400).json({ error: 'Enter a valid ticket panel channel ID first.' });
    const guild = client.guilds.cache.get(req.params.guildId);
    const channel = await guild.channels.fetch(ticket.panelChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send) return res.status(400).json({ error: 'The panel channel could not be found or is not a text channel.' });
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const embed = new EmbedBuilder().setColor(0x8b7cff).setTitle(String(ticket.panelTitle || 'Open a support ticket').slice(0, 256)).setDescription(String(ticket.panelDescription || 'Click the button below to create a private support ticket.').slice(0, 4000)).setFooter({ text: 'Nexyl Support' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nexyl_ticket_open').setLabel(String(ticket.buttonLabel || 'Create ticket').slice(0, 80)).setStyle(ButtonStyle.Primary));
    await channel.send({ embeds: [embed], components: [row] });
    await db.addLog(req.params.guildId, { type: 'tickets', message: `Ticket panel published in #${channel.name}`, actorId: req.session.discordUser.id });
    res.json({ success: true, channelName: channel.name });
  } catch (e) { console.error('[TICKET PANEL]', e); res.status(500).json({ error: 'Could not publish the ticket panel. Check Nexyl permissions and Render logs.' }); }
});
app.post('/api/verification/:guildId/panel', loginRequired, requireGuild, async (req, res) => {
  try {
    const config = await db.getConfig(req.params.guildId);
    const verification = config.verificationSettings || {};
    if (!verification.enabled) return res.status(400).json({ error: 'Enable verification and save settings first.' });
    if (!isSnowflake(String(verification.channelId || '')) || !isSnowflake(String(verification.roleId || ''))) return res.status(400).json({ error: 'Enter valid verification channel and role IDs first.' });
    const guild = client.guilds.cache.get(req.params.guildId);
    const channel = await guild.channels.fetch(verification.channelId).catch(() => null);
    const role = await guild.roles.fetch(verification.roleId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send) return res.status(400).json({ error: 'Verification channel was not found or is not a text channel.' });
    if (!role) return res.status(400).json({ error: 'The verified member role was not found in this server.' });
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= botMember.roles.highest.position) return res.status(400).json({ error: 'Give Nexyl Manage Roles permission and move its bot role above the verified role.' });
    const embed = new EmbedBuilder().setColor(0x8b7cff).setTitle(String(verification.title || 'Verify your account').slice(0, 256)).setDescription(String(verification.description || 'Click the button below to receive the verified member role.').slice(0, 3000)).setFooter({ text: 'Nexyl Verification' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nexyl_verify_member').setLabel('Verify').setStyle(ButtonStyle.Success));
    await channel.send({ embeds: [embed], components: [row] });
    await db.addLog(req.params.guildId, { type: 'verification', message: `Verification panel published in #${channel.name}`, actorId: req.session.discordUser.id });
    res.json({ success: true, channelName: channel.name });
  } catch (e) { console.error('[VERIFY PANEL]', e); res.status(500).json({ error: 'Could not publish the verification panel. Check Nexyl permissions and Render logs.' }); }
});
app.get('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json(await db.getSession(req.params.guildId)); } catch (e) { console.error('[SESSION GET]', e.message); res.status(500).json({ error: 'Could not load session settings.' }); } });
app.put('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { const data = req.body?.data || {}; res.json({ success: true, data: await db.setSession(req.params.guildId, data) }); } catch (e) { console.error('[SESSION PUT]', e.message); res.status(500).json({ error: 'Could not save session settings.' }); } });
app.post('/api/session/:guildId', loginRequired, requireGuild, async (req, res) => { try { res.json({ success: true, data: await db.setSession(req.params.guildId, req.body?.data || req.body || {}) }); } catch (e) { console.error('[SESSION POST]', e.message); res.status(500).json({ error: 'Could not save session settings.' }); } });
app.get('/api/premium', (req, res) => res.json({ invite: PREMIUM_INVITE }));
app.get('/health', (req, res) => res.json({ status: 'ok', botReady: client.isReady(), uptime: Math.floor(process.uptime()) }));
app.use((err, req, res, next) => { console.error('[EXPRESS]', err); if (res.headersSent) return next(err); res.status(500).json({ error: 'Unexpected server error.' }); });

async function start() {
  if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
    console.error('[SECURITY] SESSION_SECRET is missing. Set a long random secret in Render → Environment.');
    process.exit(1);
  }
  if (!process.env.DISCORD_TOKEN) console.error('[BOT] DISCORD_TOKEN is missing in Render → Environment; website will run but bot commands will not work.');
  try { await db.initDb(); console.log('[DB] Database ready.'); } catch (e) { console.error('[DB] Database startup failed:', e); process.exit(1); }
  app.listen(PORT, '0.0.0.0', () => console.log(`[WEB] Nexyl dashboard listening on ${PORT}`));
  try { await startBot(); } catch (e) { console.error('[BOT] Bot failed to start:', e.message); }
}
if (require.main === module) start();
module.exports = app;

