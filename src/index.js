
require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const {
  pool,
  initDb,
  getConfig,
  setConfig,
  getWarnings,
  getLogs
} = require("./db");

const { client, startBot } = require("./bot");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DISCORD_API = "https://discord.com/api/v10";

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
    throw new Error(
      `Discord API returned ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function requireLogin(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Owners, Administrators and users with Manage Server can manage a server.
// Nexyl must also be installed in that server.
async function getManageableGuilds(accessToken) {
  const userGuilds = await discordFetch("/users/@me/guilds", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!client.isReady()) {
    throw new Error(
      "Nexyl's Discord bot is not ready yet. Check the Render logs."
    );
  }

  // Fetch the bot's current guild list instead of relying only on
  // a possibly stale cache.
  const botGuilds = await client.guilds.fetch();
  const botGuildIds = new Set(
    [...botGuilds.values()].map(guild => guild.id)
  );

  return userGuilds
    .filter(guild => {
      const permissions = BigInt(guild.permissions || "0");

      const isOwner = Boolean(guild.owner);
      const isAdministrator = (permissions & 8n) === 8n;
      const canManageServer = (permissions & 32n) === 32n;

      return (
        (isOwner || isAdministrator || canManageServer) &&
        botGuildIds.has(guild.id)
      );
    })
    .map(guild => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: Boolean(guild.owner)
    }));
}

async function canManageGuild(req, guildId) {
  const guilds = await getManageableGuilds(
    req.session.accessToken
  );
  return guilds.some(guild => guild.id === guildId);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nexyl" });
});

// Begin Discord login.
app.get("/auth/discord", (_req, res) => {
  const required = [
    "DISCORD_CLIENT_ID",
    "DISCORD_REDIRECT_URI"
  ];

  if (required.some(key => !process.env[key])) {
    return res.status(500).send(
      "Discord login is not configured. Check DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI in Render."
    );
  }

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds"
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

// Finish Discord login. Both callback paths are supported.
async function discordCallback(req, res) {
  try {
    if (req.query.error) {
      return res.status(400).send(
        `Discord login was cancelled or denied: ${String(req.query.error)}`
      );
    }

    if (!req.query.code) {
      return res.status(400).send(
        "Missing Discord OAuth code. Please log in again."
      );
    }

    const required = [
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_REDIRECT_URI"
    ];

    if (required.some(key => !process.env[key])) {
      return res.status(500).send(
        "Discord OAuth environment variables are missing in Render."
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
      body: form.toString()
    });

    if (!token.access_token) {
      throw new Error("Discord did not return an access token.");
    }

    req.session.accessToken = token.access_token;

    req.session.save(error => {
      if (error) {
        console.error("Session save error:", error);
        return res.status(500).send(
          "Could not save your login session. Please try again."
        );
      }

      res.redirect("/dashboard.html");
    });
  } catch (error) {
    console.error("Discord OAuth error:", error);
    res.status(500).send(
      "Discord login failed. Check the Render logs and OAuth settings."
    );
  }
}

app.get("/auth/callback", discordCallback);
app.get("/auth/discord/callback", discordCallback);

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

// Current Discord user.
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
    res.status(401).json({
      error: "Your Discord session has expired. Please log in again."
    });
  }
});

// Manageable servers.
app.get("/api/guilds", requireLogin, async (req, res) => {
  try {
    res.json(await getManageableGuilds(req.session.accessToken));
  } catch (error) {
    console.error("Load servers error:", error);
    res.status(500).json({
      error: "Could not load your servers. Check the Render logs."
    });
  }
});

// Load server settings.
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
    res.status(500).json({
      error: "Could not load server settings."
    });
  }
});

// Save server settings.
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
    res.status(500).json({
      error: "Could not save server settings."
    });
  }
});

// Load warnings.
app.get(
  "/api/guild/:id/warnings/:userId",
  requireLogin,
  async (req, res) => {
    try {
      if (!(await canManageGuild(req, req.params.id))) {
        return res.status(403).json({
          error: "You cannot manage this server."
        });
      }

      res.json(
        await getWarnings(req.params.id, req.params.userId)
      );
    } catch (error) {
      console.error("Load warnings error:", error);
      res.status(500).json({
        error: "Could not load warnings."
      });
    }
  }
);

// Load server logs.
app.get("/api/guild/:id/logs", requireLogin, async (req, res) => {
  try {
    if (!(await canManageGuild(req, req.params.id))) {
      return res.status(403).json({
        error: "You cannot manage this server."
      });
    }

    res.json(await getLogs(req.params.id));
  } catch (error) {
    console.error("Load logs error:", error);
    res.status(500).json({
      error: "Could not load logs."
    });
  }
});

// Serve the browser-side JavaScript from src/dashboard.js.
// This route must be registered before express.static().
app.get("/dashboard.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.js"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "landing.html"));
});

app.use(express.static(PUBLIC_DIR));

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

