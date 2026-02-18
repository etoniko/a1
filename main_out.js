class Game {
    constructor() {
        // Соединение
        this.CONNECTION_URL = "";
        this.currentWebSocketUrl = null;
        this.ws = null;
        this.Delay = 500;
        this.useHttps = location.protocol === "https:";
        // Canvas и отрисовка
        this.canvas = null;
        this.ctx = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
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
        // Производительность и время
        this.timestamp = 0;
        this.cb = 0; // счётчик кадров
        this.fpsLastTime = 0;
        this.fpsCount = 0;
        this.currentFPS = 0;
		this.ping = 0;    
        this.pingstamp = 0;
        // Управление
        this.isTyping = false;
        this.spacePressed = false;
        this.wPressed = false;
        this.hasOverlay = true;
        // Капча
        this.captchaId = null;
        //прочее
        this.z = 1;
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
        this.hideOverlays();
        this.userNickName = arg + "#";
        this.sendNickName();
        this.userScore = 0;
    }
    setSpect() {
        this.userNickName = null;
        this.sendUint8(1);
        this.hideOverlays();
    }
    setServer(arg) {
        if (arg !== this.CONNECTION_URL) {
            this.CONNECTION_URL = arg;
            this.showCaptcha();
        }
    }
    onCaptchaSuccess(token) {
        this.showConnecting(token);
    }
    renderCaptcha() {
        if (this.captchaId !== null) { // Сбрасываем капчу если она уже создана
            document.getElementById('captcha-overlay').style.display = '';
            turnstile.reset(this.captchaId);
            return;
        }
        const overlay = document.createElement("div");
        overlay.id = "captcha-overlay";
        const container = document.createElement("div");
        container.id = "captcha-container";
        overlay.appendChild(container);
        document.body.prepend(overlay);
        this.captchaId = turnstile.render(container, {
            sitekey: "0x4AAAAAAA0keHJ56_KNR0MU",
            callback: this.onCaptchaSuccess.bind(this)
        });
    }
    showCaptcha() {
        if (window.turnstile) return this.renderCaptcha();
        const node = document.createElement('script');
        node.setAttribute('src', 'https://challenges.cloudflare.com/turnstile/v0/api.js');
        node.setAttribute('async', 'async');
        node.setAttribute('defer', 'defer');
        node.onload = () => {
            this.renderCaptcha();
        };
        node.onerror = () => {
            alert("Не удалось загрузить библиотеку Captcha. Попробуйте обновить браузер");
        };
        document.head.appendChild(node);
    }
    disableCaptcha() {
        const captchaOverlay = document.getElementById('captcha-overlay');
        if (captchaOverlay) captchaOverlay.remove();
        const scripts = document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]');
        scripts.forEach(s => s.remove());
        if (window.turnstile) delete window.turnstile;
        this.captchaId = null;
        console.log("Captcha полностью отключена до перезагрузки страницы или соединение нового сервера");
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
            this.rawMouseX = event.clientX;
            this.rawMouseY = event.clientY;
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
                    this.showOverlays(true);
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
            this.sendUint8(19);
            this.wPressed = this.spacePressed = false;
        };
        onresize = this.canvasResize.bind(this);
        this.canvasResize();
        if (requestAnimationFrame) {
            requestAnimationFrame(this.redrawGameScene.bind(this));
        } else {
            setInterval(this.drawGameScene.bind(this), 1E3 / 60);
        }
        setInterval(this.sendMouseMove.bind(this), 40);
        setTimeout(this.showCaptcha.bind(this), 100);
        document.querySelector("#overlays").style = "display:block;";
		const select = document.getElementById("gamemode");
if (select && select.value) {
    this.CONNECTION_URL = select.value;
}
    }
    handleWheel(event) {
        this.zoom *= Math.pow(.9, event.wheelDelta / -120 || event.detail || 0);
        if (this.zoom < 0) this.zoom = 1;
        if (this.zoom > 4 / this.viewZoom) this.zoom = 4 / this.viewZoom;
        if (this.zoom < 0.3) this.zoom = 0.3;
    }
    mouseCoordinateChange() {
        this.X = (this.rawMouseX - this.canvasWidth / 2) / this.viewZoom + this.nodeX;
        this.Y = (this.rawMouseY - this.canvasHeight / 2) / this.viewZoom + this.nodeY;
    }
    hideOverlays() {
        this.hasOverlay = false;
        document.querySelector("#overlays").style = "display:none;";
    }
    showOverlays(arg) {
        this.hasOverlay = true;
        this.userNickName = null;
        document.querySelector("#overlays").style = "display:block;";
    }
    showConnecting(token) {
        const wsUrl = (this.useHttps ? "wss://" : "ws://") + this.CONNECTION_URL;
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentWebSocketUrl === wsUrl) {
            console.log("Соединение уже активно для этого URL, пропускаем повторное подключение.");
            return;
        }
        if (this.ma) {
            this.currentWebSocketUrl = wsUrl;
            this.wsConnect(wsUrl, token);
            this.disableCaptcha();
        }
    }
wsConnect(undefined, token) {
    if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        try {
            this.ws.close();
        } catch (b) {}
        this.ws = null;
    }

    const wsUrl = (this.useHttps ? "wss://" : "ws://") + this.CONNECTION_URL;

    this.playerCells = [];
    this.nodes = {};
    this.nodelist = [];
    this.Cells = [];
    this.leaderBoard = [];

    console.info("Connecting to " + wsUrl + "..");

    // ✅ ПРАВИЛЬНО получаем токены
    const captchaToken  = token || "";
    const accountToken  = localStorage.getItem("accountToken") || "";

    // 🔎 лог для дебага (очень советую оставить)
    console.log("captchaToken:", captchaToken);
    console.log("accountToken:", accountToken);
    console.log("origin:", location.origin);

    // ✅ формируем query БЕЗ undefined
    const params = `?token=${encodeURIComponent(captchaToken)}&accountToken=${encodeURIComponent(accountToken)}`;

    this.ws = new WebSocket(wsUrl + params, "eSejeKSVdysQvZs0ES1H");
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = this.onWsOpen.bind(this);
    this.ws.onmessage = this.onWsMessage.bind(this);
    this.ws.onclose = this.onWsClose.bind(this);
}


    prepareData(a) {
        return new DataView(new ArrayBuffer(a));
    }
    wsSend(a) {
        this.ws.send(a.buffer);
    }
    onWsOpen() {
        let msg;
        this.delay = 500;
        document.querySelector("#connecting").style = "display:none;";
        msg = this.prepareData(5);
        msg.setUint8(0, 254);
        msg.setUint32(1, 5, true);
        this.wsSend(msg);
        msg = this.prepareData(5);
        msg.setUint8(0, 255);
        msg.setUint32(1, 0, true);
        this.wsSend(msg);
        this.sendNickName();
        console.info("Connection successful!");
		     setInterval(() => {    
if (!document.hidden) {        
    this.pingstamp = Date.now();           
	this.wsSend(new Uint8Array([2])); // ping        
}      
    }, 3000);
	setTimeout(() => { this.sendChat("вошёл в игру!"); }, 1000); 
    }
    onWsClose() {
console.log("WebSocket closed");
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
        this.ping = Date.now() - this.pingstamp;
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
        this.canvasWidth = innerWidth;
        this.canvasHeight = innerHeight;
        this.nCanvas.width = this.canvasWidth;
        this.nCanvas.height = this.canvasHeight;
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
    drawGameScene() {
        var a, oldtime = Date.now();
        ++this.cb;
        this.timestamp = oldtime;
        if (!window.fpsLastTime) {
            window.fpsLastTime = oldtime;
            window.fpsCount = 0;
            window.currentFPS = 0;
        }
        window.fpsCount++;
        if (oldtime - window.fpsLastTime >= 900) { // обновляем ~каждые 0.9 сек
            window.currentFPS = Math.round(window.fpsCount * 1000 / (oldtime - window.fpsLastTime));
            window.fpsCount = 0;
            window.fpsLastTime = oldtime;
        }
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
        this.mouseCoordinateChange();
        this.drawGrid();
        this.ctx.save();
        this.ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2);
        this.ctx.scale(this.viewZoom, this.viewZoom);
        this.ctx.translate(-this.nodeX, -this.nodeY);
        for (let d = 0; d < this.Cells.length; d++) this.Cells[d].drawOneCell(this.ctx);
        for (let d = 0; d < this.nodelist.length; d++) this.nodelist[d].drawOneCell(this.ctx);
        this.ctx.restore();
        this.lbCanvas && this.lbCanvas.width && this.ctx.drawImage(this.lbCanvas, this.canvasWidth - this.lbCanvas.width - 10, 10);
        if (this.chatCanvas != null) this.ctx.drawImage(this.chatCanvas, 0, this.canvasHeight - this.chatCanvas.height - 50);
        this.userScore = Math.max(this.userScore, this.calcUserScore());
        let displayText = '';
        if (this.userScore > 0) {
            displayText += 'Score: ' + ~~(this.userScore / 100);
        }
        if (window.currentFPS > 0) {
            if (displayText) displayText += ' | ';
            displayText += 'FPS: ' + window.currentFPS;
        }
		
if (this.ping > 0) {
    if (displayText) displayText += '  |  ';
    displayText += 'Ping: ' + this.ping;
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
        for (var i = 0; i < (len - from); i++) {
            var chatName = new UText(18, this.chatBoard[i + from].color);
            chatName.setValue(this.chatBoard[i + from].name);
            var width = chatName.getWidth();
            var a = chatName.render();
            ctx.drawImage(a, 15, this.chatCanvas.height / scaleFactor - 24 * (len - i - from));
            var chatText = new UText(18, '#666666');
            chatText.setValue(': ' + this.chatBoard[i + from].message);
            a = chatText.render();
            ctx.drawImage(a, 15 + width, this.chatCanvas.height / scaleFactor - 24 * (len - from - i));
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
        ctx.font = "30px Ubuntu";
        ctx.textAlign = "center";
        ctx.fillText("Leaderboard", 100, 40);
        ctx.textAlign = "left";
        ctx.font = "20px Ubuntu";
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
                //size = this.foodMinSize + nodeid % ((this.foodMaxSize - this.foodMinSize) + 1);
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
            const flagEjected = !!(spiked & 0x20);
            const name = reader.utf8();
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
                    document.getElementById("overlays").style.display = "none";
                    this.playerCells.push(node);
                    if (this.playerCells.length === 1) {
                        this.nodeX = node.x;
                        this.nodeY = node.y;
                    }
                }
            }
            node.isVirus = flagVirus;
            node.isEjected = flagEjected;
            node.isAgitated = flagAgitated;
            node.nx = posX;
            node.ny = posY;
            node.setSize(size);
            node.updateTime = this.timestamp;
            node.flag = spiked;
            if (name) node.setName(name);
        }
        while (reader.canRead) {
            const node = this.nodes[reader.uint32()];
            if (node) node.destroy();
        }
        // Оптимизация: сортируем здесь, после обновлений, а не каждый кадр
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
            const font = fontsize + "px Ubuntu";
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
            this._ctx.font = this._size + "px Ubuntu";
        }
        return this._ctx.measureText(this._value).width + 6;
    }
}

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
        ctx.save();
        this.drawTime = game.timestamp;
this.updatePos();
		let renderSize = this.size;
if (renderSize === 0) renderSize = 20;
        ctx.beginPath();
ctx.arc(this.x, this.y, renderSize, 0, 2 * Math.PI);
ctx.closePath();

// ВСЕГДА сначала красим клетку цветом
ctx.fillStyle = this.color;
ctx.fill();

// ===== SKIN =====
let skinImg = null;
if (game.showSkin && this.name) {
    skinImg = game.getSkinForNick(this.name);
}

if (skinImg) {
    ctx.save();
    ctx.clip(); // клип по кругу

    // СКИН БЕЗ ПРОЗРАЧНОСТИ
    ctx.drawImage(
        skinImg,
        this.x - renderSize,
        this.y - renderSize,
        renderSize * 2,
        renderSize * 2
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
            // ===== NAME =====
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
            // ===== MASS =====
            if ((game.showMass || isPlayer) && (!this.isVirus || this.isAgitated) && this.size > 100) {
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
onload = game.gameLoop.bind(game);
