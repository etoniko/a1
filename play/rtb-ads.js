/**
 * РСЯ (Yandex RTB) — агарио.рф
 *
 * Куда вставить ID после создания блоков в кабинете:
 *   https://partner.yandex.ru → Реклама на сайтах → Блоки
 *
 * Нужные блоки (все на площадке агарио.рф):
 * 1) Баннер          → bannerMenu
 * 2) Баннер          → sidebarLeft / sidebarRight / stripBottom
 * 3) Полноэкранный   → fullscreenTouch   (мобильная; показ при смерти)
 * 4) Полноэкранный   → fullscreenDesktop (десктоп; показ при смерти)
 *
 * В настройках полноэкранных блоков:
 * - Порог CPM: «Максимальный доход»
 * - Частота: не чаще 1 раза / 5 мин (или мягче) — Яндекс сам режет оверпоказ
 * - Видеореклама: включена (стандартные настройки)
 * - Разрешённые разделы: /play
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
    };

    window.AGAR_RSYA = CFG;

    var aliveSince = 0;
    var fsShowing = false;

    function hasId(id) {
        return typeof id === "string" && id.indexOf("R-A-") === 0;
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
    }

    function refreshBanners() {
        renderBanners();
    }

    /** Полноэкранный (в т.ч. видео) — только после смерти игрока. */
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

    var AgarAds = {
        config: CFG,

        init: function () {
            renderBanners();
        },

        onPlayerSpawn: function () {
            aliveSince = Date.now();
        },

        /** Смерть (0 клеток): меню + обновление баннеров + fullscreen. */
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

    document.addEventListener("DOMContentLoaded", function () {
        whenYa(function () {
            AgarAds.init();
        });
    });
})();
