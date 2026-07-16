/**
 * РСЯ (Yandex RTB) — агарио.рф
 *
 * Куда вставить ID после создания блоков в кабинете:
 *   https://partner.yandex.ru → Реклама на сайтах → Блоки
 *
 * Нужные блоки (все на площадке агарио.рф):
 * 1) Баннер          → bannerMenu
 * 2) Баннер          → sidebarLeft / sidebarRight / stripBottom
 * 3) Полноэкранный   → fullscreenTouch   (платформа: Мобильная, форматы: стандарт = с видео)
 * 4) Полноэкранный   → fullscreenDesktop (платформа: Десктопная; показ при переходе на /play/)
 *
 * В настройках полноэкранных блоков:
 * - Порог CPM: «Максимальный доход»
 * - Частота: не чаще 1 раза / 5 мин (или мягче) — Яндекс сам режет оверпоказ
 * - Видеореклама: включена (стандартные настройки)
 * - Разрешённые разделы для desktop FS: /play
 */
(function () {
    "use strict";

    var CFG = {
        // === ВСТАВЬТЕ СВОИ ID (вид R-A-XXXXXXXX-N) ===
        bannerMenu: "R-A-17463228-13",
        sidebarLeft: "R-A-17463228-14",
        sidebarRight: "R-A-17463228-15",
        stripBottom: "R-A-17463228-13",
        fullscreenTouch: "R-A-17463228-17",
        fullscreenDesktop: "R-A-17463228-18",

        /** Мин. пауза между полноэкранными показами после смерти (клиент). */
        deathCooldownMs: 90 * 1000,
        /** Не крутить death-рекламу, если раунд короче этого. */
        minAliveMs: 12 * 1000,
        /** Ключ storage для кулдауна. */
        cooldownKey: "agar_rsya_fs_at",
        playPath: "/play/",
    };

    window.AGAR_RSYA = CFG;

    var aliveSince = 0;
    var fsShowing = false;
    var bannersReady = false;

    function hasId(id) {
        return typeof id === "string" && id.indexOf("R-A-") === 0;
    }

    function isPlayPath() {
        return /\/play\/?$/i.test(location.pathname) || /\/play\//i.test(location.pathname);
    }

    function getPlatform() {
        try {
            if (window.Ya && Ya.Context && Ya.Context.AdvManager && Ya.Context.AdvManager.getPlatform) {
                return Ya.Context.AdvManager.getPlatform();
            }
        } catch (e) {}
        return window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? "touch" : "desktop";
    }

    function whenYa(fn) {
        window.yaContextCb = window.yaContextCb || [];
        window.yaContextCb.push(fn);
    }

    function cooldownOk() {
        try {
            var last = parseInt(localStorage.getItem(CFG.cooldownKey) || "0", 10);
            return !last || Date.now() - last >= CFG.deathCooldownMs;
        } catch (e) {
            return true;
        }
    }

    function markShown() {
        try {
            localStorage.setItem(CFG.cooldownKey, String(Date.now()));
        } catch (e) {}
    }

    function renderBanner(blockId, renderTo) {
        if (!hasId(blockId)) return;
        var el = document.getElementById(renderTo);
        if (!el) return;
        el.innerHTML = "";
        whenYa(function () {
            try {
                Ya.Context.AdvManager.render({
                    blockId: blockId,
                    renderTo: renderTo,
                });
            } catch (e) {
                console.warn("[RSYa] banner", blockId, e);
            }
        });
    }

    function renderBanners() {
        renderBanner(CFG.bannerMenu, "yandex_rtb_banner_menu");
        renderBanner(CFG.sidebarLeft, "yandex_rtb_sidebar_left");
        renderBanner(CFG.sidebarRight, "yandex_rtb_sidebar_right");
        renderBanner(CFG.stripBottom, "yandex_rtb_strip_bottom");
        bannersReady = true;
    }

    function refreshBanners() {
        renderBanners();
    }

    /**
     * Полноэкранный (в т.ч. видео). На desktop РСЯ ориентирован на переход страниц → /play/.
     */
    function showFullscreen(reason) {
        if (fsShowing) return false;
        var platform = getPlatform();
        var blockId = platform === "desktop" ? CFG.fullscreenDesktop : CFG.fullscreenTouch;
        if (!hasId(blockId)) {
            console.warn("[RSYa] нет ID fullscreen для", platform, "— вставьте в AGAR_RSYA");
            return false;
        }
        if (!cooldownOk()) return false;

        fsShowing = true;
        markShown();

        whenYa(function () {
            try {
                Ya.Context.AdvManager.render({
                    blockId: blockId,
                    type: "fullscreen",
                    platform: platform,
                    onClose: function () {
                        fsShowing = false;
                    },
                });
            } catch (e) {
                fsShowing = false;
                console.warn("[RSYa] fullscreen", reason, e);
            }
        });
        return true;
    }

    /** Desktop: реальный переход на /play/ (иначе fullscreen desktop почти не крутится). */
    function ensurePlayPathForDesktop(nickPayload) {
        if (getPlatform() !== "desktop") return false;
        if (!hasId(CFG.fullscreenDesktop)) return false;
        if (isPlayPath()) return false;
        try {
            sessionStorage.setItem("agar_pending_nick", nickPayload || "");
            sessionStorage.setItem("agar_autostart", "1");
        } catch (e) {}
        var target = CFG.playPath;
        if (location.search) target += location.search;
        if (location.hash) target += location.hash;
        location.href = target;
        return true;
    }

    var AgarAds = {
        config: CFG,

        init: function () {
            renderBanners();
            // Desktop fullscreen — при заходе на /play/ (внутренняя страница).
            if (isPlayPath() && getPlatform() === "desktop") {
                showFullscreen("enter-play");
            }
            tryAutostart();
        },

        onPlayClick: function (nickPayload) {
            // Автостарт после перехода на /play/ — не уводить в reload-цикл.
            if (window.__agarAdsAutostart) {
                window.__agarAdsAutostart = false;
                aliveSince = Date.now();
                return false;
            }
            aliveSince = Date.now();
            if (ensurePlayPathForDesktop(nickPayload)) return true;
            // Повторный Play уже на /play/: reload → pageview для desktop FS (кулдаун проверит init).
            if (
                getPlatform() === "desktop" &&
                isPlayPath() &&
                hasId(CFG.fullscreenDesktop) &&
                cooldownOk()
            ) {
                try {
                    sessionStorage.setItem("agar_pending_nick", nickPayload || "");
                    sessionStorage.setItem("agar_autostart", "1");
                } catch (e) {}
                location.href = CFG.playPath + "?t=" + Date.now() + (location.hash || "");
                return true;
            }
            return false;
        },

        onPlayerSpawn: function () {
            aliveSince = Date.now();
        },

        /** Смерть: меню + обновление баннеров + fullscreen/видео с таймингом. */
        onPlayerDeath: function () {
            refreshBanners();
            var lived = aliveSince ? Date.now() - aliveSince : CFG.minAliveMs;
            if (lived < CFG.minAliveMs) return;
            showFullscreen("death");
        },

        showFullscreen: showFullscreen,
        refreshBanners: refreshBanners,
    };

    window.AgarAds = AgarAds;

    function tryAutostart() {
        var autostart = false;
        var nick = "";
        try {
            autostart = sessionStorage.getItem("agar_autostart") === "1";
            nick = sessionStorage.getItem("agar_pending_nick") || "";
            sessionStorage.removeItem("agar_autostart");
            sessionStorage.removeItem("agar_pending_nick");
        } catch (e) {}
        if (!autostart || !nick) return;
        var start = function () {
            if (typeof window.setNick === "function") {
                window.__agarAdsAutostart = true;
                window.setNick(nick);
            } else {
                setTimeout(start, 50);
            }
        };
        setTimeout(start, 100);
    }

    // Перехват Play до setNick (desktop → /play/).
    document.addEventListener("DOMContentLoaded", function () {
        var origSetNick = null;
        function wrapSetNick() {
            if (typeof window.setNick !== "function") return false;
            if (window.setNick._agarAdsWrapped) return true;
            origSetNick = window.setNick;
            window.setNick = function (arg) {
                if (AgarAds.onPlayClick(arg)) return;
                return origSetNick.apply(this, arguments);
            };
            window.setNick._agarAdsWrapped = true;
            return true;
        }
        if (!wrapSetNick()) {
            var n = 0;
            var t = setInterval(function () {
                if (wrapSetNick() || ++n > 80) clearInterval(t);
            }, 50);
        }
        whenYa(function () {
            AgarAds.init();
        });
    });
})();
