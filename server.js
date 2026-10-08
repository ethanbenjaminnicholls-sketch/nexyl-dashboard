require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 86400000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/auth/discord', (req, res) => {
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) return res.status(500).send('Discord OAuth is not configured yet.');
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds'
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;
    if (!code) return res.redirect('/?error=missing_code');
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) return res.status(500).send('Discord OAuth is not configured yet.');

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI })
    });
    const token = await tokenResponse.json();
    if (!token.access_token) return res.status(401).send('Discord login failed.');

    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const user = await userResponse.json();
    const guildResponse = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const guilds = await guildResponse.json();

    req.session.user = user;
    req.session.guilds = Array.isArray(guilds) ? guilds : [];
    res.redirect('/dashboard.html');
  } catch (e) {
    console.error(e);
    res.status(500).send('Discord login error.');
  }
});

app.get('/{*splat}', (req, res) => { res.json({ user: req.session.user || null }));
app.get('/api/guilds', (req, res) => res.json({ guilds: req.session.guilds || [] }));
app.get('/api/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/api/config/:guildId', (req, res) => {
  res.json({ guildId: req.params.guildId, verification: {}, moderation: {}, sessions: {} });
});

app.post('/api/config/:guildId/:section', (req, res) => {
  const allowed = ['verification', 'moderation', 'sessions'];
  if (!allowed.includes(req.params.section)) return res.status(400).json({ error: 'Invalid section' });
  // Dashboard API scaffold. Connect this to Nexyl's persistent config/API next.
  res.json({ ok: true, guildId: req.params.guildId, section: req.params.section, settings: req.body });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Nexyl dashboard listening on ${PORT}`));
