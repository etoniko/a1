/**
 * Авто-вход в игру через 1.5 с:
 * - при загрузке меню
 * - после смерти
 * Клик Play без ожидания — сразу спавн (если кнопка не в локе).
 */
(function () {
    "use strict";

    var LOCK_MS = 1500;
    var DEFAULT_LABEL = "Play";
    var timerId = null;
    var lockedUntil = 0;
    var autoStarted = false;

    function playBtn() {
        return document.getElementById("play");
    }

    function formatLeft(ms) {
        var s = Math.max(0, ms) / 1000;
        return s.toFixed(1);
    }

    function setVisual(locked, text) {
        var btn = playBtn();
        if (!btn) return;
        btn.disabled = !!locked;
        btn.classList.toggle("play-locked", !!locked);
        btn.setAttribute("aria-disabled", locked ? "true" : "false");
        btn.textContent = text;
    }

    function clearTimer() {
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function unlockIdle() {
        lockedUntil = 0;
        setVisual(false, DEFAULT_LABEL);
    }

    function nickPayload() {
        var nick = document.getElementById("nick");
        var pass = document.getElementById("pass");
        var n = nick ? nick.value : "";
        var p = pass ? pass.value : "";
        return n + "#" + p;
    }

    function doSpawn() {
        clearTimer();
        unlockIdle();
        if (typeof window.setNick === "function") {
            window.setNick(nickPayload());
        }
    }

    function runCountdown(ms, onDone) {
        clearTimer();
        lockedUntil = Date.now() + ms;
        setVisual(true, formatLeft(ms));

        timerId = setInterval(function () {
            var left = lockedUntil - Date.now();
            if (left <= 0) {
                clearTimer();
                lockedUntil = 0;
                if (typeof onDone === "function") onDone();
                return;
            }
            setVisual(true, formatLeft(left));
        }, 50);
    }

    /** После смерти / при входе: 1.5 с и авто-спавн */
    function scheduleAutoPlay() {
        runCountdown(LOCK_MS, doSpawn);
    }

    function onPlayClick() {
        var btn = playBtn();
        if (!btn) return false;

        // Во время отсчёта клик игнорируем — ждём авто-вход
        if (btn.disabled || Date.now() < lockedUntil) {
            return false;
        }

        doSpawn();
        return false;
    }

    function tryStartOnLoad() {
        if (autoStarted) return;
        if (typeof window.setNick !== "function") return;
        autoStarted = true;
        scheduleAutoPlay();
    }

    window.AgarPlayGate = {
        lockAfterDeath: scheduleAutoPlay,
        scheduleAutoPlay: scheduleAutoPlay,
        onPlayClick: onPlayClick,
        LOCK_MS: LOCK_MS,
    };

    document.addEventListener("DOMContentLoaded", function () {
        var btn = playBtn();
        if (!btn) return;
        if (!btn.dataset.defaultLabel) {
            btn.dataset.defaultLabel = (btn.textContent || DEFAULT_LABEL).trim() || DEFAULT_LABEL;
            DEFAULT_LABEL = btn.dataset.defaultLabel;
        }
        btn.removeAttribute("onclick");
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            onPlayClick();
        });

        // setNick появляется после инициализации game — подождём
        var tries = 0;
        var wait = setInterval(function () {
            tries++;
            tryStartOnLoad();
            if (autoStarted || tries > 100) clearInterval(wait);
        }, 50);
    });
})();
