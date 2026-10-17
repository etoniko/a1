/**
 * Simple keyword antimat for a1.
 * One check: case-insensitive substring match against word.txt → "***"
 * Used for: chat, cell name, leaderboard name.
 */
(function (global) {
  "use strict";

  const MASK = "***";
  let words = []; // normalized keywords, longest first

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ё/g, "е");
  }

  function isUsefulKeyword(raw) {
    const w = normalize(raw).trim();
    if (w.length < 3) return false;
    // only letters / digits / spaces inside phrase
    if (!/^[a-zа-я0-9]+(?:\s+[a-zа-я0-9]+)*$/i.test(w)) return false;
    return true;
  }

  function setBadWords(list) {
    const set = new Set();
    (list || []).forEach((line) => {
      if (!isUsefulKeyword(line)) return;
      set.add(normalize(line).trim());
    });
    words = Array.from(set).sort((a, b) => b.length - a.length);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function censor(message) {
    if (!message || !words.length) return message == null ? "" : String(message);
    let out = String(message);
    const lower = normalize(out);
    // Walk longest keywords first; rebuild after each hit to keep indices simple.
    for (let wi = 0; wi < words.length; wi++) {
      const key = words[wi];
      let from = 0;
      let lowerCur = normalize(out);
      while (from < lowerCur.length) {
        const idx = lowerCur.indexOf(key, from);
        if (idx === -1) break;
        out = out.slice(0, idx) + MASK + out.slice(idx + key.length);
        lowerCur = normalize(out);
        from = idx + MASK.length;
      }
    }
    return out;
  }

  function loadFromUrl(url) {
    return fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then((text) => {
        const list = text.split(/\r?\n/);
        setBadWords(list);
        return words.length;
      });
  }

  const api = {
    censor,
    setBadWords,
    loadFromUrl,
    isReady() {
      return words.length > 0;
    },
    size() {
      return words.length;
    },
  };

  global.AgarAntimat = api;

  try {
    api.loadFromUrl("./word.txt").then((n) => {
      console.info("[antimat] simple keywords:", n);
    }).catch((e) => console.warn("[antimat] load failed", e));
  } catch (e) {
    console.warn("[antimat] init failed", e);
  }
})(typeof window !== "undefined" ? window : globalThis);
