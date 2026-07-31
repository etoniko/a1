(function () {
    const SKIN_CDN = "https://api.agar.su/skins/";
    const SKIN_FALLBACK = "https://api.agar.su/skins/4.png";
    const TOP100_URL = "https://api.agar.su/api/top100";
    const SKINLIST_URL = "https://api.agar.su/skinlist.txt";
    const PASS_URL = "https://api.agar.su/pass.txt";
    const INVISIBLE_URL = "https://api.agar.su/invisible.txt";
    const ROTATION_URL = "https://api.agar.su/rotation.txt";
    const PLAYED_KEY = "agarPlayedSkins";
    const MAX_PLAYED = 30;

    function xpForLevel(level) {
        return 50 * level * level;
    }
    function levelFromXp(xp) {
        xp = Math.max(0, xp | 0);
        return Math.max(0, Math.floor(Math.sqrt(xp / 50)));
    }
    function getLevel(xp) {
        return ~~((xp / 100 * 2) ** 0.5);
    }
    function xpProgress(xp) {
        const level = levelFromXp(xp);
        const cur = xpForLevel(level);
        const next = xpForLevel(level + 1);
        const span = Math.max(1, next - cur);
        const pct = Math.min(100, Math.max(0, ((xp - cur) / span) * 100));
        return { level, cur, next, pct, xp };
    }

    function normalizeNick(nick) {
        if (!nick) return "";
        let n = String(nick).trim();
        const brackets = { "[": "]", "{": "}", "(": ")", "|": "|" };
        const first = n.charAt(0);
        if (brackets[first]) {
            const close = brackets[first];
            const end = n.indexOf(close, 1);
            if (end === -1) return "";
            n = n.substring(1, end);
        }
        return n.trim().toLowerCase();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    const TOKEN_KEY = "accountToken";
    const VK_APP = 54069355;
    const VK_REDIRECT = "https://agar.su";
    const VK_VERIFIER_KEY = "vk_code_verifier";
    const VK_STATE_KEY = "vk_state";

    function getAccountToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
    }
    function setAccountToken(token) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* ignore */ }
    }

    function vkRandom(len) {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        let out = "";
        for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
        return out;
    }
    function persistPkce(codeVerifier, stateVal) {
        try {
            sessionStorage.setItem(VK_VERIFIER_KEY, codeVerifier);
            sessionStorage.setItem(VK_STATE_KEY, stateVal);
        } catch (e) { /* ignore */ }
        try {
            localStorage.setItem(VK_VERIFIER_KEY, codeVerifier);
            localStorage.setItem(VK_STATE_KEY, stateVal);
        } catch (e) { /* ignore */ }
    }
    function readPkce() {
        const read = (fn) => { try { return fn(); } catch (e) { return null; } };
        return {
            codeVerifier:
                read(() => sessionStorage.getItem(VK_VERIFIER_KEY)) ||
                read(() => localStorage.getItem(VK_VERIFIER_KEY)),
            state:
                read(() => sessionStorage.getItem(VK_STATE_KEY)) ||
                read(() => localStorage.getItem(VK_STATE_KEY))
        };
    }
    function clearPkce() {
        [VK_VERIFIER_KEY, VK_STATE_KEY].forEach((key) => {
            try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        });
    }

    const el = {
        root: null,
        nick: null,
        avatar: null,
        xpFill: null,
        xpText: null,
        statXp: null,
        statLvl: null,
        statUid: null,
        ratingList: null,
        skinsGrid: null,
        authGuest: null,
        authUser: null,
        authAvatar: null,
        authName: null,
        authMeta: null
    };

    let state = {
        xp: 0,
        uid: null,
        accountName: null,
        accountAvatar: null,
        tab: "profile",
        skinMap: null,
        skinEntries: null,
        passSet: null,
        invisibleSet: null,
        rotationSet: null,
        rating: null,
        nicknames: null,
        invTab: "nicks",
        vkReady: false,
        selectedSkin: localStorage.getItem("cabinetSkin") || ""
    };

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }
    function $all(sel, root) {
        return Array.from((root || document).querySelectorAll(sel));
    }

    function loadPlayed() {
        try {
            const raw = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }
    function savePlayed(list) {
        localStorage.setItem(PLAYED_KEY, JSON.stringify(list.slice(0, MAX_PLAYED)));
    }
    function rememberPlayedNick(nick) {
        const raw = String(nick || "").trim();
        if (!raw) return;
        const key = normalizeNick(raw);
        if (!key) return;
        resolveSkinCode(key).then((code) => {
            if (!code) return;
            const list = loadPlayed().filter((x) => normalizeNick(x.nick) !== key);
            list.unshift({ nick: raw, code: String(code) });
            savePlayed(list);
            if (state.tab === "skins") renderSkins();
        });
    }

    async function fetchTxtLines(url) {
        const res = await fetch(url, { cache: "force-cache" });
        const text = await res.text();
        return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    async function ensurePerkLists() {
        if (state.passSet && state.invisibleSet && state.rotationSet) {
            return {
                pass: state.passSet,
                invisible: state.invisibleSet,
                rotation: state.rotationSet
            };
        }
        if (state._perkPromise) return state._perkPromise;
        state._perkPromise = (async () => {
            try {
                const [passLines, invLines, rotLines] = await Promise.all([
                    fetchTxtLines(PASS_URL),
                    fetchTxtLines(INVISIBLE_URL),
                    fetchTxtLines(ROTATION_URL)
                ]);
                await new Promise((r) => setTimeout(r, 0));
                state.passSet = new Set(passLines.map((n) => n.toLowerCase()));
                state.invisibleSet = new Set(invLines.map((n) => n.toLowerCase()));
                state.rotationSet = new Set(rotLines.map((n) => n.toLowerCase()));
            } catch (e) {
                state.passSet = state.passSet || new Set();
                state.invisibleSet = state.invisibleSet || new Set();
                state.rotationSet = state.rotationSet || new Set();
            }
            return {
                pass: state.passSet,
                invisible: state.invisibleSet,
                rotation: state.rotationSet
            };
        })();
        try {
            return await state._perkPromise;
        } finally {
            state._perkPromise = null;
        }
    }
    function nickInSet(set, nickname) {
        const lower = String(nickname || "").toLowerCase();
        if (set.has(lower)) return true;
        const clean = lower.replace(/\[|\]/g, "").trim();
        return set.has(clean) || set.has("[" + clean + "]");
    }

    async function ensureSkinMap() {
        if (state.skinMap) return state.skinMap;
        if (state._skinMapPromise) return state._skinMapPromise;
        state._skinMapPromise = (async () => {
            const map = Object.create(null);
            const g = window.game;
            if (g && g.skinMap && Object.keys(g.skinMap).length) {
                Object.keys(g.skinMap).forEach((k) => { map[k] = g.skinMap[k]; });
                state.skinMap = map;
                state.skinEntries = state.skinEntries || [];
                return map;
            }
            try {
                const res = await fetch(SKINLIST_URL, { cache: "force-cache" });
                const text = await res.text();
                await new Promise((r) => setTimeout(r, 0));
                const lines = text.split(/\r?\n/);
                const entries = [];
                const CHUNK = 800;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const idx = line.indexOf(":");
                    if (idx < 0) continue;
                    const nick = line.slice(0, idx).trim();
                    const code = line.slice(idx + 1).trim();
                    if (!nick || !code) continue;
                    const key = normalizeNick(nick);
                    if (key) map[key] = code;
                    map[nick.toLowerCase()] = code;
                    entries.push({ nick, code: String(code) });
                    if (i > 0 && i % CHUNK === 0) {
                        await new Promise((r) => setTimeout(r, 0));
                    }
                }
                state.skinEntries = entries;
            } catch (e) { /* empty */ }
            state.skinMap = map;
            return map;
        })();
        try {
            return await state._skinMapPromise;
        } finally {
            state._skinMapPromise = null;
        }
    }
    async function resolveSkinCode(nickOrKey) {
        const map = await ensureSkinMap();
        const raw = String(nickOrKey || "").trim();
        const key = normalizeNick(raw);
        return (key && map[key]) || map[raw.toLowerCase()] || null;
    }
    function skinUrl(code) {
        return code ? SKIN_CDN + encodeURIComponent(code) + ".png" : "";
    }
    function skinUrlForNick(nickname) {
        const map = state.skinMap || {};
        const clean = String(nickname || "").replace(/\[|\]/g, "").trim().toLowerCase();
        const code = map[clean] || map["[" + clean + "]"] || map[normalizeNick(nickname)];
        return code ? skinUrl(code) : null;
    }

    function currentNick() {
        const input = document.getElementById("nick");
        const v = (input && input.value.trim()) || "";
        return v || "Гость";
    }

    async function updateHomeSkinPreview() {
        const btn = document.getElementById("skinButton");
        const wrap = btn && btn.querySelector(".skinWrapper");
        if (!wrap) return;
        const nickInput = document.getElementById("nick");
        const nick = nickInput ? nickInput.value.trim() : "";
        const code = nick ? await resolveSkinCode(nick) : null;
        if (code) {
            wrap.style.backgroundImage = "url('" + skinUrl(code) + "')";
            btn.classList.add("has-skin");
        } else {
            wrap.style.backgroundImage = "";
            btn.classList.remove("has-skin");
        }
        if (el.avatar) {
            if (state.accountAvatar) {
                el.avatar.style.backgroundImage = "url('" + state.accountAvatar.replace(/'/g, "%27") + "')";
            } else if (code) {
                el.avatar.style.backgroundImage = "url('" + skinUrl(code) + "')";
            } else {
                el.avatar.style.backgroundImage = "";
            }
        }
    }

    function updateXpUi(xp) {
        state.xp = Math.max(0, xp | 0);
        const p = xpProgress(state.xp);
        if (window.game) window.game.accountXp = state.xp;

        const menuFill = $("#progressBar .progress-bar");
        const menuText = $("#progressBar .progress-bar-text");
        const menuStar = $("#progressBar .progress-bar-star span");
        if (menuFill) menuFill.style.width = p.pct.toFixed(1) + "%";
        if (menuText) menuText.textContent = state.xp + "/" + p.next + " XP";
        if (menuStar) menuStar.textContent = String(p.level || 1);

        if (el.xpFill) el.xpFill.style.width = p.pct.toFixed(1) + "%";
        if (el.xpText) el.xpText.textContent = "Ур. " + p.level + " · " + state.xp + " / " + p.next + " XP";
        if (el.statXp) el.statXp.textContent = String(state.xp);
        if (el.statLvl) el.statLvl.textContent = String(p.level);
        if (el.statUid) el.statUid.textContent = state.uid != null ? String(state.uid) : "—";

        const uname = $(".user-name");
        const displayName = state.accountName || currentNick();
        if (uname) uname.textContent = displayName;
        if (el.nick) el.nick.textContent = displayName;
        if (el.avatar && state.accountAvatar) {
            el.avatar.style.backgroundImage = "url('" + state.accountAvatar.replace(/'/g, "%27") + "')";
        }
        updateAuthUi();
        const previewKey = displayName + "|" + (state.accountAvatar || "");
        if (state._previewKey !== previewKey) {
            state._previewKey = previewKey;
            updateHomeSkinPreview();
        }
    }

    function updateAuthUi() {
        const logged = !!getAccountToken();
        if (el.authGuest) el.authGuest.hidden = logged;
        if (el.authUser) el.authUser.hidden = !logged;
        if (!logged) return;
        if (el.authName) el.authName.textContent = state.accountName || "Игрок";
        if (el.authMeta) el.authMeta.textContent = "ID " + (state.uid != null ? state.uid : "—");
        if (el.authAvatar && state.accountAvatar) el.authAvatar.src = state.accountAvatar;
    }

    async function loadAccountProfile() {
        const token = getAccountToken();
        if (!token) {
            state.accountName = null;
            state.accountAvatar = null;
            state.uid = null;
            state.nicknames = null;
            updateAuthUi();
            renderInventory();
            return;
        }
        try {
            const res = await fetch("https://api.agar.su/api/me/login", {
                headers: { Authorization: "Game " + token },
                cache: "no-store"
            });
            const data = await res.json();
            if (data.error || data.status === 401) {
                setAccountToken("");
                state.accountName = null;
                state.accountAvatar = null;
                state.uid = null;
                state.nicknames = null;
                updateAuthUi();
                renderInventory();
                return;
            }
            state.accountName = data.account_name || null;
            state.accountAvatar = data.account_avatar || null;
            state.uid = data.uid != null ? data.uid : null;
            if (data.xp != null) updateXpUi(data.xp);
            else updateAuthUi();
            await loadMyNicknames(true);
        } catch (e) {
            updateAuthUi();
            renderInventory();
        }
    }

    function logoutAccount() {
        setAccountToken("");
        state.accountName = null;
        state.accountAvatar = null;
        state.uid = null;
        state.nicknames = null;
        state.vkReady = false;
        updateXpUi(state.xp);
        updateAuthUi();
        renderInventory();
        if (el.root && el.root.classList.contains("is-open")) {
            ensureVkWidget(true);
        }
    }

    async function completeVkLogin(payload) {
        if (!payload || !payload.code || !payload.device_id) {
            alert("VK: не получен код авторизации");
            return;
        }
        const pkce = readPkce();
        const body = {
            code: payload.code,
            device_id: payload.device_id,
            code_verifier: payload.code_verifier || pkce.codeVerifier,
            state: payload.state || pkce.state
        };
        if (!body.code_verifier || !body.state) {
            alert("VK: сессия истекла, обновите страницу");
            return;
        }
        clearPkce();
        try {
            const res = await fetch("https://api.agar.su/api/auth/vk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.error || !data.token) {
                alert(data.error || "Ошибка авторизации");
                ensureVkWidget(true);
                return;
            }
            setAccountToken(data.token);
            state.vkReady = false;
            await loadAccountProfile();
            openCabinet("profile");
        } catch (e) {
            alert("Ошибка сети при авторизации");
            ensureVkWidget(true);
        }
    }

    function handleVkUrlCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const deviceId = params.get("device_id");
        if (!code || !deviceId) return false;
        const pkce = readPkce();
        if (!pkce.codeVerifier || !pkce.state) {
            alert("VK: обновите страницу и войдите снова");
            return false;
        }
        completeVkLogin({
            code,
            device_id: deviceId,
            code_verifier: pkce.codeVerifier,
            state: pkce.state
        });
        window.history.replaceState({}, "", window.location.pathname + window.location.hash);
        return true;
    }

    function ensureVkWidget(force) {
        if (getAccountToken()) {
            updateAuthUi();
            return;
        }
        if (!("VKIDSDK" in window)) {
            const box = document.getElementById("VkIdSdkOneTap");
            if (box && !box.dataset.waitSdk) {
                box.dataset.waitSdk = "1";
                box.innerHTML = '<p class="cab-auth-hint" style="margin:0">Загрузка входа…</p>';
                waitForVkSdk().then(() => ensureVkWidget(true));
            }
            return;
        }
        if (!el.root || !el.root.classList.contains("is-open")) return;
        if (state.tab !== "profile") return;
        if (el.authGuest && el.authGuest.hidden) return;
        if (state.vkReady && !force) return;

        const container = document.getElementById("VkIdSdkOneTap");
        if (!container) return;

        const VKID = window.VKIDSDK;
        const codeVerifier = vkRandom(64);
        const stateVal = vkRandom(32);
        persistPkce(codeVerifier, stateVal);

        try {
            VKID.Config.init({
                app: VK_APP,
                redirectUrl: VK_REDIRECT,
                state: stateVal,
                codeVerifier,
                responseMode: VKID.ConfigResponseMode.Callback,
                source: VKID.ConfigSource.LOWCODE,
                scope: ""
            });
            container.innerHTML = "";
            new VKID.OneTap().render({
                container,
                showAlternativeLogin: true,
                oauthList: ["mail_ru", "ok_ru"],
                styles: { width: 320, height: 44, borderRadius: 10 },
                skin: VKID.OneTapSkin.Primary,
                scheme: VKID.Scheme.LIGHT,
                lang: VKID.Languages.RUS
            }).on(VKID.WidgetEvents.ERROR, (err) => {
                console.error("VK ID error", err);
                const msg = err && (err.error_description || err.error || err.text);
                if (msg) alert("VK: " + msg);
            }).on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, (payload) => {
                completeVkLogin({
                    code: payload.code,
                    device_id: payload.device_id,
                    code_verifier: codeVerifier,
                    state: stateVal
                });
            });
            state.vkReady = true;
        } catch (e) {
            console.error("VK ID init failed", e);
            container.innerHTML = '<p class="cab-auth-hint" style="margin:0;color:#d64545">Не удалось загрузить вход VK</p>';
            state.vkReady = false;
        }
    }

    function waitForVkSdk() {
        return new Promise((resolve) => {
            if (window.VKIDSDK) return resolve(true);
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                if (window.VKIDSDK || tries > 40) {
                    clearInterval(t);
                    resolve(!!window.VKIDSDK);
                }
            }, 150);
            document.querySelector('script[src*="vkid"]')?.addEventListener("load", () => {
                clearInterval(t);
                resolve(!!window.VKIDSDK);
            });
        });
    }

    function initVkAuth(force) {
        ensureVkWidget(force);
    }

    async function renderRating() {
        if (!el.ratingList) return;
        if (!state.rating) {
            el.ratingList.innerHTML = '<li class="cabinet-skin-empty" style="display:block;grid-column:1/-1">Загрузка…</li>';
            try {
                const res = await fetch(TOP100_URL, { cache: "no-store" });
                if (!res.ok) throw new Error("top100 " + res.status);
                state.rating = await res.json();
            } catch (e) {
                el.ratingList.innerHTML = '<li class="cabinet-skin-empty" style="display:block;grid-column:1/-1">Не удалось загрузить рейтинг.</li>';
                return;
            }
        }
        const rows = Array.isArray(state.rating) ? state.rating : [];
        if (!rows.length) {
            el.ratingList.innerHTML = '<li class="cabinet-skin-empty" style="display:block;grid-column:1/-1">Пусто.</li>';
            return;
        }
        el.ratingList.innerHTML = rows.map((player) => {
            const pos = player.position != null ? player.position : "—";
            const name = player.account_name || "—";
            const uid = player.uid != null ? player.uid : "—";
            const lvl = getLevel(player.xp || 0);
            let av = player.account_avatar || "";
            if (!/^https?:\/\//i.test(av)) av = SKIN_FALLBACK;
            return '<li>' +
                '<div class="cab-rating-pos">' + escapeHtml(String(pos)) + "</div>" +
                '<div class="cab-rating-av" style="background-image:url(\'' + av.replace(/'/g, "%27") + "')\"></div>" +
                '<div class="cab-rating-meta">' +
                '<div class="cab-rating-name">' + escapeHtml(name) + "</div>" +
                '<div class="cab-rating-id">ID ' + escapeHtml(String(uid)) + "</div>" +
                "</div>" +
                '<div class="cab-rating-lvl">' + lvl + "</div>" +
                "</li>";
        }).join("");
    }

    async function renderSkins() {
        if (!el.skinsGrid) return;
        el.skinsGrid.innerHTML = '<div class="cabinet-skin-empty">Загрузка…</div>';
        await ensureSkinMap();
        const played = loadPlayed();
        const skins = [];
        const seen = new Set();
        for (const item of played) {
            const key = normalizeNick(item.nick);
            if (!key || seen.has(key)) continue;
            const code = item.code || state.skinMap[key] || state.skinMap[String(item.nick || "").toLowerCase()];
            if (!code) continue;
            seen.add(key);
            skins.push({ nick: item.nick, code: String(code) });
        }
        if (!skins.length) {
            el.skinsGrid.innerHTML = '<div class="cabinet-skin-empty">Пока пусто.<br>Сыграй или выбери ник со скином — он сохранится здесь.<br>Купленные ники — во вкладке Профиль.</div>';
            return;
        }
        el.skinsGrid.innerHTML = skins.map((s) => {
            const sel = state.selectedSkin && String(state.selectedSkin) === String(s.code) ? " is-selected" : "";
            return '<button type="button" class="cabinet-skin' + sel + '" data-nick="' +
                escapeHtml(s.nick) + '" data-code="' + escapeHtml(s.code) +
                '" style="background-image:url(\'' + skinUrl(s.code).replace(/'/g, "%27") + '\')" title="' +
                escapeHtml(s.nick) + '"><span class="tag">' + escapeHtml(s.nick) + "</span></button>";
        }).join("");
    }

    function openShopForNick(nickPart, isClan, opts) {
        opts = opts || {};
        setTab("shop");
        const nickField = document.getElementById("cabNickname");
        const passField = document.getElementById("cabPassword");
        if (nickField) nickField.value = nickPart || "";
        if (opts.focusPassword && passField) passField.focus();
        const type = isClan ? "clan" : "personal";
        const radio = document.querySelector('input[name="cabServiceType"][value="' + type + '"]');
        if (radio) radio.checked = true;
        const inv = document.getElementById("cabInvisible");
        const rot = document.getElementById("cabRotation");
        if (inv && opts.invisible) inv.checked = true;
        if (rot && opts.rotation) rot.checked = true;
        calculateShop();
    }

    function applyOwnedNick(fullNick, pass) {
        const nickPart = String(fullNick || "").split("#")[0].trim();
        const nickField = document.getElementById("nick");
        const passField = document.getElementById("pass");
        if (nickField) {
            nickField.value = nickPart;
            nickField.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (passField) {
            passField.value = pass || "";
            passField.style.display = pass ? "block" : "";
        }
        rememberPlayedNick(nickPart);
        updateHomeSkinPreview();
        closeCabinet();
    }

    function getNickPerks(nickname, password) {
        const lists = {
            pass: state.passSet || new Set(),
            invisible: state.invisibleSet || new Set(),
            rotation: state.rotationSet || new Set()
        };
        const pass = String(password ?? "").trim();
        const hasSkin = !!(skinUrlForNick(nickname));
        return {
            hasSkinPass: nickInSet(lists.pass, nickname) || !!pass,
            hasSkin,
            invisible: nickInSet(lists.invisible, nickname),
            rotation: nickInSet(lists.rotation, nickname)
        };
    }

    function renderNickCard(listEl, nickname, password) {
        const full = String(nickname || "").trim();
        const pass = String(password || "").trim();
        const isClan = /\[[^\]]+\]/.test(full);
        const label = full || "?";
        const perks = getNickPerks(full, pass);
        const li = document.createElement("li");
        li.className = "cab-nick-card";

        const url = skinUrlForNick(full);
        if (url) {
            const img = document.createElement("img");
            img.className = "skin";
            img.loading = "lazy";
            img.src = url;
            img.alt = "";
            li.appendChild(img);
        } else {
            const av = document.createElement("div");
            av.className = "skin skin--empty";
            av.textContent = label.charAt(0).toUpperCase();
            li.appendChild(av);
        }

        const body = document.createElement("div");
        body.className = "cab-nick-card-body";
        const name = document.createElement("div");
        name.className = "nick";
        name.textContent = label;
        name.title = "Выбрать для игры";
        name.addEventListener("click", () => applyOwnedNick(full, pass));

        const perksRow = document.createElement("div");
        perksRow.className = "cab-nick-perks";
        const addPerk = (labelText, on, buyOpts) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cab-nick-perk" + (on ? " is-on" : "") + (buyOpts ? " is-action" : "");
            btn.textContent = labelText;
            if (buyOpts) {
                btn.title = on ? "Сменить / докупить" : "Купить";
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openShopForNick(full, isClan, buyOpts);
                });
            } else if (on) {
                btn.title = "Куплено";
            }
            perksRow.appendChild(btn);
        };
        addPerk("Пароль", perks.hasSkinPass, { focusPassword: true });
        addPerk("Скин", perks.hasSkin, { focusSkin: true });
        addPerk("Невидимый", perks.invisible, perks.invisible ? null : { invisible: true });
        addPerk("Поворот", perks.rotation, perks.rotation ? null : { rotation: true });

        body.append(name, perksRow);
        li.appendChild(body);

        const passBox = document.createElement("div");
        passBox.className = "cab-passbox";
        const input = document.createElement("input");
        input.type = "password";
        input.readOnly = true;
        input.value = pass;
        input.placeholder = "—";
        input.autocomplete = "new-password";
        input.spellcheck = false;
        const eye = document.createElement("button");
        eye.type = "button";
        eye.textContent = "👁";
        eye.title = "Показать пароль";
        eye.addEventListener("click", () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
        });
        passBox.append(input, eye);
        li.appendChild(passBox);
        listEl.appendChild(li);
    }

    function setInvTab(tab) {
        state.invTab = tab;
        $all(".cab-inv-tab", el.root).forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.inv === tab);
        });
        $all(".cab-inv-list", el.root).forEach((list) => {
            list.classList.toggle("is-active", list.dataset.invPanel === tab);
        });
    }

    function renderInventory() {
        const hint = document.getElementById("cabInvHint");
        const tabs = document.getElementById("cabInvTabs");
        const panels = document.getElementById("cabInvPanels");
        const nickList = document.getElementById("myNickList");
        const clanList = document.getElementById("myClanList");
        const badgeNick = document.getElementById("badgeNick");
        const badgeClan = document.getElementById("badgeClan");
        if (!nickList || !clanList) return;

        if (!getAccountToken()) {
            if (hint) {
                hint.hidden = false;
                hint.textContent = "Войдите, чтобы увидеть ники, кланы и скины";
            }
            if (tabs) tabs.hidden = true;
            if (panels) panels.hidden = true;
            nickList.innerHTML = "";
            clanList.innerHTML = "";
            state._invRendered = false;
            return;
        }

        if (hint) hint.hidden = true;
        if (tabs) tabs.hidden = false;
        if (panels) panels.hidden = false;

        nickList.innerHTML = "";
        clanList.innerHTML = "";
        let nickCount = 0;
        let clanCount = 0;
        const rows = Array.isArray(state.nicknames) ? state.nicknames : null;

        if (!rows) {
            nickList.innerHTML = '<li class="empty">Загрузка…</li>';
            return;
        }
        if (!rows.length) {
            nickList.innerHTML = '<li class="empty">Вы не покупали ники</li>';
            clanList.innerHTML = '<li class="empty">Вы не покупали кланы</li>';
            if (badgeNick) badgeNick.textContent = "0";
            if (badgeClan) badgeClan.textContent = "0";
            setInvTab(state.invTab || "nicks");
            return;
        }

        rows.forEach((row) => {
            const full = String(row.nickname || "").trim();
            const pass = String(row.password ?? "").trim();
            if (!full) return;
            if (/\[[^\]]+\]/.test(full)) {
                renderNickCard(clanList, full, pass);
                clanCount++;
            } else {
                renderNickCard(nickList, full, pass);
                nickCount++;
            }
        });
        if (!nickCount) nickList.innerHTML = '<li class="empty">Вы не покупали ники</li>';
        if (!clanCount) clanList.innerHTML = '<li class="empty">Вы не покупали кланы</li>';
        if (badgeNick) badgeNick.textContent = String(nickCount);
        if (badgeClan) badgeClan.textContent = String(clanCount);
        setInvTab(state.invTab || "nicks");
        state._invRendered = true;
    }

    async function loadMyNicknames(force) {
        if (!getAccountToken()) {
            state.nicknames = null;
            renderInventory();
            return;
        }
        if (!force && Array.isArray(state.nicknames)) {
            if (!state._invRendered) renderInventory();
            return;
        }
        if (state._nickLoading) return;
        state._nickLoading = true;
        renderInventory();
        try {
            const res = await fetch("https://api.agar.su/api/me/nicknames", {
                headers: { Authorization: "Game " + getAccountToken() },
                cache: "no-store"
            });
            if (res.status === 401) {
                setAccountToken("");
                state.nicknames = null;
                updateAuthUi();
                renderInventory();
                return;
            }
            if (!res.ok) throw new Error("nicknames " + res.status);
            const data = await res.json();
            state.nicknames = Array.isArray(data?.nicknames) ? data.nicknames : [];
            renderInventory();
            Promise.all([ensureSkinMap(), ensurePerkLists()]).then(() => {
                if (el.root?.classList.contains("is-open") && state.tab === "profile") {
                    state._invRendered = false;
                    renderInventory();
                }
            }).catch(() => {});
        } catch (e) {
            const nickList = document.getElementById("myNickList");
            if (nickList) nickList.innerHTML = '<li class="error">Не удалось загрузить никнеймы</li>';
            const tabs = document.getElementById("cabInvTabs");
            const panels = document.getElementById("cabInvPanels");
            const hint = document.getElementById("cabInvHint");
            if (hint) hint.hidden = true;
            if (tabs) tabs.hidden = false;
            if (panels) panels.hidden = false;
        } finally {
            state._nickLoading = false;
        }
    }

    /* —— Shop —— */
    function shopEls() {
        return {
            form: document.getElementById("cabPaymentForm"),
            nick: document.getElementById("cabNickname"),
            pass: document.getElementById("cabPassword"),
            file: document.getElementById("cabFileInput"),
            inv: document.getElementById("cabInvisible"),
            rot: document.getElementById("cabRotation"),
            preview: document.getElementById("cabPreviewBox"),
            canvas: document.getElementById("cabPreviewCanvas"),
            gif: document.getElementById("cabPreviewGif"),
            buy: document.getElementById("cabBuyBtn"),
            msg: document.getElementById("cabShopMsg"),
            mult: document.getElementById("cabMult"),
            passCost: document.getElementById("cabPassCost"),
            skinCost: document.getElementById("cabSkinCost"),
            invCost: document.getElementById("cabInvCost"),
            rotCost: document.getElementById("cabRotCost"),
            total: document.getElementById("cabTotal"),
            overlay: document.getElementById("cabPayOverlay"),
            backdrop: document.getElementById("cabPayBackdrop"),
            email: document.getElementById("cabShopEmail"),
            pay: document.getElementById("cabPayBtn"),
            payClose: document.getElementById("cabPayClose"),
            payAmount: document.getElementById("cabPayAmount")
        };
    }
    function shopMsg(text, ok) {
        const m = shopEls().msg;
        if (!m) return;
        m.textContent = text || "";
        m.className = "cab-shop-msg" + (text ? (ok ? " is-ok" : " is-err") : "");
    }
    function shopMultiplier() {
        const clan = document.querySelector('input[name="cabServiceType"][value="clan"]');
        return clan && clan.checked ? 2 : 1;
    }

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var shopPayOpen = false;
    var shopPaying = false;

    function getShopEmail() {
        const s = shopEls();
        return ((s.email && s.email.value) || "").trim().toLowerCase();
    }
    function isShopEmailValid() {
        return EMAIL_RE.test(getShopEmail());
    }
    function updateShopPayBtn() {
        const s = shopEls();
        if (!s.pay) return;
        s.pay.disabled = shopPaying || !isShopEmailValid();
        if (!shopPaying) s.pay.textContent = "Оплатить";
    }
    function openShopPay() {
        const s = shopEls();
        if (!s.overlay) return;
        if (s.payAmount) s.payAmount.textContent = (s.total && s.total.textContent) || "0 ₽";
        s.overlay.hidden = false;
        s.overlay.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => s.overlay.classList.add("is-open"));
        shopPayOpen = true;
        shopMsg("");
        updateShopPayBtn();
        setTimeout(() => s.email && s.email.focus(), 60);
    }
    function closeShopPay() {
        const s = shopEls();
        if (!s.overlay || shopPaying) return;
        s.overlay.classList.remove("is-open");
        s.overlay.setAttribute("aria-hidden", "true");
        shopPayOpen = false;
        const finish = () => {
            if (!shopPayOpen) s.overlay.hidden = true;
        };
        s.overlay.addEventListener("transitionend", finish, { once: true });
        setTimeout(finish, 240);
    }
    function trySubmitShopEmail() {
        if (!shopPayOpen || shopPaying) return;
        if (!isShopEmailValid()) {
            if (getShopEmail()) shopMsg("Введите корректный email.");
            else shopMsg("Укажите email для чека.");
            return;
        }
        shopMsg("");
        submitShopPayment();
    }

    /**
     * Обрабатывает загруженный файл: если это PNG или GIF — оставляет как есть.
     * Если это JPEG/JPG — обрезает в круг и конвертирует в PNG размером 512x512.
     * Возвращает Promise с File или Blob для отправки.
     */
    function processSkinFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error("Файл не выбран"));
            
            const type = file.type;
            // Если PNG или GIF — пропускаем без изменений
            if (type === "image/png" || type === "image/gif") {
                return resolve(file);
            }
            
            // Для JPEG/JPG — обрабатываем
            if (type === "image/jpeg" || type === "image/jpg") {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = new Image();
                    img.onload = function() {
                        // Создаем canvas 512x512
                        const canvas = document.createElement("canvas");
                        canvas.width = 512;
                        canvas.height = 512;
                        const ctx = canvas.getContext("2d");
                        
                        // Рисуем круг
                        ctx.beginPath();
                        ctx.arc(256, 256, 256, 0, Math.PI * 2);
                        ctx.closePath();
                        ctx.clip();
                        
                        // Масштабируем изображение, чтобы заполнить круг
                        const scale = Math.max(512 / img.width, 512 / img.height);
                        const x = (512 - img.width * scale) / 2;
                        const y = (512 - img.height * scale) / 2;
                        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                        
                        // Конвертируем в PNG
                        canvas.toBlob(function(blob) {
                            if (!blob) return reject(new Error("Не удалось конвертировать изображение"));
                            // Создаем новый File с расширением .png
                            const fileName = file.name.replace(/\.[^.]+$/, "") + ".png";
                            const processedFile = new File([blob], fileName, {
                                type: "image/png",
                                lastModified: Date.now()
                            });
                            resolve(processedFile);
                        }, "image/png");
                    };
                    img.onerror = function() {
                        reject(new Error("Не удалось загрузить изображение"));
                    };
                    img.src = e.target.result;
                };
                reader.onerror = function() {
                    reject(new Error("Ошибка чтения файла"));
                };
                reader.readAsDataURL(file);
            } else {
                // Другие форматы не поддерживаются
                reject(new Error("Поддерживаются только PNG, GIF и JPG/JPEG"));
            }
        });
    }

    function calculateShop() {
        const s = shopEls();
        if (!s.buy) return;
        const nick = (s.nick.value || "").trim();
        const pass = (s.pass.value || "").trim();
        const file = s.file.files && s.file.files[0];
        const mult = shopMultiplier();
        const passwordCost = pass ? 150 : 0;
        const invisibleCost = s.inv.checked ? 500 : 0;
        const rotationCost = s.rot.checked ? 500 : 0;
        let skinCost = 0;
        if (file) {
            // PNG и GIF — стандартная цена, JPG/JPEG — обрабатываем как PNG
            const type = file.type;
            if (type === "image/gif") {
                skinCost = 4500;
            } else if (type === "image/png" || type === "image/jpeg" || type === "image/jpg") {
                skinCost = 150;
            }
        }
        const total = (passwordCost + skinCost + invisibleCost + rotationCost) * mult;
        s.mult.textContent = mult === 2 ? "2×" : "1×";
        s.passCost.textContent = (passwordCost * mult) + " ₽";
        s.skinCost.textContent = (skinCost * mult) + " ₽";
        s.invCost.textContent = (invisibleCost * mult) + " ₽";
        s.rotCost.textContent = (rotationCost * mult) + " ₽";
        s.total.textContent = total + " ₽";
        const hasItem = !!(pass || file || s.inv.checked || s.rot.checked);
        s.buy.disabled = !(nick && hasItem && total > 0);
    }

    function previewShopFile(file) {
        const s = shopEls();
        if (!file || !s.preview) return;
        
        // Обрабатываем файл для превью
        processSkinFile(file).then(processedFile => {
            const url = URL.createObjectURL(processedFile);
            const isGif = processedFile.type === "image/gif";
            if (isGif) {
                s.canvas.style.display = "none";
                s.gif.style.display = "block";
                s.gif.src = url;
            } else {
                s.gif.style.display = "none";
                s.canvas.style.display = "block";
                const ctx = s.canvas.getContext("2d");
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, 256, 256);
                    // Если это PNG — рисуем в круг
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(128, 128, 128, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.clip();
                    const scale = Math.max(256 / img.width, 256 / img.height);
                    const x = (256 - img.width * scale) / 2;
                    const y = (256 - img.height * scale) / 2;
                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                    ctx.restore();
                };
                img.src = url;
            }
            s.preview.classList.add("has-image");
        }).catch(err => {
            shopMsg("Ошибка обработки: " + err.message);
        });
    }

    function openShopCheckout() {
        const s = shopEls();
        const nickname = (s.nick.value || "").trim();
        const password = (s.pass.value || "").trim();
        const file = s.file.files && s.file.files[0];
        if (!nickname) {
            shopMsg("Введите ник.");
            return;
        }
        if (!password && !file && !s.inv.checked && !s.rot.checked) {
            shopMsg("Выберите пароль, скин или дополнение.");
            return;
        }
        if (file && file.size > 5 * 1024 * 1024) {
            shopMsg("Файл слишком большой (макс. 5MB).");
            return;
        }
        if (file) {
            const type = file.type;
            if (!["image/png", "image/gif", "image/jpeg", "image/jpg"].includes(type)) {
                shopMsg("Только PNG, GIF, JPG/JPEG.");
                return;
            }
        }
        openShopPay();
    }

    async function submitShopPayment() {
        const s = shopEls();
        if (shopPaying) return;
        const nickname = (s.nick.value || "").trim().toLowerCase();
        const password = (s.pass.value || "").trim().toLowerCase();
        const email = getShopEmail();
        const file = s.file.files && s.file.files[0];
        const serviceType = (document.querySelector('input[name="cabServiceType"]:checked') || {}).value || "personal";

        if (!nickname) {
            shopMsg("Введите ник.");
            closeShopPay();
            return;
        }
        if (!isShopEmailValid()) {
            shopMsg("Введите корректный email.");
            s.email && s.email.focus();
            return;
        }
        if (!password && !file && !s.inv.checked && !s.rot.checked) {
            shopMsg("Выберите пароль, скин или дополнение.");
            closeShopPay();
            return;
        }

        let processedFile = file;
        if (file && (file.type === "image/jpeg" || file.type === "image/jpg")) {
            try {
                processedFile = await processSkinFile(file);
            } catch (err) {
                shopMsg("Ошибка обработки: " + err.message);
                return;
            }
        }

        const mult = shopMultiplier();
        const passwordCost = password ? 1 : 0;
        let skinCost = 0;
        if (processedFile) {
            skinCost = processedFile.type === "image/gif" ? 2 : 1;
        }
        const amount = (passwordCost + skinCost) * mult;
        const formData = new FormData();
        formData.append("name", nickname);
        formData.append("amount", amount);
        formData.append("serviceType", serviceType);
        formData.append("email", email);
        if (password) formData.append("password", password);
        if (s.inv.checked) formData.append("invisible", "1");
        if (s.rot.checked) formData.append("rotation", "1");
        if (processedFile) {
            formData.append("image", processedFile, processedFile.name);
        }

        const headers = {};
        const token = getAccountToken();
        if (token) headers.Authorization = "Game " + token;

        shopPaying = true;
        updateShopPayBtn();
        if (s.pay) s.pay.textContent = "Оплата…";
        if (s.buy) s.buy.disabled = true;
        shopMsg("Создаём платёж…", true);
        try {
            const res = await fetch("https://api.agar.su/create-payment", {
                method: "POST",
                headers,
                body: formData
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                shopMsg(data.error || data.message || ("Ошибка " + res.status));
                return;
            }
            const redirect = data.confirmation && data.confirmation.confirmation_url
                ? data.confirmation.confirmation_url
                : data.redirect;
            if (redirect) {
                shopMsg("Переход к оплате…", true);
                window.location.href = redirect;
                return;
            }
            shopMsg(data.message || "Платёж создан.", true);
        } catch (err) {
            shopMsg("Сеть: не удалось создать платёж.");
        } finally {
            shopPaying = false;
            updateShopPayBtn();
            calculateShop();
        }
    }

    function bindShop() {
        const s = shopEls();
        if (!s.form) return;
        ["input", "change"].forEach((ev) => {
            s.form.addEventListener(ev, calculateShop);
        });
        $all('input[name="cabServiceType"]').forEach((r) => {
            r.addEventListener("change", () => {
                if (r.value === "clan") {
                    s.nick.maxLength = 6;
                    s.nick.placeholder = "[клан]";
                } else {
                    s.nick.maxLength = 16;
                    s.nick.placeholder = "Ваш ник";
                }
                calculateShop();
            });
        });
        s.file.addEventListener("change", () => {
            const file = s.file.files && s.file.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                s.file.value = "";
                shopMsg("Файл слишком большой (макс. 5MB).");
                return;
            }
            const type = file.type;
            if (!["image/png", "image/gif", "image/jpeg", "image/jpg"].includes(type)) {
                s.file.value = "";
                shopMsg("Только PNG, GIF, JPG/JPEG.");
                return;
            }
            shopMsg("");
            previewShopFile(file);
            calculateShop();
        });
        s.form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (s.buy && !s.buy.disabled) openShopCheckout();
        });
        if (s.buy) {
            s.buy.addEventListener("click", () => {
                if (!s.buy.disabled) openShopCheckout();
            });
        }
        if (s.email) {
            s.email.addEventListener("input", () => {
                if (!getShopEmail() || isShopEmailValid()) shopMsg("");
                updateShopPayBtn();
            });
            s.email.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    trySubmitShopEmail();
                }
            });
            s.email.addEventListener("blur", () => {
                if (shopPayOpen && isShopEmailValid()) trySubmitShopEmail();
            });
        }
        if (s.payClose) {
            s.payClose.addEventListener("mousedown", (e) => e.preventDefault());
            s.payClose.addEventListener("click", closeShopPay);
        }
        if (s.backdrop) {
            s.backdrop.addEventListener("click", () => {
                if (shopPaying) return;
                if (isShopEmailValid()) trySubmitShopEmail();
                else closeShopPay();
            });
        }
        if (s.pay) {
            s.pay.addEventListener("mousedown", (e) => e.preventDefault());
            s.pay.addEventListener("click", trySubmitShopEmail);
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && shopPayOpen && !shopPaying) closeShopPay();
        });
        calculateShop();
    }

    function openCabinet(tab) {
        if (!el.root) return;
        if (tab === "leaderboard" || tab === "donate") tab = tab === "donate" ? "shop" : "rating";
        el.root.classList.add("is-open");
        el.root.setAttribute("aria-hidden", "false");
        if (tab) setTab(tab);
        else if (!state.tab) setTab("profile");
        else updateXpUi(state.xp);
        requestAnimationFrame(() => ensureVkWidget(false));
    }
    function closeCabinet() {
        if (!el.root) return;
        el.root.classList.remove("is-open");
        el.root.setAttribute("aria-hidden", "true");
    }
    function setTab(tab) {
        const prev = state.tab;
        state.tab = tab;
        $all(".cabinet-tab", el.root).forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.tab === tab);
        });
        $all(".cabinet-section", el.root).forEach((sec) => {
            sec.classList.toggle("is-active", sec.id === "cab-" + tab);
        });
        if (tab === "skins") renderSkins();
        if (tab === "rating") renderRating();
        if (tab === "shop") calculateShop();
        if (tab === "profile") {
            requestAnimationFrame(() => ensureVkWidget(false));
            setTimeout(() => loadMyNicknames(false), 0);
        }
    }

    function refreshAll() {
        updateXpUi(state.xp);
    }

    function bindOpeners() {
        const map = [
            [".feature-button.shop", "shop"],
            [".feature-button.leaderboards", "rating"],
            [".feature-button.quests", "profile"],
            [".feature-button.gifting", "shop"],
            ["#coinShop", "shop"],
            ["#freeCoins", "shop"],
            ["#xpButton", "profile"],
            ["#massButton", "shop"],
            ["#mainui-user .user-container", "profile"],
            ["#dnaWallet", "shop"],
            ["#coinWallet", "shop"]
        ];
        map.forEach(([sel, tab]) => {
            $all(sel).forEach((node) => {
                node.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openCabinet(tab);
                });
            });
        });
        const skinBtn = document.getElementById("skinButton");
        if (skinBtn) {
            skinBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                openCabinet("skins");
            });
        }
    }

    function bindNickSkin() {
        const nickInput = document.getElementById("nick");
        if (!nickInput) return;
        let t = null;
        nickInput.addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(updateHomeSkinPreview, 280);
            if (el.nick) el.nick.textContent = currentNick();
        });
        const playBtn = document.getElementById("play");
        if (playBtn) {
            playBtn.addEventListener("click", () => {
                rememberPlayedNick(nickInput.value);
            });
        }
        const wrapSetNick = () => {
            if (!window.game || typeof window.game.setNick !== "function" || window.game.setNick._cabWrapped) return;
            const orig = window.game.setNick.bind(window.game);
            window.game.setNick = function (arg) {
                const nick = String(arg || "").split("#")[0];
                rememberPlayedNick(nick);
                return orig(arg);
            };
            window.game.setNick._cabWrapped = true;
        };
        wrapSetNick();
        setTimeout(wrapSetNick, 500);
        setTimeout(wrapSetNick, 2000);
        updateHomeSkinPreview();
    }

    function init() {
        el.root = document.getElementById("cabinet");
        if (!el.root) return;
        el.nick = $("#cabinetNick", el.root);
        el.avatar = $("#cabinetAvatar", el.root);
        el.xpFill = $("#cabinetXpFill", el.root);
        el.xpText = $("#cabinetXpText", el.root);
        el.statXp = $("#cabinetStatXp", el.root);
        el.statLvl = $("#cabinetStatLvl", el.root);
        el.statUid = $("#cabinetStatUid", el.root);
        el.ratingList = $("#cabinetRatingList", el.root);
        el.skinsGrid = $("#cabinetSkinsGrid", el.root);
        el.authGuest = $("#cabAuthGuest", el.root);
        el.authUser = $("#cabAuthUser", el.root);
        el.authAvatar = $("#cabAuthAvatar", el.root);
        el.authName = $("#cabAuthName", el.root);
        el.authMeta = $("#cabAuthMeta", el.root);

        $(".cabinet-close", el.root).addEventListener("click", closeCabinet);
        el.root.addEventListener("click", (e) => {
            if (e.target === el.root) closeCabinet();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeCabinet();
        });
        $all(".cabinet-tab", el.root).forEach((btn) => {
            btn.addEventListener("click", () => setTab(btn.dataset.tab));
        });
        const logoutBtn = $("#cabLogoutBtn", el.root);
        if (logoutBtn) logoutBtn.addEventListener("click", logoutAccount);
        $all(".cab-inv-tab", el.root).forEach((btn) => {
            btn.addEventListener("click", () => setInvTab(btn.dataset.inv));
        });
        if (el.skinsGrid) {
            el.skinsGrid.addEventListener("click", (e) => {
                const btn = e.target.closest(".cabinet-skin");
                if (!btn) return;
                state.selectedSkin = btn.dataset.code || "";
                localStorage.setItem("cabinetSkin", state.selectedSkin);
                const nickField = document.getElementById("nick");
                if (nickField && btn.dataset.nick) {
                    nickField.value = btn.dataset.nick;
                    nickField.dispatchEvent(new Event("input", { bubbles: true }));
                }
                if (btn.dataset.nick) rememberPlayedNick(btn.dataset.nick);
                updateHomeSkinPreview();
                renderSkins();
                closeCabinet();
            });
        }

        bindShop();
        bindOpeners();
        bindNickSkin();
        const warmSkins = () => { ensureSkinMap().catch(() => {}); };
        if (typeof requestIdleCallback === "function") requestIdleCallback(warmSkins, { timeout: 4000 });
        else setTimeout(warmSkins, 1500);
        window.onVkAuth = completeVkLogin;
        handleVkUrlCallback();
        loadAccountProfile();
        state.tab = "profile";
        $all(".cabinet-tab", el.root).forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.tab === "profile");
        });
        $all(".cabinet-section", el.root).forEach((sec) => {
            sec.classList.toggle("is-active", sec.id === "cab-profile");
        });
        renderInventory();

        window.AgarCabinet = {
            open: openCabinet,
            close: closeCabinet,
            setXp: updateXpUi,
            getXp: () => state.xp,
            setUid: (uid) => { state.uid = uid; if (el.statUid) el.statUid.textContent = uid != null ? String(uid) : "—"; },
            rememberSkin: rememberPlayedNick,
            refresh: refreshAll
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
