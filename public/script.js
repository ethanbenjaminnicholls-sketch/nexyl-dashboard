const $ = (selector) => document.querySelector(selector);

let currentGuildId = localStorage.getItem("nexylGuild");
let currentConfig = {};

// -------------------------
// API
// -------------------------

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

// -------------------------
// Discord Helpers
// -------------------------

function getAvatarUrl(user) {
    if (!user) return "";

    if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    }

    const index = Number(BigInt(user.id) >> 22n) % 6;

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function getGuildIconUrl(guild) {
    if (!guild || !guild.icon) return null;

    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}

function isAdministrator(guild) {
    if (!guild) return false;

    const permissions = BigInt(guild.permissions || "0");

    return (permissions & 8n) === 8n;
}

// -------------------------
// User
// -------------------------

async function loadUser() {
    const data = await api("/api/me");

    if (!data.user) {
        window.location.href = "/";
        return null;
    }

    const user = data.user;

    const username = $(".user-name");
    const avatar = $(".user-avatar");

    if (username) {
        username.textContent =
            user.global_name ||
            user.username ||
            "Discord User";
    }

    if (avatar) {
        avatar.src = getAvatarUrl(user);
    }

    return user;
}

// -------------------------
// Guilds
// -------------------------

async function loadGuilds() {
    const data = await api("/api/guilds");

    const guilds = Array.isArray(data.guilds)
        ? data.guilds
        : [];

    const managedGuilds = guilds.filter(guild =>
        isAdministrator(guild)
    );

    if (!managedGuilds.length) {
        showNoServers();
        return [];
    }

    let selectedGuild =
        managedGuilds.find(g => g.id === currentGuildId);

    if (!selectedGuild) {
        selectedGuild = managedGuilds[0];
        currentGuildId = selectedGuild.id;
        localStorage.setItem(
            "nexylGuild",
            currentGuildId
        );
    }

    renderGuildSelector(selectedGuild);
    renderGuildModal(managedGuilds);

    return managedGuilds;
}

// -------------------------
// Guild Selector
// -------------------------

function renderGuildSelector(guild) {
    const name = $(".server-name");
    const icon = $(".server-icon");

    if (name) {
        name.textContent = guild.name;
    }

    if (icon) {
        const iconUrl = getGuildIconUrl(guild);

        if (iconUrl) {
            icon.src = iconUrl;
            icon.style.display = "block";
        } else {
            icon.style.display = "none";
        }
    }
}

function renderGuildModal(guilds) {
    const list = $(".server-list");

    if (!list) return;

    list.innerHTML = "";

    guilds.forEach(guild => {
        const button = document.createElement("button");

        button.className = "server-option";

        const iconUrl = getGuildIconUrl(guild);

        button.innerHTML = `
            ${
                iconUrl
                    ? `<img src="${iconUrl}" alt="">`
                    : `<div class="server-option-icon">
                        ${guild.name.charAt(0).toUpperCase()}
                       </div>`
            }

            <div class="server-option-info">
                <strong>${escapeHtml(guild.name)}</strong>
                <span>Administrator</span>
            </div>
        `;

        button.addEventListener("click", () => {
            currentGuildId = guild.id;

            localStorage.setItem(
                "nexylGuild",
                currentGuildId
            );

            closeServerModal();

            renderGuildSelector(guild);

            loadConfig();
        });

        list.appendChild(button);
    });
}

function showNoServers() {
    const main = $(".dashboard-main");

    if (!main) return;

    main.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">!</div>

            <h2>No servers available</h2>

            <p>
                You need Administrator permission in a Discord
                server where Nexyl is installed.
            </p>
        </div>
    `;
}

// -------------------------
// Config
// -------------------------

async function loadConfig() {
    if (!currentGuildId) return;

    try {
        currentConfig = await api(
            `/api/config/${currentGuildId}`
        );
    } catch (error) {
        console.error("Config error:", error);

        currentConfig = {};
    }

    updateDashboard();
}

// -------------------------
// Dashboard
// -------------------------

function updateDashboard() {
    const verification =
        currentConfig.verification || {};

    const moderation =
        currentConfig.moderation || {};

    const sessions =
        currentConfig.sessions || {};

    // Verification

    const verifyEnabled =
        $("#verification-enabled");

    if (verifyEnabled) {
        verifyEnabled.checked =
            verification.enabled === true;
    }

    const verifyChannel =
        $("#verification-channel");

    if (verifyChannel) {
        verifyChannel.value =
            verification.channelId || "";
    }

    const verifyRole =
        $("#verification-role");

    if (verifyRole) {
        verifyRole.value =
            verification.roleId || "";
    }

    // Moderation

    const moderationEnabled =
        $("#moderation-enabled");

    if (moderationEnabled) {
        moderationEnabled.checked =
            moderation.enabled !== false;
    }

    // Sessions

    const sessionsEnabled =
        $("#sessions-enabled");

    if (sessionsEnabled) {
        sessionsEnabled.checked =
            sessions.enabled === true;
    }

    const sessionServer =
        $("#session-server-name");

    if (sessionServer) {
        sessionServer.value =
            sessions.serverName || "";
    }

    const sessionCode =
        $("#session-join-code");

    if (sessionCode) {
        sessionCode.value =
            sessions.joinCode || "";
    }

    const sessionOwner =
        $("#session-owner");

    if (sessionOwner) {
        sessionOwner.value =
            sessions.owner || "";
    }

    const sessionChannel =
        $("#session-channel");

    if (sessionChannel) {
        sessionChannel.value =
            sessions.channelId || "";
    }

    updateStats();
}

// -------------------------
// Stats
// -------------------------

function updateStats() {
    const verification =
        currentConfig.verification || {};

    const moderation =
        currentConfig.moderation || {};

    const sessions =
        currentConfig.sessions || {};

    const verificationStatus =
        $(".verification-status");

    if (verificationStatus) {
        verificationStatus.textContent =
            verification.enabled
                ? "Enabled"
                : "Disabled";
    }

    const moderationStatus =
        $(".moderation-status");

    if (moderationStatus) {
        moderationStatus.textContent =
            moderation.enabled !== false
                ? "Enabled"
                : "Disabled";
    }

    const sessionsStatus =
        $(".sessions-status");

    if (sessionsStatus) {
        sessionsStatus.textContent =
            sessions.enabled
                ? "Enabled"
                : "Disabled";
    }
}

// -------------------------
// Page Navigation
// -------------------------

function showPage(page) {
    document
        .querySelectorAll(".dashboard-page")
        .forEach(element => {
            element.classList.remove("active");
        });

    const target =
        document.querySelector(
            `[data-page="${page}"]`
        );

    if (target) {
        target.classList.add("active");
    }

    document
        .querySelectorAll(".nav-item")
        .forEach(item => {
            item.classList.remove("active");
        });

    const activeNav =
        document.querySelector(
            `.nav-item[data-page="${page}"]`
        );

    if (activeNav) {
        activeNav.classList.add("active");
    }

    const title =
        $(".page-title");

    if (title) {
        const titles = {
            overview: "Overview",
            verification: "Verification",
            moderation: "Moderation",
            sessions: "ERLC Sessions",
            tickets: "Tickets",
            antinuke: "Anti-Nuke",
            giveaways: "Giveaways",
            wordresponses: "Word Responses",
            welcome: "Welcome",
            logs: "Logs",
            premium: "Premium"
        };

        title.textContent =
            titles[page] || "Dashboard";
    }

    closeMobileMenu();
}

// -------------------------
// Save
// -------------------------

async function saveSection(section) {
    if (!currentGuildId) {
        alert("Please select a server first.");
        return;
    }

    let settings = {};

    if (section === "verification") {
        settings = {
            enabled:
                $("#verification-enabled")?.checked || false,

            channelId:
                $("#verification-channel")?.value.trim() || "",

            roleId:
                $("#verification-role")?.value.trim() || ""
        };
    }

    if (section === "moderation") {
        settings = {
            enabled:
                $("#moderation-enabled")?.checked || false
        };
    }

    if (section === "sessions") {
        settings = {
            enabled:
                $("#sessions-enabled")?.checked || false,

            serverName:
                $("#session-server-name")?.value.trim() || "",

            joinCode:
                $("#session-join-code")?.value.trim() || "",

            owner:
                $("#session-owner")?.value.trim() || "",

            channelId:
                $("#session-channel")?.value.trim() || ""
        };
    }

    try {
        await api(
            `/api/config/${currentGuildId}/${section}`,
            {
                method: "POST",
                body: JSON.stringify(settings)
            }
        );

        currentConfig[section] = settings;

        updateDashboard();

        showToast("Settings saved successfully.");
    } catch (error) {
        console.error(error);

        showToast(
            error.message || "Failed to save settings.",
            true
        );
    }
}

// -------------------------
// Toast
// -------------------------

function showToast(message, error = false) {
    let toast = $(".toast");

    if (!toast) {
        toast = document.createElement("div");

        toast.className = "toast";

        document.body.appendChild(toast);
    }

    toast.textContent = message;

    toast.classList.toggle(
        "toast-error",
        error
    );

    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// -------------------------
// Server Modal
// -------------------------

function openServerModal() {
    const modal = $(".server-modal");

    if (modal) {
        modal.classList.add("open");
    }
}

function closeServerModal() {
    const modal = $(".server-modal");

    if (modal) {
        modal.classList.remove("open");
    }
}

// -------------------------
// Mobile Menu
// -------------------------

function openMobileMenu() {
    document.body.classList.add("mobile-menu-open");
}

function closeMobileMenu() {
    document.body.classList.remove("mobile-menu-open");
}

// -------------------------
// HTML Escape
// -------------------------

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// -------------------------
// Events
// -------------------------

document.addEventListener("click", event => {
    const navItem =
        event.target.closest(".nav-item");

    if (navItem) {
        const page =
            navItem.dataset.page;

        if (page) {
            showPage(page);
        }
    }

    const serverSelector =
        event.target.closest(".server-selector");

    if (serverSelector) {
        openServerModal();
    }

    const closeModal =
        event.target.closest(".close-modal");

    if (closeModal) {
        closeServerModal();
    }

    if (
        event.target.classList.contains(
            "server-modal"
        )
    ) {
        closeServerModal();
    }

    const menuButton =
        event.target.closest(".mobile-menu-button");

    if (menuButton) {
        openMobileMenu();
    }

    const mobileClose =
        event.target.closest(".mobile-close");

    if (mobileClose) {
        closeMobileMenu();
    }

    const saveButton =
        event.target.closest("[data-save-section]");

    if (saveButton) {
        saveSection(
            saveButton.dataset.saveSection
        );
    }
});

// -------------------------
// Logout
// -------------------------

document.addEventListener("click", event => {
    const logout =
        event.target.closest(".logout");

    if (logout) {
        window.location.href =
            "/api/logout";
    }
});

// -------------------------
// Init
// -------------------------

async function init() {
    try {
        const user = await loadUser();

        if (!user) return;

        await loadGuilds();

        await loadConfig();

        showPage("overview");
    } catch (error) {
        console.error(
            "Dashboard initialization failed:",
            error
        );
    }
}

init();
