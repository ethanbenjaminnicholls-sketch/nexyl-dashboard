const PREMIUM_INVITE = 'https://discord.gg/Adaq94kmnf';
const $ = (selector) => document.querySelector(selector);
const panel = $('#main-panel');
const notice = $('#notice');
const serverSelect = $('#server-select');
let guilds = [];
let selectedGuildId = '';
let activeView = 'overview';
let currentConfig = {};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function showNotice(message, type = '') {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.classList.remove('hidden');
}
function hideNotice() { notice.classList.add('hidden'); }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.href = '/auth/discord'; throw new Error('Please sign in again.'); }
  if (!response.ok) {
    // Expose failed API calls in DevTools so errors are diagnosable instead of silent.
    console.error('[NEXYL DASHBOARD API]', { url, status: response.status, response: data });
    if (response.status === 409 && data.addBotUrl) showNotice(`${data.error} Use the Add Nexyl button on this server.`, 'error');
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}
function selectedGuild() { return guilds.find(g => g.id === selectedGuildId); }
function heading(title, subtitle, action = '') {
  return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${action}</div>`;
}
function noServerView() {
  panel.innerHTML = `${heading('Your dashboard', 'Manage your Nexyl servers from one place.')}<section class="empty-state"><h2>No manageable servers found</h2><p>Sign in with the Discord account that owns a server or has Administrator / Manage Server permission. If you just changed permissions, refresh the list.</p><div class="button-row"><button class="button" id="empty-refresh">Refresh servers</button><a class="button button-secondary" href="/auth/add-bot">Add Nexyl to a server</a></div></section><section class="panel"><h2>Premium community</h2><p>Join the Nexyl Premium Discord for updates.</p><a class="button button-secondary" href="${PREMIUM_INVITE}" target="_blank" rel="noopener noreferrer">Join Premium ↗</a></section>`;
  $('#empty-refresh')?.addEventListener('click', loadGuilds);
}
function botOfflineView(guild) {
  panel.innerHTML = `${heading('Nexyl is offline', 'Your servers loaded, but the bot has not connected to Discord yet.')}<section class="empty-state"><h2>${escapeHtml(guild.name)}</h2><p>This does not mean Nexyl is missing from your server. The dashboard cannot verify installation until the bot starts. Check Render → Environment for <code>DISCORD_TOKEN</code>, then refresh this page.</p><div class="button-row"><button class="button" id="retry-bot-status">Check again</button><a class="button button-secondary" href="/health" target="_blank" rel="noopener noreferrer">View service health</a></div></section><section class="panel"><h2>Premium community</h2><a class="text-link" href="${PREMIUM_INVITE}" target="_blank" rel="noopener noreferrer">Join Premium →</a></section>`;
  $('#retry-bot-status')?.addEventListener('click', loadGuilds);
}
function notInstalledView(guild) {
  panel.innerHTML = `${heading('Connect your server', 'Nexyl needs to be added before you can configure this server.')}<div class="server-card">${guild.icon ? `<img class="server-icon" src="${escapeHtml(guild.icon)}" alt="">` : '<div class="server-icon"></div>'}<div><h2>${escapeHtml(guild.name)}</h2><p>${guild.owner ? 'Server owner' : 'You have permission to manage this server'}</p><span class="pill">Nexyl not installed</span></div></div><section class="empty-state"><h2>Finish setting up Nexyl</h2><p>Use the button below to open Discord's official bot authorization screen. Check that the selected server is correct and approve the requested permissions.</p><div class="button-row"><a class="button" href="/auth/add-bot?guild_id=${encodeURIComponent(guild.id)}">Add Nexyl to ${escapeHtml(guild.name)}</a><button class="button button-secondary" id="refresh-after-add">I've added Nexyl — refresh</button></div></section><section class="panel"><h2>Premium community</h2><p>Need updates or help? Join the Nexyl Premium Discord.</p><a class="text-link" href="${PREMIUM_INVITE}" target="_blank" rel="noopener noreferrer">Join Premium →</a></section>`;
  $('#refresh-after-add')?.addEventListener('click', loadGuilds);
}
function overviewView(guild) {
  panel.innerHTML = `${heading('Overview', `Welcome to the dashboard for ${guild.name}.`)}<div class="grid-two"><section class="panel"><h2>Server connection</h2><p>Nexyl is installed in this server. Use the sidebar to configure staff permissions, fixed-role assignment, verification, word responses, warnings, tickets, audit logs, and session details.</p><span class="pill">Connected to Nexyl</span></section><section class="panel"><h2>Moderation commands</h2><p><code>/warn</code> or <code>!warn @user [reason]</code></p><p><code>/role</code> or <code>!role @user</code> (configured role)</p><p><code>/kick</code> or <code>!kick @user [reason]</code></p><p><code>/ban</code> or <code>!ban @user [reason]</code></p><p><code>/help</code> or <code>!help</code></p></section></div><section class="panel"><h2>Premium community</h2><p>Join the Nexyl Premium Discord for announcements and community support.</p><a class="button button-secondary" href="${PREMIUM_INVITE}" target="_blank" rel="noopener noreferrer">Join Premium ↗</a></section>`;
}
async function settingsView(guild) {
  panel.innerHTML = `${heading('Server settings', 'Changes are saved to the database for this server.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading settings…</p></div></section>`;
  const config = await api(`/api/config/${guild.id}`);
  currentConfig = config || {};
  panel.innerHTML = `${heading('Server settings', 'Changes are saved to the database for this server.')}<form id="settings-form" class="panel"><div class="grid-two"><div class="field"><label for="prefix">Command prefix</label><input id="prefix" maxlength="5" value="${escapeHtml(currentConfig.prefix || '!')}" required></div><div class="field"><label for="log-channel">Log channel ID (optional)</label><input id="log-channel" value="${escapeHtml(currentConfig.logChannelId || '')}" placeholder="Channel ID"></div></div><p class="muted">These settings are connected to the running bot. The command prefix is used by commands, and the log channel receives moderation events.</p><div class="button-row"><button class="button" type="submit">Save settings</button><button class="button button-secondary" type="button" id="reload-settings">Discard changes</button></div></form>`;
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault(); hideNotice();
    const next = { ...currentConfig, prefix: $('#prefix').value.trim() || '!', logChannelId: $('#log-channel').value.trim() };
    try { await api(`/api/config/${guild.id}`, { method: 'PUT', body: JSON.stringify({ config: next }) }); currentConfig = next; showNotice('Settings saved successfully.', 'success'); }
    catch (e) { showNotice(e.message, 'error'); }
  });
  $('#reload-settings').addEventListener('click', () => renderView('settings'));
}
async function listView(guild, type) {
  const isWarnings = type === 'warnings';
  const title = isWarnings ? 'Warnings' : 'Audit logs';
  panel.innerHTML = `${heading(title, isWarnings ? 'Recent warnings recorded by Nexyl.' : 'Recent dashboard and moderation events.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading ${title.toLowerCase()}…</p></div></section>`;
  const rows = await api(`/api/${isWarnings ? 'warnings' : 'logs'}/${guild.id}`);
  const items = Array.isArray(rows) ? rows : [];
  panel.innerHTML = `${heading(title, isWarnings ? 'Recent warnings recorded by Nexyl.' : 'Recent dashboard and moderation events.')}<section class="panel"><div class="button-row" style="margin-top:0;margin-bottom:16px"><button class="button button-secondary" id="refresh-list">Refresh</button></div>${items.length ? `<div class="data-list">${items.map(item => `<article class="data-item"><strong>${escapeHtml(isWarnings ? (item.user_tag || item.user_id || 'Member warning') : (item.type || 'Event'))}</strong><p>${escapeHtml(isWarnings ? item.reason : item.message)}</p><time>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : '')}${item.moderator_id || item.actor_id ? ` · Actor: ${escapeHtml(item.moderator_id || item.actor_id)}` : ''}</time></article>`).join('')}</div>` : '<p>No records found for this server yet.</p>'}</section>`;
  $('#refresh-list').addEventListener('click', () => renderView(type));
}
async function warningsView(guild) {
  panel.innerHTML = `${heading('Warnings', 'Configure how Nexyl handles warnings, and review recent warning records.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading warning settings…</p></div></section>`;
  const [config, rows] = await Promise.all([api(`/api/config/${guild.id}`), api(`/api/warnings/${guild.id}`)]);
  currentConfig = config || {};
  const action = ['none', 'kick', 'ban'].includes(currentConfig.warningAction) ? currentConfig.warningAction : 'none';
  panel.innerHTML = `${heading('Warnings', 'Configure warning notifications and optional automatic actions.')}<form id="warnings-form" class="panel"><h2>Warning system</h2><label class="checkbox-row"><input id="warning-dm" type="checkbox" ${currentConfig.warningDmEnabled !== false ? 'checked' : ''}> Send a direct message to the warned member</label><div class="grid-two"><div class="field"><label for="warning-threshold">Warnings before automatic action (0 disables)</label><input id="warning-threshold" type="number" min="0" max="100" value="${escapeHtml(currentConfig.warningThreshold ?? 0)}"></div><div class="field"><label for="warning-action">Action at threshold</label><select id="warning-action"><option value="none" ${action === 'none' ? 'selected' : ''}>No automatic action</option><option value="kick" ${action === 'kick' ? 'selected' : ''}>Kick member</option><option value="ban" ${action === 'ban' ? 'selected' : ''}>Ban member</option></select></div></div><p class="muted">Automatic kick/ban only runs when enabled, the member reaches the threshold, and Nexyl has the required Discord permissions and role position. Set the threshold to 0 to disable it.</p><div class="button-row"><button class="button" type="submit">Save warning settings</button></div></form><section class="panel"><div class="panel-heading-row"><h2>Recent warnings</h2><span class="pill">${rows.length} records</span></div>${rows.length ? `<div class="data-list">${rows.map(item => `<article class="data-item"><strong>${escapeHtml(item.user_tag || item.user_id || 'Member warning')}</strong><p>${escapeHtml(item.reason || 'No reason provided')}</p><time>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : '')}${item.moderator_id ? ` · Moderator ID: ${escapeHtml(item.moderator_id)}` : ''}</time></article>`).join('')}</div>` : '<p>No warnings have been recorded for this server yet.</p>'}</section>`;
  $('#warnings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const threshold = Number($('#warning-threshold').value);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) return showNotice('Threshold must be a whole number from 0 to 100.', 'error');
    const next = { ...currentConfig, warningDmEnabled: $('#warning-dm').checked, warningThreshold: threshold, warningAction: $('#warning-action').value };
    try { await api(`/api/config/${guild.id}`, { method: 'PUT', body: JSON.stringify({ config: next }) }); currentConfig = next; showNotice('Warning settings saved.', 'success'); }
    catch (e) { showNotice(e.message, 'error'); }
  });
}
async function ticketsView(guild) {
  panel.innerHTML = `${heading('Tickets', 'Set up a private support-ticket system for your Discord server.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading ticket settings…</p></div></section>`;
  const config = await api(`/api/config/${guild.id}`);
  currentConfig = config || {};
  const t = currentConfig.ticketSettings || {};
  panel.innerHTML = `${heading('Tickets', 'Configure your ticket panel, private channels, and support team.')}<form id="tickets-form" class="panel"><label class="checkbox-row"><input id="tickets-enabled" type="checkbox" ${t.enabled ? 'checked' : ''}> Enable ticket creation</label><div class="grid-two"><div class="field"><label for="ticket-panel-channel">Panel channel ID</label><input id="ticket-panel-channel" value="${escapeHtml(t.panelChannelId || '')}" placeholder="Channel where members open tickets" required></div><div class="field"><label for="ticket-category">Ticket category ID (optional)</label><input id="ticket-category" value="${escapeHtml(t.categoryId || '')}" placeholder="Category for private ticket channels"></div><div class="field"><label for="ticket-support-role">Support role ID (optional)</label><input id="ticket-support-role" value="${escapeHtml(t.supportRoleId || '')}" placeholder="Role that can see tickets"></div><div class="field"><label for="ticket-transcript-channel">Transcript / archive channel ID (optional)</label><input id="ticket-transcript-channel" value="${escapeHtml(t.transcriptChannelId || '')}" placeholder="Closed ticket transcripts are sent here when configured"></div></div><div class="field"><label for="ticket-title">Panel title</label><input id="ticket-title" maxlength="256" value="${escapeHtml(t.panelTitle || 'Open a support ticket')}" required></div><div class="field"><label for="ticket-description">Panel description</label><textarea id="ticket-description" maxlength="4000">${escapeHtml(t.panelDescription || 'Click the button below to create a private support ticket.')}</textarea></div><div class="field"><label for="ticket-button-label">Button label</label><input id="ticket-button-label" maxlength="80" value="${escapeHtml(t.buttonLabel || 'Create ticket')}" required></div><p class="muted">Nexyl creates a private channel for each member and adds a Close ticket button. Give the bot Manage Channels and permission to view/send messages in your ticket category. IDs can be copied in Discord with Developer Mode enabled.</p><div class="button-row"><button class="button" type="submit">Save ticket settings</button><button class="button button-secondary" id="publish-ticket-panel" type="button">Publish ticket panel to Discord</button></div></form><section class="panel"><h2>How it works</h2><p>1. Choose a text channel for the public panel and save the settings.</p><p>2. Click <strong>Publish ticket panel to Discord</strong>.</p><p>3. Members click the panel button to create a private ticket. The opener or support staff can close it when finished.</p></section>`;
  $('#tickets-form').addEventListener('submit', async event => {
    event.preventDefault();
    const next = { ...currentConfig, ticketSettings: { enabled: $('#tickets-enabled').checked, panelChannelId: $('#ticket-panel-channel').value.trim(), categoryId: $('#ticket-category').value.trim(), supportRoleId: $('#ticket-support-role').value.trim(), transcriptChannelId: $('#ticket-transcript-channel').value.trim(), panelTitle: $('#ticket-title').value.trim(), panelDescription: $('#ticket-description').value.trim(), buttonLabel: $('#ticket-button-label').value.trim() } };
    if (!next.ticketSettings.panelChannelId) return showNotice('Enter the channel ID where the ticket panel should be posted.', 'error');
    try { await api(`/api/config/${guild.id}`, { method: 'PUT', body: JSON.stringify({ config: next }) }); currentConfig = next; showNotice('Ticket settings saved.', 'success'); }
    catch (e) { showNotice(e.message, 'error'); }
  });
  $('#publish-ticket-panel').addEventListener('click', async () => {
    try {
      const next = { ...currentConfig, ticketSettings: { enabled: $('#tickets-enabled').checked, panelChannelId: $('#ticket-panel-channel').value.trim(), categoryId: $('#ticket-category').value.trim(), supportRoleId: $('#ticket-support-role').value.trim(), transcriptChannelId: $('#ticket-transcript-channel').value.trim(), panelTitle: $('#ticket-title').value.trim(), panelDescription: $('#ticket-description').value.trim(), buttonLabel: $('#ticket-button-label').value.trim() } };
      await api(`/api/config/${guild.id}`, { method: 'PUT', body: JSON.stringify({ config: next }) });
      currentConfig = next;
      const result = await api(`/api/tickets/${guild.id}/panel`, { method: 'POST', body: JSON.stringify({}) });
      showNotice(`Ticket panel published in #${result.channelName}.`, 'success');
    } catch (e) { showNotice(e.message, 'error'); }
  });
}

async function sessionsView(guild) {
  panel.innerHTML = `${heading('Session setup', 'Fill in the server details once. These are the details shown when you configure or announce a session.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading session setup…</p></div></section>`;
  const data = await api(`/api/session/${guild.id}`);
  panel.innerHTML = `${heading('Session setup', 'Simple guided setup — enter the owner and Roblox server details below.')}<form id="session-form" class="panel">
    <h2>Server owner</h2><div class="field"><label for="session-owner-id">Server owner Discord user ID</label><input id="session-owner-id" inputmode="numeric" value="${escapeHtml(data.ownerUserId || '')}" placeholder="e.g. 123456789012345678"><span class="field-help">In Discord, enable Developer Mode, right-click the owner’s profile, then choose Copy User ID.</span></div>
    <div class="field"><label for="session-owner-name">Server owner display name (optional)</label><input id="session-owner-name" maxlength="100" value="${escapeHtml(data.ownerName || '')}" placeholder="Owner name shown in announcements"></div>
    <div class="section-note">Roblox server details</div><div class="field"><label for="session-roblox-username">Roblox username</label><input id="session-roblox-username" maxlength="100" value="${escapeHtml(data.robloxUsername || '')}" placeholder="Enter the Roblox username"></div>
    <div class="field"><label for="session-game-name">In-game server name</label><input id="session-game-name" maxlength="120" value="${escapeHtml(data.gameServerName || '')}" placeholder="e.g. Baymont State Roleplay"></div>
    <div class="field"><label for="session-title">Session announcement title</label><input id="session-title" maxlength="120" value="${escapeHtml(data.title || '')}" placeholder="e.g. Official server session"></div>
    <div class="field"><label for="session-description">Extra details (optional)</label><textarea id="session-description" maxlength="2000" placeholder="Add any instructions or notes">${escapeHtml(data.description || '')}</textarea></div>
    <label class="checkbox-row"><input id="session-enabled" type="checkbox" ${data.enabled ? 'checked' : ''}> Mark session setup as enabled</label>
    <div class="button-row"><button class="button" type="submit">Save session setup</button><button class="button button-secondary" id="session-discard" type="button">Reload saved details</button></div>
  </form><section class="panel"><h2>What these fields mean</h2><p><strong>Discord user ID</strong> identifies the owner reliably. <strong>Roblox username</strong> is the account name, and <strong>in-game server name</strong> is the name you want displayed for the roleplay server.</p></section>`;
  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const ownerUserId = $('#session-owner-id').value.trim();
    if (ownerUserId && !/^\d{17,20}$/.test(ownerUserId)) return showNotice('Discord user IDs should contain 17–20 digits. Leave it blank if you do not know it yet.', 'error');
    const next = { ownerUserId, ownerName: $('#session-owner-name').value.trim(), robloxUsername: $('#session-roblox-username').value.trim(), gameServerName: $('#session-game-name').value.trim(), title: $('#session-title').value.trim(), description: $('#session-description').value.trim(), enabled: $('#session-enabled').checked };
    try { await api(`/api/session/${guild.id}`, { method: 'PUT', body: JSON.stringify({ data: next }) }); showNotice('Session setup saved.', 'success'); }
    catch (e) { showNotice(e.message, 'error'); }
  });
  $('#session-discard').addEventListener('click', () => renderView('sessions'));
}
async function saveGuildConfig(guild, next, successMessage) {
  try { await api(`/api/config/${guild.id}`, { method: 'PUT', body: JSON.stringify({ config: next }) }); currentConfig = next; showNotice(successMessage, 'success'); }
  catch (e) { showNotice(e.message, 'error'); }
}
async function staffView(guild) {
  const config = await api(`/api/config/${guild.id}`); currentConfig = config || {};
  panel.innerHTML = `${heading('Staff permissions', 'Let one staff role use Nexyl moderation commands in this server.')}<form id="staff-form" class="panel"><h2>Staff role</h2><div class="field"><label for="staff-role-id">Staff member role ID</label><input id="staff-role-id" inputmode="numeric" value="${escapeHtml(config.staffRoleId || '')}" placeholder="Paste the Discord role ID"><span class="field-help">Enable Developer Mode in Discord, right-click the role in Server Settings → Roles, then Copy Role ID.</span></div><div class="section-note">Members with this role can use <code>!warn</code>, <code>!kick</code>, <code>!ban</code>, and <code>!role</code> without needing the matching Discord permission themselves. Nexyl still needs the required bot permissions and role hierarchy. Server administrators continue to work as normal.</div><div class="button-row"><button class="button" type="submit">Save staff role</button><button class="button button-secondary" id="staff-clear" type="button">Clear role</button></div></form>`;
  $('#staff-form').addEventListener('submit', async e => { e.preventDefault(); const id=$('#staff-role-id').value.trim(); if(id && !/^\d{17,20}$/.test(id)) return showNotice('Enter a valid Discord role ID (17–20 digits).','error'); await saveGuildConfig(guild,{...currentConfig,staffRoleId:id},'Staff permissions saved.'); });
  $('#staff-clear').addEventListener('click', async () => { $('#staff-role-id').value=''; await saveGuildConfig(guild,{...currentConfig,staffRoleId:''},'Staff role cleared.'); });
}
async function roleCommandView(guild) {
  const config = await api(`/api/config/${guild.id}`); currentConfig = config || {};
  panel.innerHTML = `${heading('Role command', 'Choose the specific role that Nexyl gives members when staff use the role command.')}<form id="role-command-form" class="panel"><div class="field"><label for="role-command-id">Role to assign (role ID)</label><input id="role-command-id" inputmode="numeric" value="${escapeHtml(config.roleCommandRoleId || '')}" placeholder="Paste the role ID to assign"><span class="field-help">This is the one fixed role for the simple command. Copy its ID from Discord with Developer Mode enabled.</span></div><label class="checkbox-row"><input id="role-command-enabled" type="checkbox" ${config.roleCommandEnabled !== false ? 'checked' : ''}> Enable the configured role shortcut</label><div class="section-note">When enabled and a role ID is saved, staff can use <code>!role @member</code> to assign that role. If no fixed role is configured, the existing <code>!role @member @role</code> form remains available.</div><div class="button-row"><button class="button" type="submit">Save role command</button></div></form>`;
  $('#role-command-form').addEventListener('submit', async e => { e.preventDefault(); const id=$('#role-command-id').value.trim(); if(id && !/^\d{17,20}$/.test(id)) return showNotice('Enter a valid Discord role ID (17–20 digits).','error'); await saveGuildConfig(guild,{...currentConfig,roleCommandRoleId:id,roleCommandEnabled:$('#role-command-enabled').checked},'Role command settings saved.'); });
}
async function verificationView(guild) {
  const config = await api(`/api/config/${guild.id}`); currentConfig = config || {}; const v=config.verificationSettings || {};
  panel.innerHTML = `${heading('Verify setup', 'Configure a verification channel and the role verified members should receive.')}<form id="verification-form" class="panel"><label class="checkbox-row"><input id="verify-enabled" type="checkbox" ${v.enabled ? 'checked' : ''}> Enable verification button</label><div class="field"><label for="verify-channel-id">Verification channel ID</label><input id="verify-channel-id" inputmode="numeric" value="${escapeHtml(v.channelId || '')}" placeholder="Channel ID where the verify panel goes"></div><div class="field"><label for="verify-role-id">Verified member role ID</label><input id="verify-role-id" inputmode="numeric" value="${escapeHtml(v.roleId || '')}" placeholder="Role given after clicking Verify"></div><div class="field"><label for="verify-title">Panel title</label><input id="verify-title" maxlength="256" value="${escapeHtml(v.title || 'Verify your account')}"></div><div class="field"><label for="verify-description">Panel message</label><textarea id="verify-description" maxlength="3000">${escapeHtml(v.description || 'Click the button below to receive the verified member role.')}</textarea></div><div class="section-note">Nexyl needs Manage Roles and Send Messages. Move Nexyl’s bot role above the verified member role. Publishing posts a button to the selected channel.</div><div class="button-row"><button class="button" type="submit">Save verification</button><button class="button button-secondary" type="button" id="publish-verify">Publish verification panel</button></div></form>`;
  const read = () => ({...currentConfig,verificationSettings:{enabled:$('#verify-enabled').checked,channelId:$('#verify-channel-id').value.trim(),roleId:$('#verify-role-id').value.trim(),title:$('#verify-title').value.trim(),description:$('#verify-description').value.trim()}});
  $('#verification-form').addEventListener('submit', async e => { e.preventDefault(); const next=read(); if(next.verificationSettings.enabled && (!/^\d{17,20}$/.test(next.verificationSettings.channelId)||!/^\d{17,20}$/.test(next.verificationSettings.roleId))) return showNotice('Enter valid channel and role IDs before enabling verification.','error'); await saveGuildConfig(guild,next,'Verification settings saved.'); });
  $('#publish-verify').addEventListener('click', async () => { const next=read(); if(!/^\d{17,20}$/.test(next.verificationSettings.channelId)||!/^\d{17,20}$/.test(next.verificationSettings.roleId)) return showNotice('Enter a valid verification channel ID and role ID first.','error'); next.verificationSettings.enabled=true; try { await api(`/api/config/${guild.id}`,{method:'PUT',body:JSON.stringify({config:next})}); currentConfig=next; const result=await api(`/api/verification/${guild.id}/panel`,{method:'POST',body:JSON.stringify({})}); showNotice(`Verification panel published in #${result.channelName}.`,'success'); } catch(e) { showNotice(e.message,'error'); } });
}
async function wordResponsesView(guild) {
  const config = await api(`/api/config/${guild.id}`); currentConfig=config||{}; const entries=Object.entries(currentConfig.wordResponses||{});
  panel.innerHTML = `${heading('Word responses', 'Make Nexyl reply automatically when a message contains a trigger phrase.')}<form id="word-form" class="panel"><div class="field"><label for="word-trigger">Trigger phrase</label><input id="word-trigger" maxlength="100" placeholder="e.g. !rules or hello" required></div><div class="field"><label for="word-response">Response</label><textarea id="word-response" maxlength="1800" placeholder="What Nexyl should say when it sees the trigger" required></textarea></div><div class="button-row"><button class="button" type="submit">Add word response</button></div><p class="muted">Matching is case-insensitive and uses phrase inclusion. Keep responses under 1,800 characters. Avoid triggers that appear in ordinary words if you do not want frequent replies.</p></form><section class="panel"><div class="panel-heading-row"><h2>Saved triggers</h2><span class="pill">${entries.length} configured</span></div>${entries.length?`<div class="data-list">${entries.map(([trigger,response])=>`<article class="data-item"><strong>${escapeHtml(trigger)}</strong><p>${escapeHtml(response)}</p><div class="button-row"><button type="button" class="button button-secondary delete-word" data-trigger="${escapeHtml(trigger)}">Remove trigger</button></div></article>`).join('')}</div>`:'<p>No word responses configured yet.</p>'}</section>`;
  $('#word-form').addEventListener('submit',async e=>{e.preventDefault();const trigger=$('#word-trigger').value.trim();const response=$('#word-response').value.trim();if(!trigger||!response)return showNotice('Enter both a trigger and a response.','error');const next={...currentConfig,wordResponses:{...(currentConfig.wordResponses||{}),[trigger]:response}};await saveGuildConfig(guild,next,'Word response saved.');if(!notice.classList.contains('hidden')&&notice.classList.contains('success')){await renderView('word-responses');showNotice('Word response saved.','success');}});
  document.querySelectorAll('.delete-word').forEach(button=>button.addEventListener('click',async()=>{const words={...(currentConfig.wordResponses||{})};delete words[button.dataset.trigger];await saveGuildConfig(guild,{...currentConfig,wordResponses:words},'Word response removed.');await renderView('word-responses');showNotice('Word response removed.','success');}));
}

async function renderView(view = activeView) {
  activeView = view;
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  hideNotice();
  const guild = selectedGuild();
  if (!guild) return noServerView();
  if (guild.botInstalled === null) return botOfflineView(guild);
  if (guild.botInstalled === false) return notInstalledView(guild);
  try {
    if (view === 'settings') return await settingsView(guild);
    if (view === 'warnings') return await warningsView(guild);
    if (view === 'staff') return await staffView(guild);
    if (view === 'role-command') return await roleCommandView(guild);
    if (view === 'verification') return await verificationView(guild);
    if (view === 'word-responses') return await wordResponsesView(guild);
    if (view === 'tickets') return await ticketsView(guild);
    if (view === 'logs') return await listView(guild, 'logs');
    if (view === 'sessions') return await sessionsView(guild);
    return overviewView(guild);
  } catch (e) {
    // This catch previously hid the exception from DevTools, leaving only a generic message.
    console.error(`[NEXYL DASHBOARD VIEW] Failed to render \"${view}\"`, e);
    panel.innerHTML = `${heading('Something went wrong', 'The dashboard could not load this section.')}<section class="empty-state"><p>${escapeHtml(e?.message || 'Unknown dashboard error.')}</p><button id="retry-view" class="button">Try again</button></section>`;
    $('#retry-view')?.addEventListener('click', () => renderView(view));
  }
}
async function loadGuilds() {
  serverSelect.innerHTML = '<option value="">Loading servers…</option>';
  panel.innerHTML = '<section class="loading-panel"><div class="spinner"></div><p>Loading your servers…</p></section>';
  try {
    const me = await api('/api/me');
    if (!me.loggedIn) { window.location.href = '/auth/discord'; return; }
    $('#user-name').textContent = me.user?.global_name || me.user?.username || 'Discord user';
    guilds = await api('/api/guilds');
    serverSelect.innerHTML = '';
    if (!guilds.length) { serverSelect.innerHTML = '<option value="">No manageable servers</option>'; selectedGuildId = ''; return noServerView(); }
    for (const guild of guilds) {
      const option = document.createElement('option');
      option.value = guild.id;
      option.textContent = `${guild.name} — ${guild.botInstalled === true ? 'Nexyl installed' : guild.botInstalled === false ? 'Add Nexyl' : 'Bot offline'}`;
      serverSelect.appendChild(option);
    }
    if (!guilds.some(g => g.id === selectedGuildId)) selectedGuildId = guilds[0].id;
    serverSelect.value = selectedGuildId;
    await renderView(activeView);
  } catch (e) {
    serverSelect.innerHTML = '<option value="">Could not load servers</option>';
    panel.innerHTML = `${heading('Could not load servers', 'Check your Discord login and try refreshing.')}<section class="empty-state"><p>${escapeHtml(e.message)}</p><div class="button-row"><button class="button" id="retry-guilds">Try again</button><a class="button button-secondary" href="/auth/discord">Sign in with Discord</a></div></section>`;
    $('#retry-guilds')?.addEventListener('click', loadGuilds);
  }
}
serverSelect.addEventListener('change', () => { selectedGuildId = serverSelect.value; renderView('overview'); });
$('#refresh-servers').addEventListener('click', loadGuilds);
document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => renderView(button.dataset.view)));
loadGuilds();
