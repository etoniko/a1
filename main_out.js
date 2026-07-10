const serverPowSupportCache = new Map();

const CANVAS_FONT_FAMILY = "Ubuntu";
let canvasFontReady = false;

function canvasFont(sizePx) {
    return `bold ${sizePx}px ${CANVAS_FONT_FAMILY}`;
}

function ensureCanvasFont() {
    if (canvasFontReady) return Promise.resolve();
    if (!document.fonts || !document.fonts.load) {
        canvasFontReady = true;
        return Promise.resolve();
    }
    return Promise.all([
        document.fonts.load(`700 12px ${CANVAS_FONT_FAMILY}`),
        document.fonts.load(`700 24px ${CANVAS_FONT_FAMILY}`),
        document.fonts.load(`700 48px ${CANVAS_FONT_FAMILY}`),
        document.fonts.load(`700 96px ${CANVAS_FONT_FAMILY}`),
    ]).then(() => {
        canvasFontReady = true;
    }).catch(() => {
        canvasFontReady = true;
    });
}

function invalidateCanvasTextCaches() {
    if (!game) return;
    if (game.scoreText) game.scoreText._dirty = true;
    if (game.Cells) {
        for (const cell of game.Cells) {
            if (cell.nameCache) cell.nameCache._dirty = true;
            if (cell.sizeCache) cell.sizeCache._dirty = true;
        }
    }
}

const CHAT_MAX_WIDTH = 320;
const CHAT_LINE_HEIGHT = 20;
const CHAT_FONT_SIZE = 18;
const CHAT_BASE_X = 15;

function getChatMeasureCtx(fontSize) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = canvasFont(fontSize);
    return ctx;
}

function measureChatTextWidth(text, fontSize) {
    if (!text) return 0;
    return getChatMeasureCtx(fontSize).measureText(text).width;
}

function wrapTextToLines(text, maxWidth, fontSize) {
    const ctx = getChatMeasureCtx(fontSize);
    const lines = [];
    if (!text) return lines;

    let start = 0;
    while (start < text.length) {
        let end = start;
        while (end < text.length && ctx.measureText(text.slice(start, end + 1)).width <= maxWidth) {
            end++;
        }
        if (end === start) end = start + 1;

        let slice = text.slice(start, end);
        const breakAt = slice.lastIndexOf(" ");
        if (breakAt > 0 && end < text.length) {
            end = start + breakAt;
            slice = text.slice(start, end);
        }

        const line = slice.trimEnd();
        if (line) lines.push(line);
        start = end;
        while (start < text.length && text[start] === " ") start++;
    }
    return lines.length ? lines : [""];
}

function wrapChatMessageLines(message, prefixWidth, maxWidth, fontSize) {
    const lines = [];
    let remaining = String(message || "");
    const firstMax = Math.max(40, maxWidth - prefixWidth);

    while (remaining.length) {
        const maxW = lines.length === 0 ? firstMax : maxWidth;
        const chunkLines = wrapTextToLines(remaining, maxW, fontSize);
        if (!chunkLines.length) break;
        lines.push(chunkLines[0]);
        remaining = remaining.slice(chunkLines[0].length);
        if (remaining.startsWith(" ")) remaining = remaining.slice(1);
    }
    return lines.length ? lines : [""];
}

function getGameServerApiBase(hostOrUrl) {
    if (!hostOrUrl) return "https://ffa.agar.su";
    if (/^https?:\/\//i.test(hostOrUrl)) return String(hostOrUrl).replace(/\/$/, "");
    return "https://" + String(hostOrUrl).replace(/^wss?:\/\//i, "");
}

const _sha256K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256HexConnectSync(text) {
    const enc = new TextEncoder().encode(String(text));
    const len = enc.length;
    const bitLen = len * 8;
    const padLen = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(enc);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 4, bitLen, false);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let off = 0; off < padLen; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
            const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + _sha256K[i] + w[i]) | 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const out = new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
    let hex = "";
    for (let i = 0; i < 8; i++) {
        const v = out[i];
        hex += ((v >>> 28) & 0xf).toString(16) + ((v >>> 24) & 0xf).toString(16) +
               ((v >>> 20) & 0xf).toString(16) + ((v >>> 16) & 0xf).toString(16) +
               ((v >>> 12) & 0xf).toString(16) + ((v >>> 8) & 0xf).toString(16) +
               ((v >>> 4) & 0xf).toString(16) + (v & 0xf).toString(16);
    }
    return hex;
}

function updateConnectTransferStream(inputPreview, hashHex) {
    const stream = document.getElementById("connect-verify-data-stream");
    if (!stream) return;
    const raw = String(inputPreview);
    const tail = raw.length > 18 ? "…" + raw.slice(-14) : raw;
    const h = String(hashHex || "");
    stream.textContent = 'sha256("' + tail + '") → ' + h.slice(0, 12) + "…";
}

function resetConnectVerifyStream() {
    const stream = document.getElementById("connect-verify-data-stream");
    if (stream) stream.textContent = 'sha256("…") → …';
}

function solveConnectChallenge(challenge) {
    const need = "0".repeat(challenge.difficulty);
    const prefix = challenge.prefix;
    let nonce = 0;
    setConnectingUI("ПК обменивается данными с сервером…", 35);

    return new Promise((resolve) => {
        function step() {
            const t0 = performance.now();
            while (performance.now() - t0 < 14) {
                const input = prefix + nonce;
                const hash = sha256HexConnectSync(input);
                if (hash.startsWith(need)) {
                    updateConnectTransferStream(input, hash);
                    resolve(`${challenge.challengeId}:${nonce}`);
                    return;
                }
                nonce++;
                if (nonce % 1500 === 0) {
                    setConnectingUI("Проверка безопасности…", 55);
                    updateConnectTransferStream(input, hash);
                }
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    });
}

async function fetchConnectToken(gameHost) {
    const apiBase = getGameServerApiBase(gameHost);

    if (serverPowSupportCache.get(apiBase) === false) {
        return null;
    }

    setConnectingUI(
        serverPowSupportCache.get(apiBase) === true ? "Запрос проверки…" : "Проверка сервера…",
        15
    );

    let res;
    try {
        res = await fetch(apiBase + "/challenge", { cache: "no-store" });
    } catch (err) {
        console.error("Connect token fetch error:", err);
        return null;
    }

    if (!res.ok) {
        if (res.status === 404) serverPowSupportCache.set(apiBase, false);
        return null;
    }

    let challenge;
    try {
        challenge = await res.json();
    } catch (err) {
        console.error("Connect challenge parse error:", err);
        return null;
    }

    if (!challenge || !challenge.challengeId || challenge.prefix == null || challenge.difficulty == null) {
        return null;
    }

    serverPowSupportCache.set(apiBase, true);
    setConnectingUI("Проверка безопасности…", 25);
    resetConnectVerifyStream();
    const token = await solveConnectChallenge(challenge);
    setConnectingUI("Подключение к серверу…", 75);
    return token;
}

function setConnectingUI(text, pct) {
    const box = document.querySelector("#connecting");
    const status = document.getElementById("connect-status");
    const bar = document.getElementById("connect-progress");
    if (box) box.style.display = "block";
    if (status && text) status.textContent = text;
    if (bar && pct != null) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

const HELLO_DIALOG_BASE_W = 985;
const HELLO_DIALOG_PAD = 40;

function updateHelloDialogScale() {
    const dialog = document.getElementById("helloDialog");
    if (!dialog) return;
    const baseH = dialog.scrollHeight || 280;
    const scaleW = (innerWidth - HELLO_DIALOG_PAD * 2) / HELLO_DIALOG_BASE_W;
    const scaleH = (innerHeight - HELLO_DIALOG_PAD * 2) / baseH;
    const scale = Math.min(1, scaleW, scaleH);
    dialog.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
}

function initHelloDialogScale() {
    updateHelloDialogScale();
    const dialog = document.getElementById("helloDialog");
    if (dialog && typeof ResizeObserver !== "undefined") {
        new ResizeObserver(updateHelloDialogScale).observe(dialog);
    }
}

const SERVERS = {
	ffa2: "ffa.agar.su:6003",
    ffa: "ffa.agar.su",
    ms: "ffa.agar.su:6002",
    pvp1: "ffa.agar.su:6004",
	tournament: "ffa.agar.su:6006",
};

function resolveServerUrl(arg) {
    if (!arg) return SERVERS.ffa;
    return SERVERS[arg] || arg;
}

function resolveServerKey(urlOrKey) {
    if (SERVERS[urlOrKey]) return urlOrKey;
    return Object.keys(SERVERS).find(k => SERVERS[k] === urlOrKey) || "ffa2";
}

function syncGamemodeUI(urlOrKey) {
    const key = resolveServerKey(urlOrKey);
    document.querySelectorAll(".gamemodes .item").forEach(el => {
        el.classList.toggle("active", el.dataset.server === key);
    });
}

class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    reset(x, y) {
        this.x = x;
        this.y = y;
    }
    copyFrom(v) {
        this.x = v.x;
        this.y = v.y;
    }
    minusEq(v) {
        this.x -= v.x;
        this.y -= v.y;
    }
}

class Game {
    constructor() {
        // Соединение
        this.CONNECTION_URL = "";
        this.currentWebSocketUrl = null;
        this.ws = null;
		this.connectShown = false;
        this.connectInProgress = false;
        this.wasEverConnected = false;
        this.wsClosingIntentional = false;
        this.tabHiddenCloseTimer = null;
        this.tabHiddenSince = null;
        this.tabHiddenCloseSec = 600;
        this.disconnectedVisible = false;
        this.showMenuBackground = true;
        this.useHttps = location.protocol === "https:";
        // Canvas и отрисовка
        this.canvas = null;
        this.ctx = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.dpr = window.devicePixelRatio || 1;
        this.viewZoom = 1;
        this.zoom = 1;
        this.nodeX = 0;
        this.nodeY = 0;
        this.posX = 0;
        this.posY = 0;
        this.posSize = 1;
        // Границы карты
        this.leftPos = 0;
        this.topPos = 0;
        this.rightPos = 0;
        this.bottomPos = 0;
        this.foodMinSize = 0;
        this.foodMaxSize = 0;
        this.ownerPlayerId = -1;
        // Игрок и клетки
        this.playerCells = [];
        this.nodes = {};
        this.nodelist = [];
        this.Cells = []; // уничтоженные клетки (анимация)
        this.nodesOnScreen = [];
        // Интерфейс и HUD
        this.leaderBoard = [];
        this.chatBoard = [];
        this.lbCanvas = null;
        this.chatCanvas = null;
        this.scoreText = null;
        this.userScore = 0;
        this.userNickName = null;
		this.skinMap = {};     // nick -> codeid
        this.skinCache = {};   // codeid -> Image
        this.skinLoading = {}; // чтобы не грузить 100 раз
        this.hideChat = false;
        this.showDarkTheme = false;
        this.showName = true;
        this.showSkin = true;
        this.showMass = true;
		this.interpSpeed = 120; // скорость интерполяции (по умолчанию середина)
        this.noRanking = false;
        // Мышь и ввод
        this.rawMouseX = 0;
        this.rawMouseY = 0;
        this.X = -1;
        this.Y = -1;
        this.oldX = -1;
        this.oldY = -1;
        this.touchable = "createTouch" in window || navigator.maxTouchPoints > 0;
        this.touches = [];
        this.leftTouchID = -1;
        this.leftTouchPos = new Vector2(0, 0);
        this.leftTouchStartPos = new Vector2(0, 0);
        this.leftVector = new Vector2(0, 0);
        this.joystickRadius = 240;
        this.joystickInnerR = 28;
        this.joystickOuterR = 85;
        this.cursorSize = 20;
        this.pinchZoomStartDistance = 0;
        this.isPinching = false;
        this.ejectInterval = null;
        this.ejectPressedByTouch = false;
        this.isTouchStart = "ontouchstart" in window && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.splitPressed = false;
        this.ejectPressed = false;
        this.splitIcon = new Image();
        this.ejectIcon = new Image();
        this.splitIcon.src = "https://agar.su/assets/photo/split.png";
        this.ejectIcon.src = "https://agar.su/assets/photo/eject.png";
        this.timestamp = 0;
        // Управление
        this.isTyping = false;
        this.spacePressed = false;
        this.wPressed = false;
        this.hasOverlay = true;
        //прочее
        this.z = 1;
        this.qTree = null;
        this.cellColors = [];
        this.teamColor = ["#333333", "#FF3333", "#33FF33", "#3333FF"];
        this.ma = false;
        this.mainCanvas = null;
        this.nCanvas = null;
        this.mapWidth = 0;
        this.mapHeight = 0;
        window.setNick = this.setNick.bind(this);
        window.setSpect = this.setSpect.bind(this);
        window.setServer = this.setServer.bind(this);
        window.setSkins = (arg) => { this.showSkin = !arg; }; // "No skins" checkbox: checked means hide skins
        window.setNames = (arg) => { this.showName = arg; }; // "No names"
        window.setDarkTheme = (arg) => { this.showDarkTheme = arg; };
        window.setShowMass = (arg) => { this.showMass = arg; };
        window.setChatHide = (arg) => { this.hideChat = arg; };
		window.setSpeedStage = (stage) => {
    stage = parseInt(stage);

    let speed = 120;
    let label = "Normal";

    if (stage === 1) {
        speed = 240;
        label = "Slow";
    }
    if (stage === 2) {
        speed = 120;
        label = "Normal";
    }
    if (stage === 3) {
        speed = 60;
        label = "Fast";
    }

    game.interpSpeed = speed;
    document.getElementById("speedLabel").innerText = stage + " (" + label + ")";
};

    }
	
	normalizeNick(nick) {
    if (!nick) return '';

    let n = nick.trim();

    // Проверяем, начинается ли ник с открывающейся скобки
    if (n.startsWith('[')) {
        const endIndex = n.indexOf(']');
        if (endIndex === -1) return ''; // закрывающей скобки нет

        const innerNick = n.substring(1, endIndex).trim();
        if (!innerNick || innerNick !== n.substring(1, endIndex)) return ''; // проверка пробелов внутри

        // Возвращаем ник вместе со скобками, игнорируя всё после закрывающейся скобки
        return `[${innerNick}]`.toLowerCase();
    } else {
        // Ник без скобок: нельзя содержать пробелы в начале/конце
        if (!n || n.trim() !== n) return '';
        return n.toLowerCase();
    }
}
	
	async loadSkinList() {
    try {
        const res = await fetch("https://api.agar.su/skinlist.txt");
        const text = await res.text();

text.split("\n").forEach(line => {
    line = line.trim();
    if (!line) return;

    const [nick, code] = line.split(":");
    if (!nick || !code) return;

    const normalized = this.normalizeNick(nick);
    if (!normalized) return;

    this.skinMap[normalized] = code.trim();
});


        console.log("Skin list loaded:", Object.keys(this.skinMap).length);
    } catch (e) {
        console.error("Skin list load error", e);
    }
}

getSkinForNick(nick) {
    if (!nick) return null;

    const normalized = this.normalizeNick(nick);
    if (!normalized) return null;

    const code = this.skinMap[normalized];
    if (!code) return null;

    if (this.skinCache[code]) return this.skinCache[code];
    if (this.skinLoading[code]) return null;

    const img = new Image();
    img.src = "https://api.agar.su/skins/" + code + ".png";

    this.skinLoading[code] = true;

    img.onload = () => {
        this.skinCache[code] = img;
        delete this.skinLoading[code];
    };

    img.onerror = () => {
        delete this.skinLoading[code];
    };

    return null;
}

    getXp(level) {
        return ~~(100 * (level ** 2 / 2));
    }
    getLevel(xp) {
        return ~~((xp / 100 * 2) ** 0.5);
    }
setNick(arg) {
    this.userNickName = arg;
    this.hideOverlays();
    if (!this.connectShown) {
        this.connectShown = true;
        this.showConnecting();
    } else {
        this.joinCurrentServer();
    }
    this.userScore = 0;
}
setSpect() {
    this.userNickName = null;
    this.hideOverlays();
    if (!this.connectShown) {
        this.connectShown = true;
        this.showConnecting();
    } else {
        this.joinCurrentServer();
    }
}
    updateServerHash(url) {
        const hash = resolveServerKey(url);
        history.replaceState(null, "", "#" + hash);
    }
    syncGamemodeSelect(url) {
        syncGamemodeUI(url);
    }
    initServersFromHash(reconnect) {
        const rawHash = location.hash.slice(1).split("?")[0];
        const hash = rawHash || "ffa2";
        let url = SERVERS[hash] || null;
        if (!url) url = SERVERS.ffa;
        syncGamemodeUI(hash);
        if (!rawHash || !SERVERS[rawHash]) {
            this.updateServerHash(url);
        }
        if (url === this.CONNECTION_URL) return;
        this.CONNECTION_URL = url;
        if (reconnect && this.ma && (this.connectShown || this.wsIsOpen())) {
            this.userNickName = null;
            this.connectShown = true;
            this.hideDisconnected();
            document.querySelector("#connecting").style.display = "block";
            setConnectingUI("Подключение к серверу…", 5);
            this.showConnecting();
        }
    }
    setServer(arg) {
        const url = resolveServerUrl(arg);
        if (url === this.CONNECTION_URL) return;
        this.CONNECTION_URL = url;
        this.updateServerHash(url);
        syncGamemodeUI(arg);
        if (this.ma && (this.connectShown || this.wsIsOpen())) {
            this.userNickName = null;
            this.connectShown = true;
            this.hideDisconnected();
            document.querySelector("#connecting").style.display = "block";
            setConnectingUI("Подключение к серверу…", 5);
            this.showConnecting();
        }
    }
    joinCurrentServer() {
        if (!this.wsIsOpen()) return;
        if (this.userNickName != null) {
            this.sendNickName();
        } else {
            this.sendUint8(1);
        }
    }

    gameLoop() {
        this.ma = true;
        document.getElementById("canvas").focus();
        this.isTyping = false;
        let chattxt;
        this.mainCanvas = this.nCanvas = document.getElementById("canvas");
        this.ctx = this.mainCanvas.getContext("2d");
		this.loadSkinList();
        this.mainCanvas.onmousemove = (event) => {
            this.rawMouseX = event.clientX * this.dpr;
            this.rawMouseY = event.clientY * this.dpr;
            this.mouseCoordinateChange();
        };
        const updateMouseAim = () => {
            let x = this.X < this.rightPos ? this.X : this.rightPos;
            let y = this.Y < this.bottomPos ? this.Y : this.bottomPos;
            x = -this.rightPos > x ? -this.rightPos : x;
            y = -this.bottomPos > y ? -this.bottomPos : y;
            this.posX = x;
            this.posY = y;
        };
        this.mainCanvas.addEventListener("mousedown", () => {
            if (!this.playerCells.length) {
                updateMouseAim();
                this.sendUint8(1);
            }
        });
        this.mainCanvas.onmouseup = function() {};
        if (this.touchable) {
            this.mainCanvas.addEventListener("touchstart", this.onTouchStart.bind(this), false);
            this.mainCanvas.addEventListener("touchmove", this.onTouchMove.bind(this), false);
            this.mainCanvas.addEventListener("touchend", this.onTouchEnd.bind(this), false);
        }
        if (/firefox/i.test(navigator.userAgent)) {
            document.addEventListener("DOMMouseScroll", this.handleWheel.bind(this), false);
        } else {
            document.body.onmousewheel = this.handleWheel.bind(this);
        }
        this.mainCanvas.onfocus = () => {
            this.isTyping = false;
        };
        document.getElementById("chat_textbox").onblur = () => {
            this.isTyping = false;
        };
        document.getElementById("chat_textbox").onfocus = () => {
            this.isTyping = true;
        };
        this.spacePressed = false;
        this.wPressed = false;
        onkeydown = (event) => {
            switch (event.keyCode) {
                case 13:
                    if (this.isTyping || this.hideChat) {
                        this.isTyping = false;
                        document.getElementById("chat_textbox").blur();
                        chattxt = document.getElementById("chat_textbox").value;
                        if (chattxt.length > 0) this.sendChat(chattxt);
                        document.getElementById("chat_textbox").value = "";
                    } else {
                        if (!this.hasOverlay) {
                            document.getElementById("chat_textbox").focus();
                            this.isTyping = true;
                        }
                    }
                    break;
                case 32:
                    if ((!this.spacePressed) && (!this.isTyping)) {
                        this.sendMouseMove();
                        this.sendUint8(17);
                        this.spacePressed = true;
                    }
                    break;
                case 87:
                    if ((!this.wPressed) && (!this.isTyping)) {
                        this.sendMouseMove();
                        this.sendUint8(21);
                        this.wPressed = true;
                    }
                    break;
                case 27:
                    if (this.connectShown) {
                        this.showOverlays();
                    }
                    break;
            }
        };
        onkeyup = (event) => {
            switch (event.keyCode) {
                case 32:
                    this.spacePressed = false;
                    break;
                case 87:
                    this.wPressed = false;
                    break;
            }
        };
        onblur = () => {
            this.wPressed = this.spacePressed = false;
        };
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.scheduleTabHiddenClose();
            } else {
                this.onTabVisibleAgain();
            }
        });
        window.addEventListener("pagehide", () => {
            this.scheduleTabHiddenClose();
        });
        onresize = this.canvasResize.bind(this);
        this.canvasResize();
        initHelloDialogScale();
        if (requestAnimationFrame) {
            requestAnimationFrame(this.redrawGameScene.bind(this));
        } else {
            setInterval(this.drawGameScene.bind(this), 1E3 / 60);
        }
        setInterval(this.sendMouseMove.bind(this), 40);
        document.querySelector("#overlays").classList.add("overlays-visible");
        this.updateBackgroundVisibility();
        this.initServersFromHash(false);
        window.addEventListener("hashchange", () => this.initServersFromHash(true));
        const reconnectBtn = document.getElementById("reconnect-btn");
        if (reconnectBtn) {
            reconnectBtn.addEventListener("click", () => this.manualReconnect());
        }
    }
    handleWheel(event) {
        this.zoom *= Math.pow(.9, event.wheelDelta / -120 || event.detail || 0);
        if (this.zoom < 0) this.zoom = 1;
        if (this.zoom > 4 / this.viewZoom) this.zoom = 4 / this.viewZoom;
        if (this.zoom < 0.3) this.zoom = 0.3;
    }
    onTouchStart(e) {
        const dpr = this.dpr;
        for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            var size = ~~(this.canvasWidth / 7);
            var tx = touch.clientX * dpr;
            var ty = touch.clientY * dpr;

            if (
                tx > this.canvasWidth - size &&
                ty > this.canvasHeight - size
            ) {
                this.sendMouseMove();
                this.sendUint8(17);
                continue;
            }

            if (
                tx > this.canvasWidth - size &&
                ty > this.canvasHeight - 2 * size - 10 &&
                ty < this.canvasHeight - size - 10
            ) {
                this.ejectPressedByTouch = true;
                if (!this.ejectInterval) {
                    this.sendMouseMove();
                    this.sendUint8(21);
                    this.ejectInterval = setInterval(() => {
                        if (this.ejectPressedByTouch && this.wsIsOpen()) {
                            this.sendMouseMove();
                            this.sendUint8(21);
                        }
                    }, 80);
                }
                continue;
            }

            if (this.leftTouchID < 0) {
                this.leftTouchID = touch.identifier;
                this.leftTouchStartPos.reset(tx, ty);
                this.leftTouchPos.copyFrom(this.leftTouchStartPos);
                this.leftVector.reset(0, 0);
            }
        }
        this.touches = e.touches;
    }
    onTouchMove(e) {
        e.preventDefault();
        const dpr = this.dpr;

        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            if (!this.isPinching) {
                this.pinchZoomStartDistance = currentDistance;
                this.isPinching = true;
            } else {
                const delta = currentDistance - this.pinchZoomStartDistance;
                const zoomFactor = 1 + delta / 300;
                this.zoom *= zoomFactor;
                if (this.zoom < 0.3) this.zoom = 0.3;
                if (this.zoom > 4 / this.viewZoom) this.zoom = 4 / this.viewZoom;
                this.pinchZoomStartDistance = currentDistance;
            }
            return;
        }

        for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (this.leftTouchID === touch.identifier) {
                this.leftTouchPos.reset(touch.clientX * dpr, touch.clientY * dpr);
                this.leftVector.copyFrom(this.leftTouchPos);
                this.leftVector.minusEq(this.leftTouchStartPos);
                const distance = Math.sqrt(this.leftVector.x ** 2 + this.leftVector.y ** 2);
                if (distance > this.joystickRadius) {
                    const scale = this.joystickRadius / distance;
                    this.leftVector.x *= scale;
                    this.leftVector.y *= scale;
                    this.leftTouchPos.x = this.leftTouchStartPos.x + this.leftVector.x;
                    this.leftTouchPos.y = this.leftTouchStartPos.y + this.leftVector.y;
                }
                this.rawMouseX = this.leftVector.x * 3 + this.canvasWidth / 2;
                this.rawMouseY = this.leftVector.y * 3 + this.canvasHeight / 2;
                this.mouseCoordinateChange();
                this.sendMouseMove();
            }
        }
        this.touches = e.touches;
    }
    onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.isPinching = false;
        }
        const dpr = this.dpr;

        for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];

            if (this.leftTouchID === touch.identifier) {
                this.leftTouchID = -1;
                this.leftVector.reset(0, 0);
            }

            var size = ~~(this.canvasWidth / 7);
            var tx = touch.clientX * dpr;
            var ty = touch.clientY * dpr;
            if (
                tx > this.canvasWidth - size &&
                ty > this.canvasHeight - 2 * size - 10 &&
                ty < this.canvasHeight - size - 10
            ) {
                this.ejectPressedByTouch = false;
                if (this.ejectInterval) {
                    clearInterval(this.ejectInterval);
                    this.ejectInterval = null;
                }
            }
        }

        if (e.touches.length === 0) {
            this.ejectPressedByTouch = false;
            if (this.ejectInterval) {
                clearInterval(this.ejectInterval);
                this.ejectInterval = null;
            }
        }

        this.touches = e.touches;
    }
    drawSplitIcon(ctx) {
        var size = ~~(this.canvasWidth / 7);
        if (this.isTouchStart) {
            if (this.splitPressed && this.splitIcon.width) {
                ctx.save();
                ctx.scale(1.1, 0);
            }
            if (this.splitIcon.width) {
                ctx.drawImage(this.splitIcon, this.canvasWidth - size, this.canvasHeight - size, size, size);
            }
            if (this.splitPressed) {
                ctx.restore();
                setTimeout(() => { this.splitPressed = false; }, 150);
            }

            if (this.ejectPressed && this.ejectIcon.width) {
                ctx.save();
                ctx.scale(1.1, 0);
            }
            if (this.ejectIcon.width) {
                ctx.drawImage(this.ejectIcon, this.canvasWidth - size, this.canvasHeight - 2 * size - 20, size, size);
            }
            if (this.ejectPressed) {
                ctx.restore();
                setTimeout(() => { this.ejectPressed = false; }, 150);
            }
        }
    }
    drawTouch(ctx) {
        ctx.save();
        if (this.touchable) {
            for (var i = 0; i < this.touches.length; i++) {
                var touch = this.touches[i];
                if (touch.identifier == this.leftTouchID) {
                    ctx.beginPath();
                    ctx.strokeStyle = "#0096ff";
                    ctx.lineWidth = 4;
                    ctx.arc(this.leftTouchStartPos.x, this.leftTouchStartPos.y, this.joystickInnerR, 0, Math.PI * 2, true);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = "#0096ff";
                    ctx.lineWidth = 2;
                    ctx.arc(this.leftTouchStartPos.x, this.leftTouchStartPos.y, this.joystickOuterR, 0, Math.PI * 2, true);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = "#0096ff";
                    ctx.arc(this.leftTouchPos.x, this.leftTouchPos.y, this.joystickInnerR, 0, Math.PI * 2, true);
                    ctx.stroke();

                    ctx.fillStyle = "#0096ff";
                    ctx.fillRect(
                        this.rawMouseX - this.cursorSize / 2,
                        this.rawMouseY - this.cursorSize / 2,
                        this.cursorSize,
                        this.cursorSize
                    );
                }
            }
        }
        ctx.restore();
    }
    mouseCoordinateChange() {
        this.X = (this.rawMouseX - this.canvasWidth / 2) / this.viewZoom + this.nodeX;
        this.Y = (this.rawMouseY - this.canvasHeight / 2) / this.viewZoom + this.nodeY;
    }
    shouldHideGameCanvas() {
        if (this.showMenuBackground && this.hasOverlay) return true;
        if (this.disconnectedVisible) return true;
        const connecting = document.getElementById("connecting");
        return connecting && connecting.style.display === "block";
    }
    updateBackgroundVisibility() {
        const bg = document.getElementById("background");
        if (!bg) return;
        bg.style.display = (this.showMenuBackground && this.hasOverlay) ? "block" : "none";
        this.updateLegalHeaderVisibility();
    }
    updateLegalHeaderVisibility() {
        const header = document.getElementById("mainui-header");
        if (!header) return;
        header.classList.toggle("hidden", !(this.showMenuBackground && this.hasOverlay));
    }
    hideOverlays() {
        this.hasOverlay = false;
        this.showMenuBackground = false;
        document.querySelector("#overlays").classList.remove("overlays-visible");
        this.updateBackgroundVisibility();
    }
    showOverlays(clearNick) {
        this.hasOverlay = true;
        if (clearNick) {
            this.userNickName = null;
        }
        document.querySelector("#overlays").classList.add("overlays-visible");
        this.updateBackgroundVisibility();
    }
    hideDisconnected() {
        this.disconnectedVisible = false;
        const box = document.querySelector("#disconnected");
        if (box) box.style.display = "none";
    }
    showDisconnected() {
        this.disconnectedVisible = true;
        const box = document.querySelector("#disconnected");
        const connecting = document.querySelector("#connecting");
        if (connecting) connecting.style.display = "none";
        if (box) box.style.display = "block";
        this.updateBackgroundVisibility();
    }
    clearGameState() {
        this.playerCells = [];
        this.nodes = {};
        this.nodelist = [];
        this.Cells = [];
        this.leaderBoard = [];
    }
    manualReconnect() {
        if (this.connectInProgress) return;
        this.hideDisconnected();
        document.querySelector("#connecting").style.display = "block";
        setConnectingUI("Подключение к серверу…", 5);
        this.showConnecting();
    }
    scheduleTabHiddenClose() {
        if (this.tabHiddenSince == null) {
            this.tabHiddenSince = Date.now();
        }
        if (this.tabHiddenCloseTimer != null) return;
        const remaining = Math.max(0, this.tabHiddenCloseSec * 1000 - (Date.now() - this.tabHiddenSince));
        this.tabHiddenCloseTimer = setTimeout(() => {
            this.tabHiddenCloseTimer = null;
            this.closeWsForHiddenTab();
        }, remaining);
    }
    onTabVisibleAgain() {
        if (this.tabHiddenSince != null) {
            const elapsed = Date.now() - this.tabHiddenSince;
            if (elapsed >= this.tabHiddenCloseSec * 1000) {
                if (this.wsIsOpen()) {
                    this.closeWsForHiddenTab();
                } else if (this.wasEverConnected && this.connectShown && !this.disconnectedVisible) {
                    this.clearGameState();
                    this.showDisconnected();
                }
            }
        }
        this.cancelTabHiddenClose();
    }
    closeWsForHiddenTab() {
        if (!this.wsIsOpen()) return;
        this.wsClosingIntentional = true;
        try {
            this.ws.close();
        } catch (e) {}
        this.ws = null;
    }
    cancelTabHiddenClose() {
        if (this.tabHiddenCloseTimer != null) {
            clearTimeout(this.tabHiddenCloseTimer);
            this.tabHiddenCloseTimer = null;
        }
        this.tabHiddenSince = null;
    }
    showConnecting() {
        const wsUrl = (this.useHttps ? "wss://" : "ws://") + this.CONNECTION_URL;
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentWebSocketUrl === wsUrl) {
            this.joinCurrentServer();
            return;
        }
        if (this.ma) {
            this.currentWebSocketUrl = wsUrl;
            this.wsConnect(wsUrl);
        }
    }
    
    async closeWsForReconnect() {
        if (!this.ws) return;
        this.wsClosingIntentional = true;
        const oldWs = this.ws;
        this.ws = null;
        oldWs.onopen = null;
        oldWs.onmessage = null;
        await new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve();
            };
            oldWs.onclose = finish;
            oldWs.onerror = finish;
            try {
                oldWs.close();
            } catch (e) {
                finish();
            }
            setTimeout(finish, 800);
        });
        this.wsClosingIntentional = false;
    }
    async wsConnect(wsUrlArg) {
        if (this._wsConnectChain) {
            await this._wsConnectChain;
        }
        let release;
        this._wsConnectChain = new Promise(resolve => { release = resolve; });
        try {
            await this._wsConnectImpl(wsUrlArg);
        } finally {
            release();
            this._wsConnectChain = null;
        }
    }
    async _wsConnectImpl(wsUrlArg) {
        if (this.connectInProgress) return;
        this.connectInProgress = true;
        setConnectingUI("Подключение к серверу…", 5);
        document.querySelector("#connecting").style.display = "block";

        await this.closeWsForReconnect();
        this.clearGameState();

        const host = this.CONNECTION_URL;
        const wsUrl = wsUrlArg || (this.useHttps ? "wss://" : "ws://") + host;

        let connectToken = null;
        try {
            connectToken = await fetchConnectToken(host);
        } catch (err) {
            console.error("Connect token error:", err);
            this.connectInProgress = false;
            setConnectingUI("Ошибка подключения", 5);
            return;
        }

        const qs = new URLSearchParams();
        const accountToken = localStorage.getItem("accountToken") || "";
        if (accountToken) qs.set("accountToken", accountToken);
        if (connectToken) qs.set("connectToken", connectToken);
        const query = qs.toString();

        console.info("Connecting to " + wsUrl + "..");
        const ws = new WebSocket(wsUrl + (query ? "?" + query : ""), "eSejeKSVdysQvZs0ES1H");
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.onWsOpen();
        };
        ws.onmessage = (msg) => {
            if (this.ws !== ws) return;
            this.onWsMessage(msg);
        };
        ws.onclose = () => {
            if (this.ws === ws) this.ws = null;
            this.onWsClose();
        };
        ws.onerror = () => {
            if (this.ws !== ws) return;
            setConnectingUI("Сервер отклонил подключение (лимит IP или проверка)", 5);
        };
        this.connectInProgress = false;
    }


    prepareData(a) {
        return new DataView(new ArrayBuffer(a));
    }
    wsSend(a) {
        this.ws.send(a.buffer);
    }
    onWsOpen() {
        let msg;
        this.wasEverConnected = true;
        if (document.hidden) {
            this.scheduleTabHiddenClose();
        } else {
            this.cancelTabHiddenClose();
        }
        this.hideDisconnected();
        const bar = document.getElementById("connect-progress");
        if (bar) bar.style.width = "100%";
        document.querySelector("#connecting").style.display = "none";
        msg = this.prepareData(5);
        msg.setUint8(0, 254);
        msg.setUint32(1, 5, true);
        this.wsSend(msg);
        msg = this.prepareData(5);
        msg.setUint8(0, 255);
        msg.setUint32(1, 0, true);
        this.wsSend(msg);
        this.joinCurrentServer();
        console.info("Connection successful!");
        setTimeout(() => { this.sendChat("вошёл в игру!"); }, 1000);
    }
    onWsClose() {
        console.log("WebSocket closed");
        const closedForHiddenTab = this.wsClosingIntentional;
        if (closedForHiddenTab) {
            if (this.tabHiddenCloseTimer != null) {
                clearTimeout(this.tabHiddenCloseTimer);
                this.tabHiddenCloseTimer = null;
            }
        } else {
            this.cancelTabHiddenClose();
        }
        this.ws = null;
        if (closedForHiddenTab) {
            this.wsClosingIntentional = false;
            return;
        }
        if (!this.wasEverConnected || !this.connectShown) return;
        this.clearGameState();
        this.showDisconnected();
    }
    onWsMessage(msg) {
        this.handleWsMessage(new DataView(msg.data));
    }
    handleWsMessage(msg) {
        let offset = 0;
        let setCustomLB = false;
        function getString() {
            let text = '';
            let char;
            while ((char = msg.getUint16(offset, true)) !== 0) {
                offset += 2;
                text += String.fromCharCode(char);
            }
            offset += 2;
            return text;
        }
        const messageType = msg.getUint8(offset++);
        switch (messageType) {
            case 2:
                break;
            case 16:
                const reader = new BinaryReader(msg);
                reader.offset++;
                this.updateNodes(reader);
                break;
            case 17:
                this.posSize = 0.15;
                break;
            case 20:
                this.playerCells = [];
                break;
            case 48:
                setCustomLB = true;
                this.noRanking = true;
                const count = msg.getUint32(offset, true);
                offset += 4;
                this.leaderBoard = [];
                for (let i = 0; i < count; i++) {
                    const nodeId = msg.getUint32(offset, true);
                    offset += 4;
                    const text = getString();
                    this.leaderBoard.push({
                        id: null,
                        name: text,
                        level: -1,
                        xp: 0
                    });
                }
                this.drawLeaderBoard();
                break;
            case 49:
                if (!setCustomLB) {
                    this.noRanking = false;
                }
                const LBplayerNum = msg.getUint32(offset, true);
                offset += 4;
                this.leaderBoard = [];
                for (let i = 0; i < LBplayerNum; ++i) {
                    const nodeId = msg.getUint32(offset, true);
                    offset += 4;
                    const playerName = getString();
                    const playerXp = msg.getUint32(offset, true);
                    offset += 4;
                    const level = playerXp ? this.getLevel(playerXp) : -1;
                    this.leaderBoard.push({
                        id: nodeId,
                        name: playerName,
                        level,
                        xp: playerXp
                    });
                }
                this.drawLeaderBoard();
                break;
            case 64:
                this.leftPos = msg.getFloat64(offset, true);
                offset += 8;
                this.topPos = msg.getFloat64(offset, true);
                offset += 8;
                this.rightPos = msg.getFloat64(offset, true);
                offset += 8;
                this.bottomPos = msg.getFloat64(offset, true);
                offset += 8;
                this.foodMinSize = (msg.getUint16(offset, true) * 100) ** .5;
                offset += 2;
                this.foodMaxSize = (msg.getUint16(offset, true) * 100) ** .5;
                offset += 2;
                this.ownerPlayerId = msg.getUint32(offset, true);
                offset += 4;
                this.mapWidth = (this.rightPos + this.leftPos) / 2;
                this.mapHeight = (this.bottomPos + this.topPos) / 2;
                this.posX = (this.rightPos + this.leftPos) / 2;
                this.posY = (this.bottomPos + this.topPos) / 2;
                this.posSize = 1;
                if (this.playerCells.length === 0) {
                    this.nodeX = this.posX;
                    this.nodeY = this.posY;
                    this.viewZoom = this.posSize;
                }
                break;
            case 99:
                this.addChat(msg, offset);
                break;
            case 114:
                const xp = msg.getUint32(offset, true);
                this.onUpdateXp(xp);
                break;
        }
    }
    addChat(view, offset) {
        function getString() {
            var text = '',
                char;
            while ((char = view.getUint16(offset, true)) != 0) {
                offset += 2;
                text += String.fromCharCode(char);
            }
            offset += 2;
            return text;
        }
        var flags = view.getUint8(offset++);
        if (flags & 0x80) {};
        var r = view.getUint8(offset++),
            g = view.getUint8(offset++),
            b = view.getUint8(offset++),
            color = (r << 16 | g << 8 | b).toString(16);
        while (color.length < 6) {
            color = '0' + color;
        }
        const playerXp = view.getUint32(offset, true);
        offset += 4;
        const pId = view.getUint16(offset, true);
        offset += 2;
        color = '#' + color;
        this.chatBoard.push({
            "pId": pId,
            "playerXp": playerXp,
            "playerLevel": playerXp ? this.getLevel(playerXp) : -1,
            "name": getString(),
            "color": color,
            "message": getString()
        });
        this.drawChatBoard();
    }
    sendMouseMove() {
        var msg;
        if (this.wsIsOpen()) {
            msg = this.rawMouseX - this.canvasWidth / 2;
            var b = this.rawMouseY - this.canvasHeight / 2;
            if (64 <= msg * msg + b * b && !(.01 > Math.abs(this.oldX - this.X) && .01 > Math.abs(this.oldY - this.Y))) {
                this.oldX = this.X;
                this.oldY = this.Y;
                msg = this.prepareData(21);
                msg.setUint8(0, 16);
                msg.setFloat64(1, this.X, true);
                msg.setFloat64(9, this.Y, true);
                msg.setUint32(17, 0, true);
                this.wsSend(msg);
            }
        }
    }
    getColorId(hex) {
        const index = this.cellColors.indexOf(hex);
        return index === -1 ? 0 : index + 1;
    }
    sendNickName() {
        if (this.wsIsOpen() && this.userNickName != null) {
            var msg = this.prepareData(1 + 2 * this.userNickName.length + 1);
            msg.setUint8(0, 0);
            msg.setUint8(1, this.getColorId(localStorage.getItem("selectedColor")));
            for (var i = 0; i < this.userNickName.length; ++i) msg.setUint16(1 + 2 * i + 1, this.userNickName.charCodeAt(i), true);
            this.wsSend(msg);
        }
    }
    sendChat(str) {
        if (this.wsIsOpen() && (str.length < 200) && (str.length > 0) && !this.hideChat) {
            var msg = this.prepareData(2 + 2 * str.length);
            var offset = 0;
            msg.setUint8(offset++, 99);
            msg.setUint8(offset++, 0);
            for (var i = 0; i < str.length; ++i) {
                msg.setUint16(offset, str.charCodeAt(i), true);
                offset += 2;
            }
            this.wsSend(msg);
        }
    }
    wsIsOpen() {
        return this.ws != null && this.ws.readyState === this.ws.OPEN;
    }
    sendUint8(a) {
        if (this.wsIsOpen()) {
            var msg = this.prepareData(1);
            msg.setUint8(0, a);
            this.wsSend(msg);
        }
    }
    redrawGameScene() {
        this.drawGameScene();
        requestAnimationFrame(this.redrawGameScene.bind(this));
    }
    canvasResize() {
        window.scrollTo(0, 0);
        this.dpr = window.devicePixelRatio || 1;
        this.canvasWidth = innerWidth * this.dpr;
        this.canvasHeight = innerHeight * this.dpr;
        this.nCanvas.width = this.canvasWidth;
        this.nCanvas.height = this.canvasHeight;
        this.nCanvas.style.width = innerWidth + "px";
        this.nCanvas.style.height = innerHeight + "px";
        updateHelloDialogScale();
        this.drawGameScene();
    }
    viewRange() {
        var ratio;
        ratio = Math.max(this.canvasHeight / 1080, this.canvasWidth / 1920);
        return ratio * this.zoom;
    }
    calcViewZoom() {
        if (0 != this.playerCells.length) {
            for (var newViewZoom = 0, i = 0; i < this.playerCells.length; i++) newViewZoom += this.playerCells[i].size;
            newViewZoom = Math.pow(Math.min(64 / newViewZoom, 1), .4) * this.viewRange();
            this.viewZoom = (9 * this.viewZoom + newViewZoom) / 10;
        }
    }
    buildQTree() {
        if (0.4 > this.viewZoom) this.qTree = null;
        else {
            var a = Number.POSITIVE_INFINITY,
                b = Number.POSITIVE_INFINITY,
                c = Number.NEGATIVE_INFINITY,
                d = Number.NEGATIVE_INFINITY,
                e = 0;
            for (var i = 0; i < this.nodelist.length; i++) {
                var node = this.nodelist[i];
                if (node.shouldRender() && !node.prepareData && 20 < node.size * this.viewZoom) {
                    e = Math.max(node.size, e);
                    a = Math.min(node.x, a);
                    b = Math.min(node.y, b);
                    c = Math.max(node.x, c);
                    d = Math.max(node.y, d);
                }
            }
            this.qTree = Quad.init({
                minX: a - (e + 100),
                minY: b - (e + 100),
                maxX: c + (e + 100),
                maxY: d + (e + 100),
                maxChildren: 2,
                maxDepth: 4
            });
            for (i = 0; i < this.nodelist.length; i++) {
                node = this.nodelist[i];
                if (node.shouldRender() && !(20 >= node.size * this.viewZoom)) {
                    for (a = 0; a < node.points.length; ++a) {
                        b = node.points[a].x;
                        c = node.points[a].y;
                        b < this.nodeX - this.canvasWidth / 2 / this.viewZoom || c < this.nodeY - this.canvasHeight / 2 / this.viewZoom || b > this.nodeX + this.canvasWidth / 2 / this.viewZoom || c > this.nodeY + this.canvasHeight / 2 / this.viewZoom || this.qTree.insert(node.points[a]);
                    }
                }
            }
        }
    }
    drawGameScene() {
        if (this.shouldHideGameCanvas()) {
            this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
            return;
        }
        var a, oldtime = Date.now();
        this.timestamp = oldtime;
        if (0 < this.playerCells.length) {
            this.calcViewZoom();
            var c = a = 0;
            for (var d = 0; d < this.playerCells.length; d++) {
                this.playerCells[d].updatePos();
                a += this.playerCells[d].x / this.playerCells.length;
                c += this.playerCells[d].y / this.playerCells.length;
            }
            this.posX = a;
            this.posY = c;
            this.posSize = this.viewZoom;
            this.nodeX = (this.nodeX + a) / 2;
            this.nodeY = (this.nodeY + c) / 2;
        } else {
            this.nodeX = (29 * this.nodeX + this.posX) / 30;
            this.nodeY = (29 * this.nodeY + this.posY) / 30;
            this.viewZoom = (9 * this.viewZoom + this.posSize * this.viewRange()) / 10;
        }
        this.buildQTree();
        this.mouseCoordinateChange();
        this.drawGrid();
        this.nodelist.sort((a, b) => a.size - b.size || a.id - b.id);
        this.ctx.save();
        this.ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2);
        this.ctx.scale(this.viewZoom, this.viewZoom);
        this.ctx.translate(-this.nodeX, -this.nodeY);
        for (let d = 0; d < this.Cells.length; d++) this.Cells[d].drawOneCell(this.ctx);
        for (let d = 0; d < this.nodelist.length; d++) this.nodelist[d].drawOneCell(this.ctx);
        this.ctx.restore();
        this.drawSplitIcon(this.ctx);
        this.drawTouch(this.ctx);
        this.lbCanvas && this.lbCanvas.width && this.ctx.drawImage(this.lbCanvas, this.canvasWidth - this.lbCanvas.width - 10, 10);
        if (this.chatCanvas != null) this.ctx.drawImage(this.chatCanvas, 0, this.canvasHeight - this.chatCanvas.height - 50);
        this.userScore = Math.max(this.userScore, this.calcUserScore());
        let displayText = '';
        if (this.userScore > 0) {
            displayText = 'Score: ' + ~~(this.userScore / 100);
        }
        if (displayText) {
            if (null == this.scoreText) {
                this.scoreText = new UText(24, '#FFFFFF');
            }
            this.scoreText.setValue(displayText);
            let rendered = this.scoreText.render();
            let textWidth = rendered.width;
            this.ctx.globalAlpha = 0.2;
            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(10, 10, textWidth + 20, 34);
            this.ctx.globalAlpha = 1;
            this.ctx.drawImage(rendered, 15, 15);
        }
        var deltatime = Date.now() - oldtime;
        deltatime > 1E3 / 60 ? this.z -= .01 : deltatime < 1E3 / 65 && (this.z += .01);
        .4 > this.z && (this.z = .4);
        1 < this.z && (this.z = 1);
    }
 drawGrid() {
    // 1. Заливаем фон полностью (это не зависит от zoom/translate)
    this.ctx.fillStyle = this.showDarkTheme ? "#111111" : "#F2FBFF";
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // 2. Сохраняем текущее состояние
    this.ctx.save();

    // 3. Применяем трансформации для всей сетки
    this.ctx.scale(this.viewZoom, this.viewZoom);
    // Если у тебя есть смещение камеры — добавь сюда:
    // this.ctx.translate(-this.nodeX + this.canvasWidth/2, -this.nodeY + this.canvasHeight/2);

    // 4. Настраиваем стиль линий
    this.ctx.strokeStyle = this.showDarkTheme ? "#AAAAAA" : "#000000";
    this.ctx.globalAlpha = 0.1;

    const viewWidth  = this.canvasWidth  / this.viewZoom;
    const viewHeight = this.canvasHeight / this.viewZoom;

    // ──────────────────────────────────────────────
    // Вертикальные линии
    this.ctx.beginPath();   // ← начинаем новый путь ТОЛЬКО ОДИН раз

    let startX = -0.5 + (-this.nodeX + viewWidth / 2) % 50;
    for (let x = startX; x < viewWidth; x += 50) {
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, viewHeight);
    }

    // ──────────────────────────────────────────────
    // Горизонтальные линии — продолжаем в том же пути
    let startY = -0.5 + (-this.nodeY + viewHeight / 2) % 50;
    for (let y = startY; y < viewHeight; y += 50) {
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(viewWidth, y);
    }

    // 5. Один вызов stroke на все линии сразу — это быстрее
    this.ctx.stroke();

    // 6. Возвращаем контекст в исходное состояние (очень важно!)
    this.ctx.restore();
}
    calcUserScore() {
        for (var score = 0, i = 0; i < this.playerCells.length; i++) score += this.playerCells[i].nSize * this.playerCells[i].nSize;
        return score;
    }
    drawChatBoard() {
        if (this.hideChat) {
            this.chatCanvas = null;
            return;
        }
        this.chatCanvas = document.createElement("canvas");
        var ctx = this.chatCanvas.getContext("2d");
        var scaleFactor = Math.min(Math.max(this.canvasWidth / 1200, 0.75), 1);
        this.chatCanvas.width = 1E3 * scaleFactor;
        this.chatCanvas.height = 550 * scaleFactor;
        ctx.scale(scaleFactor, scaleFactor);
        var nowtime = Date.now();
        var lasttime = 0;
        if (this.chatBoard.length >= 1)
            lasttime = this.chatBoard[this.chatBoard.length - 1].time;
        else return;
        var deltat = nowtime - lasttime;
        ctx.globalAlpha = 0.8 * Math.exp(-deltat / 25000);
        var len = this.chatBoard.length;
        var from = len - 15;
        if (from < 0) from = 0;

        const chatEntries = [];
        for (let i = from; i < len; i++) {
            const entry = this.chatBoard[i];
            const chatName = new UText(CHAT_FONT_SIZE, entry.color);
            chatName.setValue(entry.name);
            const nameWidth = chatName.getWidth();
            const prefixWidth = nameWidth + measureChatTextWidth(": ", CHAT_FONT_SIZE);
            const msgLines = wrapChatMessageLines(entry.message, prefixWidth, CHAT_MAX_WIDTH, CHAT_FONT_SIZE);
            chatEntries.push({ entry, chatName, nameWidth, msgLines });
        }

        let yCursor = this.chatCanvas.height / scaleFactor;
        for (let e = chatEntries.length - 1; e >= 0; e--) {
            const { chatName, nameWidth, msgLines } = chatEntries[e];
            const blockHeight = msgLines.length * CHAT_LINE_HEIGHT;
            yCursor -= blockHeight;

            for (let li = 0; li < msgLines.length; li++) {
                const lineY = yCursor + li * CHAT_LINE_HEIGHT;
                if (li === 0) {
                    const nameImg = chatName.render();
                    ctx.drawImage(nameImg, CHAT_BASE_X, lineY);
                    const chatText = new UText(CHAT_FONT_SIZE, "#666666");
                    chatText.setValue(": " + msgLines[0]);
                    const textImg = chatText.render();
                    ctx.drawImage(textImg, CHAT_BASE_X + nameWidth, lineY);
                } else {
                    const chatText = new UText(CHAT_FONT_SIZE, "#666666");
                    chatText.setValue(msgLines[li]);
                    const textImg = chatText.render();
                    ctx.drawImage(textImg, CHAT_BASE_X, lineY);
                }
            }
            yCursor -= 4;
        }
    }
    drawLeaderBoard() {
        this.lbCanvas = null;
        if (this.leaderBoard.length === 0) return;
        this.lbCanvas = document.createElement("canvas");
        var ctx = this.lbCanvas.getContext("2d");
        var boardLength = 60;
        var myRank = null;
        for (var i = 0; i < this.leaderBoard.length; i++) {
            if (this.playerCells.some(cell => cell.id === this.leaderBoard[i].id)) {
                myRank = i + 1;
                break;
            }
        }
        var visible = this.leaderBoard.slice(0, 10);
        if (myRank && myRank > 10) {
            var myEntry = this.leaderBoard[myRank - 1];
            visible.push({
                name: this.playerCells[0]?.name,
                id: this.playerCells[0]?.id ?? 0,
                level: myEntry?.level ?? -1,
                xp: myEntry?.xp ?? 0
            });
        }
        boardLength += 24 * visible.length;
        var scale = Math.min(0.22 * this.canvasHeight, Math.min(200, 0.3 * this.canvasWidth)) * 0.005;
        this.lbCanvas.width = 200 * scale;
        this.lbCanvas.height = boardLength * scale;
        ctx.scale(scale, scale);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 200, boardLength);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#FFFFFF";
        ctx.font = canvasFont(30);
        ctx.textAlign = "center";
        ctx.fillText("Leaderboard", 100, 40);
        ctx.textAlign = "left";
        ctx.font = canvasFont(20);
        for (var i = 0; i < visible.length; i++) {
            var entry = visible[i];
            var name = entry.name || "An unnamed cell";
            if (!this.showName) name = "An unnamed cell";
            var isMe = this.playerCells.some(cell => cell.id === entry.id);
            if (isMe && this.playerCells[0]?.name) {
                name = this.playerCells[0].name;
            }
            ctx.fillStyle = isMe ? "#FFAAAA" : "#FFFFFF";
            var text = (!this.noRanking ? (i + 1) + ". " : "") + name;
            if (isMe && myRank > 10 && i === visible.length - 1) {
                text = myRank + ". " + name;
            }
            var w = ctx.measureText(text).width;
            var x = (w > 190) ? 5 : 100 - w / 2;
            ctx.fillText(text, x, 70 + 24 * i);
        }
    }
    normalizeFractlPart(n) {
        return (n % (Math.PI * 2)) / (Math.PI * 2);
    }
   updateNodes(reader) {
    this.timestamp = Date.now();
    this.ua = false;
    
    for (let killedId; (killedId = reader.uint32());) {
        const killer = this.nodes[reader.uint32()];
        const killedNode = this.nodes[killedId];
        if (killer && killedNode) {
            killedNode.destroy();
            killedNode.ox = killedNode.x;
            killedNode.oy = killedNode.y;
            killedNode.oSize = killedNode.size;
            killedNode.nx = killer.x;
            killedNode.ny = killer.y;
            killedNode.nSize = killedNode.size;
            killedNode.updateTime = this.timestamp;
        }
    }
    
    for (let nodeid; (nodeid = reader.uint32());) {
        const type = reader.uint8();
        let posX = 0, posY = 0, size = 0, playerId = 0;
        
        if (type === 1) {
            posX = this.leftPos + (this.rightPos * 2) * this.normalizeFractlPart(nodeid);
            posY = this.topPos + (this.bottomPos * 2) * this.normalizeFractlPart(nodeid * nodeid);
        } else {
            if (type === 0) playerId = reader.uint32();
            posX = reader.int32();
            posY = reader.int32();
            size = reader.uint16();
        }
        
        const r = reader.uint8();
        const g = reader.uint8();
        const b = reader.uint8();
        let color = ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
        color = `#${color}`;
        
        const spiked = reader.uint8();
        const flagVirus = !!(spiked & 0x01);
        const flagAgitated = !!(spiked & 0x10);
        const flagEjected = !!(spiked & 0x20) || !!(spiked & 0x40);
        
        const name = reader.utf8();
        
        // ========== ЧТЕНИЕ СТИКЕРА (ДОБАВИТЬ ЭТОТ БЛОК) ==========
        let stickerData = null;
        if (reader.canRead) {
            const marker = reader.uint8();
            if (marker === 0xFF) {
                stickerData = reader.uint8();
            }
        }
        // ========================================================
        
        let node = this.nodes[nodeid];
        if (node) {
            node.updatePos();
            node.ox = node.x;
            node.oy = node.y;
            node.oSize = node.size;
            node.color = color;
        } else {
            node = new Cell(nodeid, posX, posY, size, color, name);
            this.nodes[nodeid] = node;
            this.nodelist.push(node);
            node.ka = posX;
            node.la = posY;
            if (playerId === this.ownerPlayerId) {
                this.hideOverlays();
                this.playerCells.push(node);
                if (this.playerCells.length === 1) {
                    this.nodeX = node.x;
                    this.nodeY = node.y;
                }
            }
        }
        
        // ========== УСТАНОВКА СТИКЕРА ==========
        if (stickerData !== null) {
            node.currentSticker = stickerData;
            node.stickerActive = true;
        } else if (node) {
            node.stickerActive = false;
            node.currentSticker = null;
        }
        // =======================================
        
        node.isVirus = flagVirus;
        node.isEjected = flagEjected;
        node.isAgitated = flagAgitated;
        node.nx = posX;
        node.ny = posY;
        node.setSize(size);
        node.updateTime = this.timestamp;
        node.flag = spiked;
        if (name) node.setName(name);
        
        // Админ-панель (если нужно)
        if (name && playerId === this.ownerPlayerId) {
            const lowerName = name.toLowerCase().trim();
            const isAdmin = this.admins?.some(admin => lowerName.includes(admin.toLowerCase()));
            const isModer = this.moders?.some(moder => lowerName.includes(moder.toLowerCase()));
            const panel = document.querySelector('.adminpanel');
            if (panel) {
                panel.style.display = 'none';
                if (isAdmin) {
                    panel.style.display = 'flex';
                    panel.style.background = 'rgb(146, 15, 15)';
                    panel.textContent = 'ADMINKA';
                } else if (isModer) {
                    panel.style.display = 'flex';
                    panel.style.background = 'rgb(2, 89, 255)';
                    panel.textContent = 'MODERKA';
                }
            }
        }
    }
    
    while (reader.canRead) {
        const node = this.nodes[reader.uint32()];
        if (node) node.destroy();
    }
    
    this.nodelist.sort((a, b) => {
        return a.size === b.size ? a.id - b.id : a.size - b.size;
    });
    
    if (this.ua && this.playerCells.length === 0) {
        this.showOverlays(false);
    }
}
    onUpdateXp(xp) {
        // Placeholder for handling XP update
        console.log("XP updated to:", xp);
    }
}
class BinaryReader {
    constructor(view) {
        this.view = view;
        this.byteLength = view.byteLength;
        this.offset = 0;
    }
    get canRead() {
        return this.offset < this.byteLength;
    }
    uint8() {
        return this.view.getUint8(this.offset++);
    }
    int8() {
        return this.view.getInt8(this.offset++);
    }
    uint16() {
        return this.view.getUint16((this.offset += 2) - 2, true);
    }
    int16() {
        return this.view.getInt16((this.offset += 2) - 2, true);
    }
    uint32() {
        return this.view.getUint32((this.offset += 4) - 4, true);
    }
    int32() {
        return this.view.getInt32((this.offset += 4) - 4, true);
    }
    utf16() {
        let str = "";
        let char;
        while (this.canRead && (char = this.uint16())) str += String.fromCharCode(char);
        return str;
    }
    utf8() {
        let text = "";
        for (let byte1; byte1 = this.canRead && this.view.getUint8(this.offset++);) {
            if (byte1 <= 0x7F)
                text += String.fromCharCode(byte1);
            else if (byte1 <= 0xDF)
                text += String.fromCharCode(((byte1 & 0x1F) << 6) | (this.view.getUint8(this.offset++) & 0x3F));
            else if (byte1 <= 0xEF)
                text += String.fromCharCode(((byte1 & 0x0F) << 12) | ((this.view.getUint8(this.offset++) & 0x3F) << 6) | (this.view.getUint8(this.offset++) & 0x3F));
            else {
                let codePoint = ((byte1 & 0x07) << 18) | ((this.view.getUint8(this.offset++) & 0x3F) << 12) | ((this.view.getUint8(this.offset++) & 0x3F) << 6) | (this.view.getUint8(this.offset++) & 0x3F);
                if (codePoint >= 0x10000) {
                    codePoint -= 0x10000;
                    text += String.fromCharCode(0xD800 | (codePoint >> 10), 0xDC00 | (codePoint & 0x3FF));
                } else text += String.fromCharCode(codePoint);
            }
        }
        return text;
    }
}

class UText {
    constructor(size, color, stroke, strokeColor) {
        this._value = "";
        this._color = color || "#000000";
        this._stroke = !!stroke;
        this._strokeColor = strokeColor || "#000000";
        this._size = size || 16;
        this._canvas = null;
        this._ctx = null;
        this._dirty = false;
        this._scale = 1;
    }
    setSize(v) {
        if (this._size !== v) {
            this._size = v;
            this._dirty = true;
        }
    }
    setScale(v) {
        if (this._scale !== v) {
            this._scale = v;
            this._dirty = true;
        }
    }
    setStrokeColor(v) {
        if (this._strokeColor !== v) {
            this._strokeColor = v;
            this._dirty = true;
        }
    }
    setValue(v) {
        if (v !== this._value) {
            this._value = v;
            this._dirty = true;
        }
    }
    render() {
        if (this._canvas == null) {
            this._canvas = document.createElement("canvas");
            this._ctx = this._canvas.getContext("2d");
        }
        if (this._dirty) {
            this._dirty = false;
            const ctx = this._ctx;
            const value = this._value;
            const scale = this._scale;
            const fontsize = this._size;
            const font = canvasFont(fontsize);
            // важно: сначала font
            ctx.font = font;
            const h = ~~(0.2 * fontsize);
            const h2 = h * 0.5;
            const wd = fontsize * 0.1;
            // resize canvas СБРАСЫВАЕТ transform
            this._canvas.width = ctx.measureText(value).width * scale + 3;
            this._canvas.height = (fontsize + h) * scale;
            // сброс transform вручную (на всякий случай)
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.font = font;
            ctx.globalAlpha = 1;
            ctx.lineWidth = wd;
            ctx.strokeStyle = this._strokeColor;
            ctx.fillStyle = this._color;
            // масштабируем ПОСЛЕ настройки
            ctx.scale(scale, scale);
            if (this._stroke) {
                ctx.strokeText(value, 0, fontsize - h2);
            }
            ctx.fillText(value, 0, fontsize - h2);
        }
        return this._canvas;
    }
    getWidth() {
        if (!this._canvas || !this._ctx) {
            this._canvas = document.createElement("canvas");
            this._ctx = this._canvas.getContext("2d");
            this._ctx.font = canvasFont(this._size);
        }
        return this._ctx.measureText(this._value).width + 6;
    }
}

const smoothRender = 0.4;
const closebord = false;

const Quad = {
    init: function (args) {
        function Node(x, y, w, h, depth) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.depth = depth;
            this.items = [];
            this.nodes = [];
        }

        var c = args.maxChildren || 2,
            d = args.maxDepth || 4;
        Node.prototype = {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            depth: 0,
            items: null,
            nodes: null,
            exists: function (selector) {
                for (var i = 0; i < this.items.length; ++i) {
                    var item = this.items[i];
                    if (item.x >= selector.x && item.y >= selector.y && item.x < selector.x + selector.w && item.y < selector.y + selector.h) return true;
                }
                if (0 != this.nodes.length) {
                    var self = this;
                    return this.findOverlappingNodes(selector, function (dir) {
                        return self.nodes[dir].exists(selector);
                    });
                }
                return false;
            },
            retrieve: function (item, callback) {
                for (var i = 0; i < this.items.length; ++i) callback(this.items[i]);
                if (0 != this.nodes.length) {
                    var self = this;
                    this.findOverlappingNodes(item, function (dir) {
                        self.nodes[dir].retrieve(item, callback);
                    });
                }
            },
            insert: function (a) {
                if (0 != this.nodes.length) {
                    this.nodes[this.findInsertNode(a)].insert(a);
                } else {
                    if (this.items.length >= c && this.depth < d) {
                        this.devide();
                        this.nodes[this.findInsertNode(a)].insert(a);
                    } else {
                        this.items.push(a);
                    }
                }
            },
            findInsertNode: function (a) {
                return a.x < this.x + this.w / 2 ? a.y < this.y + this.h / 2 ? 0 : 2 : a.y < this.y + this.h / 2 ? 1 : 3;
            },
            findOverlappingNodes: function (a, b) {
                return a.x < this.x + this.w / 2 && (a.y < this.y + this.h / 2 && b(0) || a.y >= this.y + this.h / 2 && b(2)) || a.x >= this.x + this.w / 2 && (a.y < this.y + this.h / 2 && b(1) || a.y >= this.y + this.h / 2 && b(3)) ? true : false;
            },
            devide: function () {
                var a = this.depth + 1,
                    c = this.w / 2,
                    d = this.h / 2;
                this.nodes.push(new Node(this.x, this.y, c, d, a));
                this.nodes.push(new Node(this.x + c, this.y, c, d, a));
                this.nodes.push(new Node(this.x, this.y + d, c, d, a));
                this.nodes.push(new Node(this.x + c, this.y + d, c, d, a));
                a = this.items;
                this.items = [];
                for (c = 0; c < a.length; c++) this.insert(a[c]);
            },
            clear: function () {
                for (var a = 0; a < this.nodes.length; a++) this.nodes[a].clear();
                this.items.length = 0;
                this.nodes.length = 0;
            }
        };
        var internalSelector = {
            x: 0,
            y: 0,
            w: 0,
            h: 0
        };
        return {
            root: new Node(args.minX, args.minY, args.maxX - args.minX, args.maxY - args.minY, 0),
            insert: function (a) {
                this.root.insert(a);
            },
            retrieve: function (a, b) {
                this.root.retrieve(a, b);
            },
            retrieve2: function (a, b, c, d, callback) {
                internalSelector.x = a;
                internalSelector.y = b;
                internalSelector.w = c;
                internalSelector.h = d;
                this.root.retrieve(internalSelector, callback);
            },
            exists: function (a) {
                return this.root.exists(a);
            },
            clear: function () {
                this.root.clear();
            }
        };
    }
};

class Cell {
    constructor(uid, ux, uy, usize, ucolor, uname) {
        this.id = uid;
        this.x = this.ox = ux;
        this.y = this.oy = uy;
        this.size = this.oSize = usize;
        this.nx = 0;
        this.ny = 0;
        this.nSize = 0;
        this.color = ucolor;
        this.name = null;
        this.nameCache = null;
        this.sizeCache = null;
        this.updateTime = 0;
        this.drawTime = 0;
        this.destroyed = false;
        this.isVirus = false;
        this.isEjected = false;
        this.isAgitated = false;
        this.flag = 0;
        this.points = [];
        this.pointsAcc = [];
        this.wasSimpleDrawing = true;
        this.setName(uname);
    }
    destroy() {
        const i = game.nodelist.indexOf(this);
        if (i !== -1) game.nodelist.splice(i, 1);
        delete game.nodes[this.id];
        const p = game.playerCells.indexOf(this);
        if (p !== -1) {
            game.ua = true;
            game.playerCells.splice(p, 1);
        }
        const s = game.nodesOnScreen.indexOf(this.id);
        if (s !== -1) game.nodesOnScreen.splice(s, 1);
        this.destroyed = true;
        //game.Cells.push(this);
    }
    getNameSize() {
        return Math.max(~~(0.3 * this.size), 24);
    }
    setName(name) {
        this.name = name;
        if (!this.nameCache) {
            this.nameCache = new UText(this.getNameSize(), "#FFFFFF", true, "#000000");
        }
        this.nameCache.setSize(this.getNameSize());
        this.nameCache.setValue(this.name);
    }
    setSize(size) {
        this.nSize = size;
        if (!this.sizeCache) {
            this.sizeCache = new UText(this.getNameSize() * 0.5, "#FFFFFF", true, "#000000");
        }
        this.sizeCache.setSize(this.getNameSize() * 0.5);
    }
    getNumPoints() {
        if (this.id === 0) return 16;
        let minPoints = this.size < 20 ? 0 : 10;
        if (this.isVirus) minPoints = 30;
        let b = this.isVirus ? this.size : this.size * game.viewZoom;
        b *= game.z;
        if (this.flag & 32) b *= 0.25;
        return ~~Math.max(b, minPoints);
    }
    createPoints() {
        const numPoints = this.getNumPoints();
        while (this.points.length > numPoints) {
            const idx = ~~(Math.random() * this.points.length);
            this.points.splice(idx, 1);
            this.pointsAcc.splice(idx, 1);
        }
        if (!this.points.length && numPoints > 0) {
            this.points.push({ ref: this, size: this.size, x: this.x, y: this.y });
            this.pointsAcc.push(Math.random() - 0.5);
        }
        while (this.points.length < numPoints) {
            const idx = ~~(Math.random() * this.points.length);
            const point = this.points[idx];
            this.points.splice(idx, 0, { ref: this, size: point.size, x: point.x, y: point.y });
            this.pointsAcc.splice(idx, 0, this.pointsAcc[idx]);
        }
    }
    movePoints() {
        this.createPoints();
        const pts = this.points;
        const acc = this.pointsAcc;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const prev = acc[(i - 1 + n) % n];
            const next = acc[(i + 1) % n];
            acc[i] += (Math.random() - 0.5) * (this.isAgitated ? 3 : 1);
            acc[i] = Math.max(Math.min(acc[i] * 0.7, 10), -10);
            acc[i] = (prev + next + 8 * acc[i]) / 10;
        }
        const ref = this;
        const isVirus = this.isVirus ? 0 : (this.id / 1e3 + game.timestamp / 1e4) % (2 * Math.PI);
        for (let j = 0; j < n; j++) {
            let f = pts[j].size;
            const prev = pts[(j - 1 + n) % n].size;
            const next = pts[(j + 1) % n].size;
            if (this.size > 15 && game.qTree && this.size * game.viewZoom > 20 && this.id !== 0) {
                const x = pts[j].x, y = pts[j].y;
                let collide = false;
                game.qTree.retrieve2(x - 5, y - 5, 10, 10, a => {
                    if (a.ref !== ref && (x - a.x) ** 2 + (y - a.y) ** 2 < 625) collide = true;
                });
                if (!collide && (x < game.leftPos || y < game.topPos || x > game.rightPos || y > game.bottomPos)) collide = true;
                if (collide) acc[j] = Math.max(0, acc[j]) - 1;
            }
            f = Math.max(0, f + acc[j]);
            f = this.isAgitated ? (19 * f + this.size) / 20 : (12 * f + this.size) / 13;
            pts[j].size = (prev + next + 8 * f) / 10;
            const angle = (2 * Math.PI / n) * j;
            let radius = pts[j].size;
            if (this.isVirus && j % 2 === 0) radius += 5;
            pts[j].x = this.x + Math.cos(angle + isVirus) * radius;
            pts[j].y = this.y + Math.sin(angle + isVirus) * radius;
        }
    }
    updatePos() {
        if (this.id === 0) return 1;
        const progress = Math.min(1, Math.max(0, (game.timestamp - this.updateTime) / game.interpSpeed));
        if (this.destroyed && progress >= 1) {
            const i = game.Cells.indexOf(this);
            if (i !== -1) game.Cells.splice(i, 1);
        }
        this.x = this.ox + (this.nx - this.ox) * progress;
        this.y = this.oy + (this.ny - this.oy) * progress;
        this.size = this.oSize + (this.nSize - this.oSize) * progress;
        return progress;
    }
    shouldRender() {
        if (this.id === 0) return true;
        const margin = this.size + 40;
        const left = game.nodeX - game.canvasWidth / 2 / game.viewZoom;
        const right = game.nodeX + game.canvasWidth / 2 / game.viewZoom;
        const top = game.nodeY - game.canvasHeight / 2 / game.viewZoom;
        const bottom = game.nodeY + game.canvasHeight / 2 / game.viewZoom;
        return !(
            this.x + margin < left ||
            this.y + margin < top ||
            this.x - margin > right ||
            this.y - margin > bottom
        );
    }
    getStrokeColor() {
        const r = (parseInt(this.color.substr(1, 2), 16) * 0.9) | 0;
        const g = (parseInt(this.color.substr(3, 2), 16) * 0.9) | 0;
        const b = (parseInt(this.color.substr(5, 2), 16) * 0.9) | 0;
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    drawOneCell(ctx) {
        if (!this.shouldRender()) return;

        const simpleRender = this.id !== 0 && !this.isAgitated && smoothRender > game.viewZoom || this.getNumPoints() < 10;

        if (!simpleRender && this.wasSimpleDrawing) this.points.forEach(p => p.size = this.size);

        let bigPointSize = this.size;
        if (!this.wasSimpleDrawing) this.points.forEach(p => bigPointSize = Math.max(bigPointSize, p.size));
        this.wasSimpleDrawing = simpleRender;

        ctx.save();
        this.drawTime = game.timestamp;
        this.updatePos();
        let renderSize = this.size;
        if (renderSize === 0) renderSize = 20;

        ctx.lineWidth = closebord ? 0 : 10;
        ctx.lineCap = "round";
        ctx.lineJoin = this.isVirus ? "miter" : "round";
        ctx.fillStyle = this.color;
        ctx.strokeStyle = simpleRender ? this.color : this.getStrokeColor();

        ctx.beginPath();
        if (simpleRender) {
            ctx.arc(this.x, this.y, renderSize, 0, 2 * Math.PI);
        } else {
            this.movePoints();
            ctx.moveTo(this.points[0].x, this.points[0].y);
            this.points.forEach(p => ctx.lineTo(p.x, p.y));
        }
        ctx.closePath();
        if (!closebord) ctx.stroke();
        ctx.fill();

        const skinSz = simpleRender ? renderSize : bigPointSize;
        let skinImg = null;
        if (game.showSkin && this.name) {
            skinImg = game.getSkinForNick(this.name);
        }
        if (skinImg) {
            ctx.save();
            ctx.clip();
            ctx.drawImage(
                skinImg,
                this.x - skinSz,
                this.y - skinSz,
                skinSz * 2,
                skinSz * 2
            );
            ctx.restore();
        }

        const isPlayer = game.playerCells.includes(this);
        if (this.id !== 0) {
            const x = ~~this.x;
            const y = ~~this.y;
            const nameSize = this.getNameSize();
            const scale = Math.ceil(10 * game.viewZoom) * 0.1;
            const invScale = 1 / scale;
            if ((game.showName || isPlayer) && this.name && this.nameCache) {
                const cache = this.nameCache;
                cache.setValue(this.name);
                cache.setSize(nameSize);
                cache.setScale(scale);
                const canvas = cache.render();
                const w = ~~(canvas.width * invScale);
                const h = ~~(canvas.height * invScale);
                ctx.drawImage(canvas, x - ~~(w / 2), y - ~~(h / 2), w, h);
            }
            if ((game.showMass || isPlayer) && !this.isVirus && !this.isEjected && !this.isAgitated && this.size > 100) {
                const mass = ~~(this.size * this.size * 0.01);
                const cache = this.sizeCache;
                cache.setValue(mass);
                cache.setScale(scale);
                const canvas = cache.render();
                const w = ~~(canvas.width * invScale);
                const h = ~~(canvas.height * invScale);
                const gy = this.name ? y + ~~(h * 0.7) : y - ~~(h * 0.5);
                ctx.drawImage(canvas, x - ~~(w / 2), gy, w, h);
            }
        }
        ctx.restore();
    }
}

const game = new Game();
onload = () => {
    ensureCanvasFont().finally(() => {
        invalidateCanvasTextCaches();
        game.gameLoop();
    });
};
