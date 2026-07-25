(function () {
    const DONATE_URL = "https://lk.agar.su/";
    const ACCOUNT_URL = "https://agar.su/account";
    const SKIN_CDN = "https://api.agar.su/skins/";

    function xpForLevel(level) {
        return 50 * level * level;
    }
    function levelFromXp(xp) {
        xp = Math.max(0, xp | 0);
        return Math.max(0, Math.floor(Math.sqrt(xp / 50)));
    }
    function xpProgress(xp) {
        const level = levelFromXp(xp);
        const cur = xpForLevel(level);
        const next = xpForLevel(level + 1);
        const span = Math.max(1, next - cur);
        const pct = Math.min(100, Math.max(0, ((xp - cur) / span) * 100));
        return { level, cur, next, pct, xp };
    }

    const el = {
        root: null,
        nick: null,
        xpFill: null,
        xpText: null,
        starLvl: null,
        statXp: null,
        statLvl: null,
        statRank: null,
        lbList: null,
        skinsGrid: null
    };

    let state = {
        xp: 0,
        tab: "profile",
        skins: [],
        passNicks: null,
        selectedSkin: localStorage.getItem("cabinetSkin") || ""
    };

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

    function starClass(level) {
        if (level >= 200) return "black";
        if (level >= 150) return "white";
        if (level >= 100) return "red";
        if (level >= 50) return "azure";
        return "";
    }

    function starHtml(level) {
        if (level == null || level < 0) return "";
        const cls = starClass(level);
        return '<span class="cab-star' + (cls ? " " + cls : "") + '" title="Уровень ' + level + '">' +
            '<span class="cab-star-icon">★</span>' +
            (level < 200 ? '<span class="cab-star-lvl">' + level + '</span>' : "") +
            "</span>";
    }

    async function ensurePassNicks() {
        if (state.passNicks) return state.passNicks;
        try {
            const res = await fetch("https://api.agar.su/pass.txt", { cache: "no-store" });
            const text = await res.text();
            state.passNicks = new Set(
                text.split(/\r?\n/).map(normalizeNick).filter(Boolean)
            );
        } catch (e) {
            state.passNicks = new Set();
        }
        return state.passNicks;
    }

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }
    function $all(sel, root) {
        return Array.from((root || document).querySelectorAll(sel));
    }

    function openCabinet(tab) {
        if (!el.root) return;
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
        if (tab === "leaderboard") renderLeaderboard();
    }

    function currentNick() {
        const input = document.getElementById("nick");
        const v = (input && input.value.trim()) || "";
        return v || "Гость";
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

        const uname = $(".user-name");
        if (uname) uname.textContent = currentNick();
        if (el.nick) el.nick.textContent = currentNick();
    }

    function renderLeaderboard() {
        if (!el.lbList) return;
        const g = window.game;
        const rows = (g && Array.isArray(g.leaderBoard)) ? g.leaderBoard : [];
        if (!rows.length) {
            el.lbList.innerHTML = '<li class="cabinet-muted" style="display:block;background:transparent;font-weight:400">Подключись к серверу и зайди в игру — здесь появится топ и твоё место.</li>';
            if (el.statRank) el.statRank.textContent = "—";
            return;
        }

        let myRank = null;
        const myIds = (g.playerCells || []).map((c) => c.id);
        for (let i = 0; i < rows.length; i++) {
            if (myIds.includes(rows[i].id)) {
                myRank = i + 1;
                break;
            }
        }
        if (el.statRank) el.statRank.textContent = myRank ? String(myRank) : "—";

        const top = rows.slice(0, 10);
        let html = top.map((row, i) => {
            const rank = i + 1;
            const isMe = myIds.includes(row.id);
            const lvl = (row.level != null && row.level >= 0)
                ? row.level
                : (row.xp ? levelFromXp(row.xp) : -1);
            const podium = rank <= 3 ? '<span class="cabinet-podium" title="Топ"></span>' : "";
            return '<li class="' + (isMe ? "is-me" : "") + '">' +
                podium +
                '<span class="rank">' + rank + '</span>' +
                starHtml(lvl) +
                '<span class="name">' + escapeHtml(row.name || "An unnamed cell") + '</span></li>';
        }).join("");

        if (myRank && myRank > 10) {
            const me = rows[myRank - 1];
            const lvl = (me && me.level != null && me.level >= 0)
                ? me.level
                : (me && me.xp ? levelFromXp(me.xp) : -1);
            html += '<li class="is-me"><span class="rank">' + myRank + '</span>' +
                starHtml(lvl) +
                '<span class="name">' + escapeHtml(currentNick()) + '</span></li>';
        }
        el.lbList.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    async function ensureSkins() {
        if (state.skins.length) return state.skins;
        const pass = await ensurePassNicks();
        let raw = [];
        try {
            const res = await fetch("https://api.agar.su/skinlist.txt", { cache: "no-store" });
            const text = await res.text();
            text.split(/\r?\n/).forEach((line) => {
                const idx = line.indexOf(":");
                if (idx < 0) return;
                const nick = line.slice(0, idx).trim();
                const code = line.slice(idx + 1).trim();
                if (nick && code) raw.push({ nick, code });
            });
        } catch (e) {
            const g = window.game;
            if (g && g.skinMap) {
                raw = Object.keys(g.skinMap).map((nick) => ({ nick, code: g.skinMap[nick] }));
            }
        }
        // Free skins only: nick NOT listed in pass.txt (pass = paid/protected)
        state.skins = raw.filter((s) => !pass.has(normalizeNick(s.nick)));
        return state.skins;
    }

    async function renderSkins() {
        if (!el.skinsGrid) return;
        el.skinsGrid.innerHTML = '<div class="cabinet-skin-empty">Загрузка скинов…</div>';
        const skins = await ensureSkins();
        if (!skins.length) {
            el.skinsGrid.innerHTML = '<div class="cabinet-skin-empty">Скины пока недоступны. Закажи свой в магазине.</div>';
            return;
        }
        el.skinsGrid.innerHTML = skins.map((s) => {
            const sel = state.selectedSkin === s.code ? " is-selected" : "";
            return '<button type="button" class="cabinet-skin' + sel + '" data-code="' + escapeHtml(s.code) +
                '" style="background-image:url(\'' + SKIN_CDN + encodeURIComponent(s.code) + '.png\')" title="' +
                escapeHtml(s.nick) + '"><span class="tag">' + escapeHtml(s.nick) + '</span></button>';
        }).join("");
    }

    function refreshAll() {
        updateXpUi(state.xp);
        renderLeaderboard();
    }

    function bindOpeners() {
        const map = [
            [".feature-button.shop", "donate"],
            [".feature-button.leaderboards", "leaderboard"],
            [".feature-button.quests", "profile"],
            [".feature-button.gifting", "donate"],
            ["#coinShop", "donate"],
            ["#freeCoins", "donate"],
            ["#xpButton", "profile"],
            ["#massButton", "donate"],
            ["#skinButton", "skins"],
            ["#mainui-user .user-container", "profile"],
            ["#dnaWallet", "donate"],
            ["#coinWallet", "donate"]
        ];
        map.forEach(([sel, tab]) => {
            $all(sel).forEach((node) => {
                node.addEventListener("click", (e) => {
                    // skin button is inside <a> — prevent navigation
                    e.preventDefault();
                    e.stopPropagation();
                    openCabinet(tab);
                });
            });
        });
    }

    function init() {
        el.root = document.getElementById("cabinet");
        if (!el.root) return;
        el.nick = $("#cabinetNick", el.root);
        el.xpFill = $("#cabinetXpFill", el.root);
        el.xpText = $("#cabinetXpText", el.root);
        el.statXp = $("#cabinetStatXp", el.root);
        el.statLvl = $("#cabinetStatLvl", el.root);
        el.statRank = $("#cabinetStatRank", el.root);
        el.lbList = $("#cabinetLbList", el.root);
        el.skinsGrid = $("#cabinetSkinsGrid", el.root);

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
        if (el.skinsGrid) {
            el.skinsGrid.addEventListener("click", (e) => {
                const btn = e.target.closest(".cabinet-skin");
                if (!btn) return;
                state.selectedSkin = btn.dataset.code || "";
                localStorage.setItem("cabinetSkin", state.selectedSkin);
                renderSkins();
            });
        }

        bindOpeners();
        updateXpUi(0);
        setTab("profile");

        window.AgarCabinet = {
            open: openCabinet,
            close: closeCabinet,
            setXp: updateXpUi,
            refresh: refreshAll
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
