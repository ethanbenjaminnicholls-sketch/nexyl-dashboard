# Nexyl Dashboard — fixed project files

This is a replacement project for the Nexyl Discord moderation bot and its dashboard.

## Folder layout

```text
nexyl-dashboard/
├── public/
│   ├── landing.html
│   ├── dashboard.html
│   └── style.css
├── src/
│   ├── index.js
│   ├── bot.js
│   ├── dashboard.js
│   └── db.js
├── package.json
└── README.md
```

`package-lock.json` is optional for this project. Run `npm install` from the folder containing `package.json` and npm will create one.

## Required Render environment variables

Set these in Render → your `nexyl-dashboard` service → Environment. Do not put secrets in GitHub.

- `DISCORD_TOKEN` — the bot token from Discord Developer Portal → Bot. Required for bot commands.
- `DISCORD_CLIENT_ID` — the application's Application ID.
- `DISCORD_CLIENT_SECRET` — OAuth2 client secret.
- `DISCORD_REDIRECT_URI` — `https://nexyl-dashboard.onrender.com/auth/callback`
- `DATABASE_URL` — PostgreSQL connection string.
- `SESSION_SECRET` — a long random secret. Generate one locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PREMIUM_INVITE` — `https://discord.gg/Adaq94kmnf`

In Discord Developer Portal → OAuth2 → Redirects, add the exact redirect URI above. In Developer Portal → Bot, enable **Message Content Intent** and **Server Members Intent** so prefix commands and member moderation work.

## Deploy

1. Extract this ZIP.
2. Copy the contents into the root of the GitHub repository, keeping the `public` and `src` folders.
3. Keep your Render environment variables; never commit `.env` or bot tokens.
4. Commit and push the updated files to the `main` branch. Render is configured to deploy from `main` using `npm install` and `npm start`.
5. Wait for Render to finish deploying, then open `https://nexyl-dashboard.onrender.com/health`.
6. Sign in at `https://nexyl-dashboard.onrender.com/dashboard.html` and hard-refresh with Ctrl+F5 if the browser has cached old files.

## Features in this package

- Discord OAuth sign-in and server permission checks.
- Lists servers the signed-in user owns or can manage, even if Nexyl has not been installed yet.
- Shows a distinct bot-offline state rather than falsely claiming Nexyl is not installed when the bot has not connected.
- `!warn`, `!role`, `!ban`, `!kick`, and `!help` commands.
- Per-server command prefix setting; the saved prefix is used by the bot.
- Optional audit-log channel ID; moderation events are sent to that channel and stored in PostgreSQL.
- PostgreSQL-backed configuration, warnings, logs, session data, and persistent web sessions.
- Correct Premium invite everywhere: `https://discord.gg/Adaq94kmnf`.

The Sessions page currently saves session configuration in the database; it does not itself send session start/vote/end announcements. Run `npm run check` to check JavaScript syntax locally.


## Redesigned website

The public landing page and authenticated dashboard have been redesigned with a responsive dark workspace, violet/blue accents, refreshed navigation, server selector, moderation panels, and mobile layouts. The redesign preserves the existing dashboard API calls and IDs used by the client-side functionality.
