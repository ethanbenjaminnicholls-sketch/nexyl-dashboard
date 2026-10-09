require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const { pool, initDb, getConfig, setConfig, getWarnings, getLogs } = require("./db");
const { client, startBot } = require("./bot");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Store dashboard login sessions in PostgreSQL.
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

const DISCORD_API = "https://discord.com/api/v10";

async function discordFetch(endpoint, options = {}) {
  const response = await fetch(`${DISCORD_API}${endpoint}`, options);
  const body = await response.text();

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    data = body;
  }

  if (!response.ok) {
    throw new Error(`Discord API returned ${response.status}`);
  }

  return data;
}

function requireLogin(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  next();
}

function isAdministrator(guild) {
  return (BigInt(guild.permissions || "0") & 8n) === 8n;
}

async function getManageableGuilds(accessToken) {
  const guilds = await discordFetch("/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const installedGuildIds = new Set(
    client.guilds.cache.map(guild => guild.id)
  );

  return guilds
    .filter(guild => isAdministrator(guild) && installedGuildIds.has(guild.id))
    .map(guild => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: Boolean(guild.owner)
    }));
}

async function canManageGuild(req, guildId) {
  const guilds = await getManageableGuilds(req.session.accessToken);
  return guilds.some(guild => guild.id === guildId);
}

// Health check for Render.
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nexyl" });
});

// Discord OAuth login.
app.get("/auth/discord", (_req, res) => {
  if (
    !process.env.DISCORD_CLIENT_ID ||
    !process.env.DISCORD_REDIRECT_URI
  ) {
    return res.status(500).send(
      "Discord login is not configured. Check DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI."
    );
  }

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    if (!req.query.code) {
      return res.status(400).send("Missing Discord OAuth code.");
    }

    const required = [
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_REDIRECT_URI"
    ];

    if (required.some(key => !process.env[key])) {
      return res.status(500).send(
        "Discord OAuth environment variables are missing."
      );
    }

    const form = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    });

    const token = await discordFetch("/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });

    req.session.accessToken = token.access_token;

    req.session.save(error => {
      if (error) {
        console.error("Session save error:", error);
        return res.status(500).send("Could not save your login session.");
      }

      res.redirect("/dashboard.html");
    });
  } catch (error) {
    console.error("Discord OAuth error:", error);
    res.status(500).send(
      "Discord login failed. Check your Discord OAuth settings."
    );
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      console.error("Logout error:", error);
      return res.status(500).send("Could not log out.");
    }

    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

// Dashboard user information.
app.get("/api/me", requireLogin, async (req, res) => {
  try {
    const user = await discordFetch("/users/@me", {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`
      }
    });

    res.json(user);
  } catch (error) {
    console.error("Load user error:", error);
    res.status(401).json({ error: "Your Discord session has expired." });
  }
});

// Servers where the user is an administrator and Nexyl is installed.
app.get("/api/guilds", requireLogin, async (req, res) => {
  try {
    res.json(await getManageableGuilds(req.session.accessToken));
  } catch (error) {
    console.error("Load servers error:", error);
    res.status(500).json({ error: "Could not load your servers." });
  }
});

// Load a server's saved settings.
app.get("/api/guild/:id/config", requireLogin, async (req, res) => {
  try {
    if (!(await canManageGuild(req, req.params.id))) {
      return res.status(403).json({
        error: "You cannot manage this server, or Nexyl is not installed."
      });
    }

    res.json(await getConfig(req.params.id));
  } catch (error) {
    console.error("Load configuration error:", error);
    res.status(500).json({ error: "Could not load server settings." });
  }
});

// Save a server's settings.
app.put("/api/guild/:id/config", requireLogin, async (req, res) => {
  try {
    if (!(await canManageGuild(req, req.params.id))) {
      return res.status(403).json({
        error: "You cannot manage this server, or Nexyl is not installed."
      });
    }

    res.json(await setConfig(req.params.id, req.body || {}));
  } catch (error) {
    console.error("Save configuration error:", error);
    res.status(500).json({ error: "Could not save server settings." });
  }
});

// Load warnings for a user in a server.
app.get(
  "/api/guild/:id/warnings/:userId",
  requireLogin,
  async (req, res) => {
    try {
      if (!(await canManageGuild(req, req.params.id))) {
        return res.status(403).json({ error: "You cannot manage this server." });
      }

      res.json(await getWarnings(req.params.id, req.params.userId));
    } catch (error) {
      console.error("Load warnings error:", error);
      res.status(500).json({ error: "Could not load warnings." });
    }
  }
);

// Load a server's logs.
app.get("/api/guild/:id/logs", requireLogin, async (req, res) => {
  try {
    if (!(await canManageGuild(req, req.params.id))) {
      return res.status(403).json({ error: "You cannot manage this server." });
    }

    res.json(await getLogs(req.params.id));
  } catch (error) {
    console.error("Load logs error:", error);
    res.status(500).json({ error: "Could not load logs." });
  }
});

// IMPORTANT:
// The browser needs src/dashboard.js, which uses document.getElementById().
// Do not load that file with require() in Node.js.
app.get("/dashboard.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.js"));
});

// Serve the website files.
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "landing.html"));
});

app.use(express.static(PUBLIC_DIR));

// Start the database, web server, and Discord bot.
async function main() {
  await initDb();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexyl dashboard listening on port ${PORT}`);
  });

  await startBot();
}

main().catch(error => {
  console.error("Nexyl startup failed:", error);
  process.exit(1);
});
