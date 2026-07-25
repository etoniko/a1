/**
 * Блокировка кнопки Play на 1.5 с:
 * - после смерти (серая кнопка + цифры)
 * - после клика Play — меню закрывается и респавн только через 1.5 с
 */
(function () {
    "use strict";

    var LOCK_MS = 1500;
    var DEFAULT_LABEL = "Play";
    var timerId = null;
    var lockedUntil = 0;
    var pendingPlay = false;

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

    function runCountdown(ms, onDone) {
        clearTimer();
        lockedUntil = Date.now() + ms;
        setVisual(true, formatLeft(ms));

        timerId = setInterval(function () {
            var left = lockedUntil - Date.now();
            if (left <= 0) {
                clearTimer();
                if (typeof onDone === "function") onDone();
                return;
            }
            setVisual(true, formatLeft(left));
        }, 50);
    }

    function unlockIdle() {
        pendingPlay = false;
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
        pendingPlay = false;
        setVisual(false, DEFAULT_LABEL);
        if (typeof window.setNick === "function") {
            window.setNick(nickPayload());
        }
    }

    function lockAfterDeath() {
        pendingPlay = false;
        runCountdown(LOCK_MS, unlockIdle);
    }

    function onPlayClick() {
        var btn = playBtn();
        if (!btn) return false;

        if (btn.disabled || pendingPlay || Date.now() < lockedUntil) {
            return false;
        }

        pendingPlay = true;
        runCountdown(LOCK_MS, doSpawn);
        return false;
    }

    window.AgarPlayGate = {
        lockAfterDeath: lockAfterDeath,
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
    });
})();
