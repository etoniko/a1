/**
 * РСЯ (Yandex RTB) — агарио.рф
 * Только баннеры (без полноэкранных). Можно размещать на /.
 *
 * ID блоков: https://partner.yandex.ru → Реклама на сайтах → Блоки
 */
(function () {
    "use strict";

    var CFG = {
        bannerMenu: "R-A-17463228-13",
        sidebarLeft: "R-A-17463228-14",
        sidebarRight: "R-A-17463228-15",
        stripBottom: "R-A-17463228-13",
    };

    window.AGAR_RSYA = CFG;

    function hasId(id) {
        return typeof id === "string" && id.indexOf("R-A-") === 0;
    }

    function whenYa(fn) {
        window.yaContextCb = window.yaContextCb || [];
        window.yaContextCb.push(fn);
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

    var AgarAds = {
        config: CFG,

        init: function () {
            renderBanners();
        },

        onPlayerSpawn: function () {},

        onPlayerDeath: function () {
            renderBanners();
            if (window.AgarPlayGate && typeof window.AgarPlayGate.lockAfterDeath === "function") {
                window.AgarPlayGate.lockAfterDeath();
            }
        },

        refreshBanners: renderBanners,
    };

    window.AgarAds = AgarAds;

    document.addEventListener("DOMContentLoaded", function () {
        whenYa(function () {
            AgarAds.init();
        });
    });
})();
