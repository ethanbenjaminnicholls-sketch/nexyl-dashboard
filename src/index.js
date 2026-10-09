
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");

const {
  initDb,
  getConfig,
  setConfig,
  addWarning,
  getWarnings,
  addLog,
  getLogs,
  getSession,
  setSession,
} = require("./db");

const { client, startBot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PREMIUM_INVITE =
  process.env.PREMIUM_INVITE || "https://discord.gg/Adaq94kmnf";

const DISCORD_API = "https://discord.com/api/v10";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "nexyl.sid",
    secret: process.env.SESSION_SECRET || "replace-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// --------------------------------------------------
// Environment configuration
// --------------------------------------------------

function getDiscordConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    "https://nexyl-dashboard.onrender.com/auth/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be configured."
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function getBotInviteUrl(guildId) {
  const { clientId } = getDiscordConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: "8",
  });

  if (guildId) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function hasManagePermission(guild) {
  if (!guild) return false;

  if (guild.owner === true) return true;

  try {
    const permissions = BigInt(guild.permissions || "0");
    const ADMINISTRATOR = 8n;
    const MANAGE_GUILD = 32n;

    return (
      (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
      (permissions & MANAGE_GUILD) === MANAGE_GUILD
    );
  } catch {
    return false;
  }
}

function getCachedBotGuild(guildId) {
  if (!client || !client.guilds) return null;
  return client.guilds.cache.get(guildId) || null;
}

// --------------------------------------------------
// Login/session helpers
// --------------------------------------------------

function requireLogin(req, res, next) {
  if (!req.session || !req.session.discordUser || !req.session.accessToken) {
    return res.status(401).json({
      error: "You must log in with Discord first.",
      loginUrl: "/auth/discord",
    });
  }

  next();
}

async function discordRequest(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || `Discord returned HTTP ${response.status}.`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getUserGuilds(accessToken) {
  return discordRequest(`${DISCORD_API}/users/@me/guilds`, accessToken);
}

/*
 * Important:
 * Do NOT filter the user's manageable servers against the bot's guild cache.
 * Doing so hides servers where the user can add Nexyl.
 */
async function getUserManageableGuilds(accessToken) {
  const guilds = await getUserGuilds(accessToken);

  return guilds
    .filter(hasManagePermission)
    .map((guild) => {
      const botGuild = getCachedBotGuild(guild.id);

      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon
          ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
          : null,
        owner: guild.owner === true,
        permissions: guild.permissions,
        botInstalled: Boolean(botGuild),
        botOnline: Boolean(botGuild && client.isReady()),
      };
    });
}

async function findManageableGuild(req, guildId) {
  if (!isSnowflake(guildId)) return null;

  const guilds = await getUserManageableGuilds(req.session.accessToken);
  return guilds.find((guild) => guild.id === guildId) || null;
}

async function requireManageableGuild(req, res, next) {
  try {
    const guildId = req.params.guildId || req.body.guildId;

    if (!isSnowflake(guildId)) {
      return res.status(400).json({ error: "A valid server ID is required." });
    }

    const guild = await findManageableGuild(req, guildId);

    if (!guild) {
      return res.status(403).json({
        error: "You do not have permission to manage this server.",
      });
    }

    if (!guild.botInstalled) {
      return res.status(409).json({
        error: "Nexyl has not been added to this server yet.",
        botInstalled: false,
        addBotUrl: `/auth/add-bot?guild_id=${guildId}`,
      });
    }

    req.manageableGuild = guild;
    next();
  } catch (error) {
    console.error("Server permission check failed:", error.message);
    res.status(error.status || 500).json({
      error: "Could not verify your server permissions.",
    });
  }
}

// --------------------------------------------------
// Landing page and static files
// --------------------------------------------------

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "landing.html"));
});

app.get("/dashboard", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

app.get("/dashboard.html", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

app.get("/dashboard.js", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "dashboard.js"));
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: "1h",
  })
);

// --------------------------------------------------
// Discord OAuth login
// --------------------------------------------------

app.get("/auth/discord", (req, res) => {
  try {
    const { clientId, redirectUri } = getDiscordConfig();
    const state = crypto.randomBytes(24).toString("hex");

    req.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state,
    });

    res.redirect(
      `https://discord.com/oauth2/authorize?${params.toString()}`
    );
  } catch (error) {
    console.error("Discord login setup failed:", error.message);
    res.status(500).send("Discord login is not configured correctly.");
  }
});

// Keep both callback paths working with your Discord application settings.
async function handleDiscordCallback(req, res) {
  try {
    const { clientId, clientSecret, redirectUri } = getDiscordConfig();
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect("/?login=cancelled");
    }

    if (
      !code ||
      !state ||
      !req.session.oauthState ||
      state !== req.session.oauthState
    ) {
      return res.status(400).send(
        "Discord login could not be verified. Please return to the dashboard and try again."
      );
    }

    delete req.session.oauthState;

    const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });

    const tokens = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Discord token exchange failed:", tokens);
      return res.status(401).send(
        "Discord login failed. Check the OAuth redirect URL in the Discord Developer Portal and Render."
      );
    }

    const user = await discordRequest(
      `${DISCORD_API}/users/@me`,
      tokens.access_token
    );

    // Regenerate the session after login to reduce session-fixation risk.
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.discordUser = {
      id: user.id,
      username: user.username,
      global_name: user.global_name || user.username,
      avatar: user.avatar || null,
    };

    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token || null;
    req.session.tokenExpiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    res.redirect("/dashboard.html");
  } catch (error) {
    console.error("Discord callback failed:", error.message);
    res.status(500).send(
      "Something went wrong while signing in with Discord. Please try again."
    );
  }
}

app.get("/auth/callback", handleDiscordCallback);
app.get("/auth/discord/callback", handleDiscordCallback);

// --------------------------------------------------
// Add Nexyl to a server
// --------------------------------------------------

app.get("/auth/add-bot", requireLogin, async (req, res) => {
  try {
    const guildId = req.query.guild_id;

    if (guildId) {
      if (!isSnowflake(guildId)) {
        return res.status(400).send("Invalid server ID.");
      }

      const guild = await findManageableGuild(req, guildId);

      if (!guild) {
        return res.status(403).send(
          "You must own the server or have Administrator/Manage Server permission to add Nexyl."
        );
      }

      if (guild.botInstalled) {
        return res.redirect("/dashboard.html");
      }
    }

    res.redirect(getBotInviteUrl(guildId ? String(guildId) : undefined));
  } catch (error) {
    console.error("Add bot route failed:", error.message);
    res.status(500).send("Could not prepare the Nexyl invitation.");
  }
});

// --------------------------------------------------
// Current user and logout
// --------------------------------------------------

app.get("/api/me", (req, res) => {
  if (!req.session.discordUser) {
    return res.json({ loggedIn: false, user: null });
  }

  res.json({
    loggedIn: true,
    user: req.session.discordUser,
  });
});

app.get("/api/user", (req, res) => {
  if (!req.session.discordUser) {
    return res.status(401).json({ error: "Not logged in." });
  }

  res.json(req.session.discordUser);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nexyl.sid");
    res.redirect("/");
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nexyl.sid");
    res.json({ success: true });
  });
});

// --------------------------------------------------
// Manageable server list
// --------------------------------------------------

app.get("/api/guilds", requireLogin, async (req, res) => {
  try {
    const guilds = await getUserManageableGuilds(req.session.accessToken);

    res.set("Cache-Control", "no-store");
    res.json(guilds);
  } catch (error) {
    console.error("Could not load server list:", error.message);
    res.status(error.status || 500).json({
      error: "Could not load your Discord servers. Please sign in again.",
    });
  }
});

// --------------------------------------------------
// Dashboard configuration
// --------------------------------------------------

app.get(
  "/api/config/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const config = await getConfig(req.params.guildId);
      res.json(config || {});
    } catch (error) {
      console.error("Could not load server config:", error.message);
      res.status(500).json({ error: "Could not load server settings." });
    }
  }
);

app.post(
  "/api/config/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const guildId = req.params.guildId;
      const config = req.body.config || req.body;

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return res.status(400).json({ error: "Invalid configuration." });
      }

      await setConfig(guildId, config);

      res.json({ success: true, config });
    } catch (error) {
      console.error("Could not save server config:", error.message);
      res.status(500).json({ error: "Could not save server settings." });
    }
  }
);

// Compatibility endpoint for dashboards that send guildId in the body.
app.post(
  "/api/config",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const guildId = req.body.guildId;
      const config = req.body.config || {};

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return res.status(400).json({ error: "Invalid configuration." });
      }

      await setConfig(guildId, config);
      res.json({ success: true, config });
    } catch (error) {
      console.error("Could not save server config:", error.message);
      res.status(500).json({ error: "Could not save server settings." });
    }
  }
);

// --------------------------------------------------
// Warnings
// --------------------------------------------------

app.get(
  "/api/warnings/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const warnings = await getWarnings(req.params.guildId);
      res.json(warnings || []);
    } catch (error) {
      console.error("Could not load warnings:", error.message);
      res.status(500).json({ error: "Could not load warnings." });
    }
  }
);

app.post(
  "/api/warnings/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      await addWarning(req.params.guildId, req.body);
      res.json({ success: true });
    } catch (error) {
      console.error("Could not add warning:", error.message);
      res.status(500).json({ error: "Could not add warning." });
    }
  }
);

// --------------------------------------------------
// Logs
// --------------------------------------------------

app.get(
  "/api/logs/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const logs = await getLogs(req.params.guildId);
      res.json(logs || []);
    } catch (error) {
      console.error("Could not load logs:", error.message);
      res.status(500).json({ error: "Could not load logs." });
    }
  }
);

app.post(
  "/api/logs/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      await addLog(req.params.guildId, req.body);
      res.json({ success: true });
    } catch (error) {
      console.error("Could not add log:", error.message);
      res.status(500).json({ error: "Could not add log." });
    }
  }
);

// --------------------------------------------------
// Sessions
// --------------------------------------------------

app.get(
  "/api/session/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      const sessionData = await getSession(req.params.guildId);
      res.json(sessionData || {});
    } catch (error) {
      console.error("Could not load session data:", error.message);
      res.status(500).json({ error: "Could not load session data." });
    }
  }
);

app.post(
  "/api/session/:guildId",
  requireLogin,
  requireManageableGuild,
  async (req, res) => {
    try {
      await setSession(req.params.guildId, req.body);
      res.json({ success: true });
    } catch (error) {
      console.error("Could not save session data:", error.message);
      res.status(500).json({ error: "Could not save session data." });
    }
  }
);

// --------------------------------------------------
// Premium and health
// --------------------------------------------------

app.get("/api/premium", (req, res) => {
  res.json({ invite: PREMIUM_INVITE });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    botReady: Boolean(client && client.isReady()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    botReady: Boolean(client && client.isReady()),
  });
});

// --------------------------------------------------
// Error handling
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  if (res.headersSent) return next(err);

  res.status(500).json({ error: "An unexpected server error occurred." });
});

// --------------------------------------------------
// Start the web server and bot
// --------------------------------------------------

async function start() {
  try {
    await initDb();
    console.log("Database initialised.");
  } catch (error) {
    console.error("Database initialisation failed:", error);
    process.exit(1);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexyl dashboard listening on port ${PORT}`);
  });

  try {
    await startBot();
    console.log("Nexyl bot startup requested.");
  } catch (error) {
    console.error("Nexyl bot failed to start:", error);
  }
}

start();

module.exports = app;

