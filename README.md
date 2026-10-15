# Nexyl dashboard and Discord bot

This is the complete Nexyl project. Do not upload only `index.js` and `bot.js`: the dashboard also needs `src/db.js`, `src/dashboard.js`, the HTML/CSS in `public/`, and `package.json`.

## Deploy on Render
1. Replace the project files in your GitHub repository with the files in this folder.
2. Keep the existing Render service connected to that repository and deploy the latest commit.
3. Keep the existing PostgreSQL database attached. Do not delete or recreate it.
4. Confirm these Render environment variables are set:
   - `DATABASE_URL`
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `DISCORD_REDIRECT_URI` = `https://nexyl-dashboard.onrender.com/auth/callback`
   - `SESSION_SECRET` = a long random secret
   - `PREMIUM_INVITE` = `https://discord.gg/Adaq94kmnf`
5. In Discord Developer Portal → OAuth2, ensure the redirect URL exactly matches `DISCORD_REDIRECT_URI`.
6. After deployment, open `https://nexyl-dashboard.onrender.com/health`. It should return JSON with `status: "ok"`.

## Important
- Keep `src/db.js` and the `nexyl_sessions` table setup. Do not delete the existing database.
- Dashboard management APIs only allow server owners or members with Administrator / Manage Server permission, and only for servers where Nexyl is installed.
- Failed actions should now show a more useful error. If an action still fails, the page shows a reference ID when available; search Render logs for the matching error.
- Run `npm run check` to check JavaScript syntax before deployment.
