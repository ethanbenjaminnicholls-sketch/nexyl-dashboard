require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// Serve the dashboard
app.use(express.static(path.join(__dirname, 'public')));


/* ============================================================
   DISCORD LOGIN
============================================================ */

app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send(
      'Discord OAuth is not configured yet.'
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds'
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});


/* ============================================================
   DISCORD OAUTH CALLBACK
============================================================ */

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!code) {
      return res.redirect('/?error=missing_code');
    }

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send(
        'Discord OAuth is not configured yet.'
      );
    }

    // Exchange authorization code for token
    const tokenResponse = await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        })
      }
    );

    const token = await tokenResponse.json();

    if (!token.access_token) {
      console.error(
        'Discord token response:',
        token
      );

      return res.status(401).send(
        'Discord login failed.'
      );
    }

    // Get Discord user
    const userResponse = await fetch(
      'https://discord.com/api/users/@me',
      {
        headers: {
          Authorization:
            `Bearer ${token.access_token}`
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).send(
        'Could not retrieve your Discord account.'
      );
    }

    const user = await userResponse.json();

    // Get Discord servers
    const guildResponse = await fetch(
      'https://discord.com/api/users/@me/guilds',
      {
        headers: {
          Authorization:
            `Bearer ${token.access_token}`
        }
      }
    );

    let guilds = [];

    if (guildResponse.ok) {
      guilds = await guildResponse.json();
    }

    if (!Array.isArray(guilds)) {
      guilds = [];
    }

    // Save login information
    req.session.user = user;
    req.session.guilds = guilds;

    req.session.save((error) => {
      if (error) {
        console.error(
          'Session save error:',
          error
        );

        return res.status(500).send(
          'Could not save your Discord session.'
        );
      }

      res.redirect('/dashboard.html');
    });

  } catch (error) {
    console.error(
      'Discord OAuth error:',
      error
    );

    res.status(500).send(
      'Discord login error.'
    );
  }
});


/* ============================================================
   CURRENT USER
============================================================ */

app.get('/api/me', (req, res) => {
  res.json({
    user: req.session.user || null
  });
});


/* ============================================================
   DISCORD SERVERS
============================================================ */

app.get('/api/guilds', (req, res) => {
  res.json({
    guilds: req.session.guilds || []
  });
});


/* ============================================================
   LOGOUT
============================================================ */

app.get('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error(
        'Logout error:',
        error
      );
    }

    res.redirect('/');
  });
});


/* ============================================================
   GET SERVER CONFIG
============================================================ */

app.get('/api/config/:guildId', (req, res) => {
  const guildId = req.params.guildId;

  res.json({
    guildId: guildId,

    verification: {
      enabled: false,
      channelId: null,
      roleId: null
    },

    moderation: {
      enabled: true
    },

    sessions: {
      enabled: false,
      serverName: '',
      joinCode: '',
      owner: '',
      channelId: null
    }
  });
});


/* ============================================================
   UPDATE SERVER CONFIG
============================================================ */

app.post(
  '/api/config/:guildId/:section',
  (req, res) => {
    const guildId = req.params.guildId;
    const section = req.params.section;

    const allowedSections = [
      'verification',
      'moderation',
      'sessions'
    ];

    if (!allowedSections.includes(section)) {
      return res.status(400).json({
        error: 'Invalid configuration section.'
      });
    }

    console.log(
      'Dashboard configuration update:',
      {
        guildId,
        section,
        settings: req.body
      }
    );

    res.json({
      ok: true,
      guildId: guildId,
      section: section,
      settings: req.body
    });
  }
);


/* ============================================================
   HEALTH CHECK
============================================================ */

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Nexyl Dashboard',
    version: '1.0.1'
  });
});


/* ============================================================
   FRONTEND FALLBACK
============================================================ */

/*
   IMPORTANT:

   This is the ONLY wildcard route in this file.

   Express 5 requires:
       /{*splat}

   Do NOT use:
       app.get('*', ...)
*/

app.get('/{*splat}', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );
});


/* ============================================================
   START SERVER
============================================================ */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Nexyl Dashboard listening on port ${PORT}`
    );
  }
);
