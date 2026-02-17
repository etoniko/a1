// ===== YANDEX ADS CONTROLLER =====

// защита от частых показов
window.lastFullscreenAdTime = 0;

// функция показа fullscreen рекламы
window.showYandexFullscreenAd = function () {

    // если Яндекс ещё не загрузился — не падаем
    if (!window.yaContextCb) {
        console.log("Yandex not ready");
        return;
    }

    const now = Date.now();

    // cooldown 60 сек
    if (now - window.lastFullscreenAdTime < 60000) {
        console.log("Ad cooldown");
        return;
    }

    window.lastFullscreenAdTime = now;

    console.log("Show fullscreen ad");

    window.yaContextCb.push(() => {
        Ya.Context.AdvManager.render({
            blockId: "R-A-17463228-5",
            type: "fullscreen",
            platform: "desktop"
        });
    });
};
