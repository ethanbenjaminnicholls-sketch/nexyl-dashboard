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
  panel.innerHTML = `${heading('Overview', `Welcome to the dashboard for ${guild.name}.`)}<div class="grid-two"><section class="panel"><h2>Server connection</h2><p>Nexyl is installed in this server. Select a section from the sidebar to manage settings, warnings, audit logs, and sessions.</p><span class="pill">Connected to Nexyl</span></section><section class="panel"><h2>Moderation commands</h2><p><code>!warn @user [reason]</code></p><p><code>!role @user @role</code></p><p><code>!kick @user [reason]</code></p><p><code>!ban @user [reason]</code></p><p><code>!help</code></p></section></div><section class="panel"><h2>Premium community</h2><p>Join the Nexyl Premium Discord for announcements and community support.</p><a class="button button-secondary" href="${PREMIUM_INVITE}" target="_blank" rel="noopener noreferrer">Join Premium ↗</a></section>`;
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
  panel.innerHTML = `${heading('Tickets', 'Configure your ticket panel, private channels, and support team.')}<form id="tickets-form" class="panel"><label class="checkbox-row"><input id="tickets-enabled" type="checkbox" ${t.enabled ? 'checked' : ''}> Enable ticket creation</label><div class="grid-two"><div class="field"><label for="ticket-panel-channel">Panel channel ID</label><input id="ticket-panel-channel" value="${escapeHtml(t.panelChannelId || '')}" placeholder="Channel where members open tickets" required></div><div class="field"><label for="ticket-category">Ticket category ID (optional)</label><input id="ticket-category" value="${escapeHtml(t.categoryId || '')}" placeholder="Category for private ticket channels"></div><div class="field"><label for="ticket-support-role">Support role ID (optional)</label><input id="ticket-support-role" value="${escapeHtml(t.supportRoleId || '')}" placeholder="Role that can see tickets"></div><div class="field"><label for="ticket-transcript-channel">Transcript / archive channel ID (optional)</label><input id="ticket-transcript-channel" value="${escapeHtml(t.transcriptChannelId || '')}" placeholder="Reserved for future transcript support"></div></div><div class="field"><label for="ticket-title">Panel title</label><input id="ticket-title" maxlength="256" value="${escapeHtml(t.panelTitle || 'Open a support ticket')}" required></div><div class="field"><label for="ticket-description">Panel description</label><textarea id="ticket-description" maxlength="4000">${escapeHtml(t.panelDescription || 'Click the button below to create a private support ticket.')}</textarea></div><div class="field"><label for="ticket-button-label">Button label</label><input id="ticket-button-label" maxlength="80" value="${escapeHtml(t.buttonLabel || 'Create ticket')}" required></div><p class="muted">Nexyl creates a private channel for each member and adds a Close ticket button. Give the bot Manage Channels and permission to view/send messages in your ticket category. IDs can be copied in Discord with Developer Mode enabled.</p><div class="button-row"><button class="button" type="submit">Save ticket settings</button><button class="button button-secondary" id="publish-ticket-panel" type="button">Publish ticket panel to Discord</button></div></form><section class="panel"><h2>How it works</h2><p>1. Choose a text channel for the public panel and save the settings.</p><p>2. Click <strong>Publish ticket panel to Discord</strong>.</p><p>3. Members click the panel button to create a private ticket. The opener or support staff can close it when finished.</p></section>`;
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
  panel.innerHTML = `${heading('Sessions', 'Save session configuration for this server.')}<section class="panel"><div class="loading-panel"><div class="spinner"></div><p>Loading session settings…</p></div></section>`;
  const data = await api(`/api/session/${guild.id}`);
  panel.innerHTML = `${heading('Sessions', 'Save session configuration for this server.')}<form id="session-form" class="panel"><div class="field"><label for="session-title">Session title</label><input id="session-title" maxlength="120" value="${escapeHtml(data.title || '')}" placeholder="Community session"></div><div class="field"><label for="session-description">Session description</label><textarea id="session-description" maxlength="2000">${escapeHtml(data.description || '')}</textarea></div><label class="checkbox-row"><input id="session-enabled" type="checkbox" ${data.enabled ? 'checked' : ''}> Enable session configuration</label><div class="button-row"><button class="button" type="submit">Save session settings</button></div></form>`;
  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const next = { title: $('#session-title').value.trim(), description: $('#session-description').value.trim(), enabled: $('#session-enabled').checked };
    try { await api(`/api/session/${guild.id}`, { method: 'PUT', body: JSON.stringify({ data: next }) }); showNotice('Session settings saved.', 'success'); }
    catch (e) { showNotice(e.message, 'error'); }
  });
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
    if (view === 'tickets') return await ticketsView(guild);
    if (view === 'logs') return await listView(guild, 'logs');
    if (view === 'sessions') return await sessionsView(guild);
    return overviewView(guild);
  } catch (e) {
    panel.innerHTML = `${heading('Something went wrong', 'The dashboard could not load this section.')}<section class="empty-state"><p>${escapeHtml(e.message)}</p><button id="retry-view" class="button">Try again</button></section>`;
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
