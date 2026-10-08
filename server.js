require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------
// Basic setup
// -------------------------

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "dev-secret-change-me",

        resave: false,

        saveUninitialized: false,

        cookie: {
            secure:
                process.env.NODE_ENV === "production",

            httpOnly: true,

            sameSite: "lax",

            maxAge: 86400000
        }
    })
);

// -------------------------
// Static website
// -------------------------

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// -------------------------
// Discord Login
// -------------------------

app.get("/auth/discord", (req, res) => {
    const {
        DISCORD_CLIENT_ID,
        DISCORD_REDIRECT_URI
    } = process.env;

    if (
        !DISCORD_CLIENT_ID ||
        !DISCORD_REDIRECT_URI
    ) {
        return res
            .status(500)
            .send(
                "Discord OAuth is not configured yet."
            );
    }

    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,

        redirect_uri:
            DISCORD_REDIRECT_URI,

        response_type: "code",

        scope: "identify guilds"
    });

    res.redirect(
        "https://discord.com/oauth2/authorize?" +
        params.toString()
    );
});

// -------------------------
// Discord OAuth Callback
// -------------------------

app.get(
    "/auth/callback",
    async (req, res) => {
        try {
            const { code } = req.query;

            const {
                DISCORD_CLIENT_ID,
                DISCORD_CLIENT_SECRET,
                DISCORD_REDIRECT_URI
            } = process.env;

            if (!code) {
                return res.redirect(
                    "/?error=missing_code"
                );
            }

            if (
                !DISCORD_CLIENT_ID ||
                !DISCORD_CLIENT_SECRET ||
                !DISCORD_REDIRECT_URI
            ) {
                return res
                    .status(500)
                    .send(
                        "Discord OAuth is not configured yet."
                    );
            }

            // Exchange authorization code
            // for an access token
            const tokenResponse =
                await fetch(
                    "https://discord.com/api/oauth2/token",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            new URLSearchParams({
                                client_id:
                                    DISCORD_CLIENT_ID,

                                client_secret:
                                    DISCORD_CLIENT_SECRET,

                                grant_type:
                                    "authorization_code",

                                code,

                                redirect_uri:
                                    DISCORD_REDIRECT_URI
                            })
                    }
                );

            const token =
                await tokenResponse.json();

            if (!token.access_token) {
                console.error(
                    "Discord token error:",
                    token
                );

                return res
                    .status(401)
                    .send(
                        "Discord login failed."
                    );
            }

            // Get Discord user
            const userResponse =
                await fetch(
                    "https://discord.com/api/users/@me",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token.access_token}`
                        }
                    }
                );

            const user =
                await userResponse.json();

            // Get Discord servers
            const guildResponse =
                await fetch(
                    "https://discord.com/api/users/@me/guilds",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token.access_token}`
                        }
                    }
                );

            const guilds =
                await guildResponse.json();

            // Save login information
            // into the session
            req.session.user = user;

            req.session.guilds =
                Array.isArray(guilds)
                    ? guilds
                    : [];

            res.redirect(
                "/dashboard.html"
            );
        } catch (error) {
            console.error(
                "Discord OAuth error:",
                error
            );

            res
                .status(500)
                .send(
                    "Discord login error."
                );
        }
    }
);

// -------------------------
// Current User
// -------------------------

app.get("/api/me", (req, res) => {
    res.json({
        user:
            req.session.user ||
            null
    });
});

// -------------------------
// Discord Servers
// -------------------------

app.get("/api/guilds", (req, res) => {
    res.json({
        guilds:
            req.session.guilds ||
            []
    });
});

// -------------------------
// Logout
// -------------------------

app.get("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

// -------------------------
// Guild Configuration
// -------------------------

app.get(
    "/api/config/:guildId",
    (req, res) => {
        const guildId =
            req.params.guildId;

        // Temporary configuration.
        // Later this will connect to
        // the Nexyl bot/database.

        res.json({
            guildId,

            verification: {
                enabled: false,

                channelId: "",

                roleId: ""
            },

            moderation: {
                enabled: true
            },

            sessions: {
                enabled: false,

                serverName: "",

                joinCode: "",

                owner: "",

                channelId: ""
            }
        });
    }
);

// -------------------------
// Save Configuration
// -------------------------

app.post(
    "/api/config/:guildId/:section",
    (req, res) => {
        const allowedSections = [
            "verification",
            "moderation",
            "sessions"
        ];

        const section =
            req.params.section;

        if (
            !allowedSections.includes(
                section
            )
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Invalid configuration section."
                });
        }

        console.log(
            "Dashboard settings received:",
            {
                guildId:
                    req.params.guildId,

                section,

                settings:
                    req.body
            }
        );

        // Temporary response.
        // Later this will save the settings
        // so the actual Nexyl bot can use them.

        res.json({
            ok: true,

            guildId:
                req.params.guildId,

            section,

            settings:
                req.body
        });
    }
);

// -------------------------
// Health Check
// -------------------------

app.get("/health", (req, res) => {
    res.json({
        ok: true
    });
});

// -------------------------
// Website fallback
// -------------------------
//
// IMPORTANT:
// Express 5 uses /{*splat}
// instead of the old "*"

app.get(
    "/{*splat}",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );
    }
);

// -------------------------
// Start Server
// -------------------------

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Nexyl dashboard listening on port ${PORT}`
        );
    }
);
