(function () {
    const SKIN_CDN = "https://api.agar.su/skins/";
    const SKIN_FALLBACK = "https://api.agar.su/skins/4.png";
    const TOP100_URL = "https://api.agar.su/api/top100";
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

    function getAccountToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
    }
    function setAccountToken(token) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* ignore */ }
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
        rating: null,
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

    async function ensureSkinMap() {
        if (state.skinMap) return state.skinMap;
        const map = Object.create(null);
        const g = window.game;
        if (g && g.skinMap && Object.keys(g.skinMap).length) {
            Object.keys(g.skinMap).forEach((k) => { map[k] = g.skinMap[k]; });
            state.skinMap = map;
            return map;
        }
        try {
            const res = await fetch("https://api.agar.su/skinlist.txt", { cache: "no-store" });
            const text = await res.text();
            text.split(/\r?\n/).forEach((line) => {
                const idx = line.indexOf(":");
                if (idx < 0) return;
                const nick = line.slice(0, idx).trim();
                const code = line.slice(idx + 1).trim();
                const key = normalizeNick(nick);
                if (key && code) map[key] = code;
            });
        } catch (e) { /* empty map */ }
        state.skinMap = map;
        return map;
    }
    async function resolveSkinCode(nickOrKey) {
        const map = await ensureSkinMap();
        const key = normalizeNick(nickOrKey);
        return key ? (map[key] || null) : null;
    }
    function skinUrl(code) {
        return code ? SKIN_CDN + encodeURIComponent(code) + ".png" : "";
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
        updateHomeSkinPreview();
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
            updateAuthUi();
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
                updateAuthUi();
                return;
            }
            state.accountName = data.account_name || null;
            state.accountAvatar = data.account_avatar || null;
            state.uid = data.uid != null ? data.uid : null;
            if (data.xp != null) updateXpUi(data.xp);
            else updateAuthUi();
        } catch (e) {
            updateAuthUi();
        }
    }

    function logoutAccount() {
        setAccountToken("");
        state.accountName = null;
        state.accountAvatar = null;
        state.uid = null;
        updateXpUi(state.xp);
        updateAuthUi();
        initVkAuth(true);
    }

    async function completeVkLogin(payload) {
        if (!payload || !payload.code || !payload.device_id) {
            alert("VK: не получен код авторизации");
            return;
        }
        try {
            const res = await fetch("https://api.agar.su/api/auth/vk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.error || !data.token) {
                alert(data.error || "Ошибка авторизации");
                return;
            }
            setAccountToken(data.token);
            await loadAccountProfile();
            openCabinet("profile");
        } catch (e) {
            alert("Ошибка сети при авторизации");
        }
    }

    function initVkAuth(force) {
        if (!("VKIDSDK" in window)) return;
        const container = document.getElementById("VkIdSdkOAuthList");
        if (!container) return;
        if (getAccountToken() && !force) {
            updateAuthUi();
            return;
        }
        if (state.vkReady && !force) return;

        const params = new URLSearchParams(window.location.search);
        if (params.get("code") && params.get("device_id")) {
            const cv = sessionStorage.getItem("vk_code_verifier");
            const st = sessionStorage.getItem("vk_state");
            if (cv && st) {
                completeVkLogin({
                    code: params.get("code"),
                    device_id: params.get("device_id"),
                    code_verifier: cv,
                    state: st
                });
            }
            window.history.replaceState({}, "", window.location.pathname + window.location.hash);
        }

        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
        const rnd = (n) => {
            const b = new Uint8Array(n);
            crypto.getRandomValues(b);
            let s = "";
            for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
            return s;
        };
        const codeVerifier = rnd(64);
        const stateStr = rnd(32);
        sessionStorage.setItem("vk_code_verifier", codeVerifier);
        sessionStorage.setItem("vk_state", stateStr);

        const VKID = window.VKIDSDK;
        try {
            VKID.Config.init({
                app: VK_APP,
                redirectUrl: VK_REDIRECT,
                state: stateStr,
                codeVerifier,
                responseMode: VKID.ConfigResponseMode.Callback,
                source: VKID.ConfigSource.LOWCODE,
                scope: ""
            });
            container.innerHTML = "";
            const oauthList = [VKID.OAuthName.VK, VKID.OAuthName.MAIL, VKID.OAuthName.OK];
            new VKID.OAuthList().render({
                container,
                oauthList,
                scheme: VKID.Scheme.LIGHT,
                lang: VKID.Languages.RUS,
                styles: { height: 44, borderRadius: 10 }
            }).on(VKID.WidgetEvents.ERROR, (err) => {
                console.error("VK ID error", err);
            }).on(VKID.OAuthListInternalEvents.LOGIN_SUCCESS, (payload) => {
                completeVkLogin({
                    code: payload.code,
                    device_id: payload.device_id,
                    code_verifier: codeVerifier,
                    state: stateStr
                });
            });
            state.vkReady = true;
        } catch (e) {
            console.error("VK ID init failed", e);
        }
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
            const code = item.code || state.skinMap[key];
            if (!code) continue;
            seen.add(key);
            skins.push({ nick: item.nick, code: String(code) });
        }
        if (!skins.length) {
            el.skinsGrid.innerHTML = '<div class="cabinet-skin-empty">Пока пусто.<br>Сыграй под ником со скином — он появится здесь.<br>Или закажи скин в магазине.</div>';
            return;
        }
        el.skinsGrid.innerHTML = skins.map((s) => {
            const sel = state.selectedSkin === s.code ? " is-selected" : "";
            return '<button type="button" class="cabinet-skin' + sel + '" data-code="' + escapeHtml(s.code) +
                '" data-nick="' + escapeHtml(s.nick) +
                '" style="background-image:url(\'' + skinUrl(s.code) + '\')" title="' +
                escapeHtml(s.nick) + '"><span class="tag">' + escapeHtml(s.nick) + "</span></button>";
        }).join("");
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
            total: document.getElementById("cabTotal")
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
        if (file) skinCost = file.type === "image/gif" ? 4500 : 150;
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
        const url = URL.createObjectURL(file);
        const isGif = file.type === "image/gif";
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
    }
    async function submitShop(e) {
        e.preventDefault();
        const s = shopEls();
        const nickname = (s.nick.value || "").trim().toLowerCase();
        const password = (s.pass.value || "").trim().toLowerCase();
        const file = s.file.files && s.file.files[0];
        const serviceType = (document.querySelector('input[name="cabServiceType"]:checked') || {}).value || "personal";
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
        const mult = shopMultiplier();
        const passwordCost = password ? 1 : 0;
        const skinCost = file ? (file.type === "image/gif" ? 2 : 1) : 0;
        const amount = (passwordCost + skinCost) * mult;
        const formData = new FormData();
        formData.append("name", nickname);
        formData.append("amount", amount);
        formData.append("serviceType", serviceType);
        if (password) formData.append("password", password);
        if (s.inv.checked) formData.append("invisible", "1");
        if (s.rot.checked) formData.append("rotation", "1");
        if (file) formData.append("image", file, file.name);

        const headers = {};
        const token = getAccountToken();
        if (token) headers.Authorization = "Game " + token;

        s.buy.disabled = true;
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
                calculateShop();
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
        }
        calculateShop();
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
            if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) {
                s.file.value = "";
                shopMsg("Только PNG, JPG, GIF.");
                return;
            }
            shopMsg("");
            previewShopFile(file);
            calculateShop();
        });
        s.form.addEventListener("submit", submitShop);
        calculateShop();
    }

    function openCabinet(tab) {
        if (!el.root) return;
        if (tab === "leaderboard" || tab === "donate") tab = tab === "donate" ? "shop" : "rating";
        if (tab) setTab(tab);
        refreshAll();
        el.root.classList.add("is-open");
        el.root.setAttribute("aria-hidden", "false");
    }
    function closeCabinet() {
        if (!el.root) return;
        el.root.classList.remove("is-open");
        el.root.setAttribute("aria-hidden", "true");
    }
    function setTab(tab) {
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
    }

    function refreshAll() {
        updateXpUi(state.xp);
        if (state.tab === "rating") renderRating();
        if (state.tab === "skins") renderSkins();
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
        // Skin circle near nick: preview only; click opens played skins
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
        // Wrap setNick if available later
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
                updateHomeSkinPreview();
                renderSkins();
                closeCabinet();
            });
        }

        bindShop();
        bindOpeners();
        bindNickSkin();
        ensureSkinMap();
        window.onVkAuth = completeVkLogin;
        const bootVk = () => initVkAuth(false);
        if ("VKIDSDK" in window) bootVk();
        else document.querySelector('script[src*="@vkid/sdk"]')?.addEventListener("load", bootVk);
        loadAccountProfile();
        updateXpUi(0);
        setTab("profile");

        window.AgarCabinet = {
            open: openCabinet,
            close: closeCabinet,
            setXp: updateXpUi,
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
