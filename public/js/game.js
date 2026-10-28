// ==========================================
// GESTURE CLASH — client
// First-person 3D arena (three.js). Aim with your hand,
// pinch to shoot, second hand (or WASD) to move.
// ==========================================
(() => {
  const $ = id => document.getElementById(id);
  const socket = io();

  const SLOT_COLORS = [0x22d3ee, 0xfb923c];
  const EYE = 1.6, SPEED = 6.5, RADIUS = 0.55;

  let arena = null;
  let mySlot = null, myName = "";
  let status = "lobby";
  let winner = null;

  // Local player simulation
  const me = { x: 0, z: 0, yaw: 0, pitch: 0, alive: true };
  const opp = { x: 0, z: 0, yaw: 0, pitch: 0, alive: true, name: "" };
  let playersState = [null, null], endsAt=null;

  // Input intents (gesture + keyboard combined)
  const gestureAim = { x: 0, y: 0 };
  const gestureMove = { x: 0, z: 0 };
  const keys = {};
  let needsRejoin=false, lastGesture=0;
  const clearInputs=()=>{for(const k in keys)delete keys[k];gestureAim.x=gestureAim.y=gestureMove.x=gestureMove.z=0;shootQueued=false;};

  // ---------- three.js scene ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1e);
  scene.fog = new THREE.Fog(0x0a0f1e, 30, 90);
  const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 200);
  camera.rotation.order = "YXZ";
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  $("game-container").appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(18, 30, 10);
  scene.add(sun);

  let boxMeshes = [];
  function buildArena(a) {
    arena = a;
    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(a.size, a.size),
      new THREE.MeshStandardMaterial({ color: 0x16213a, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(a.size, a.size / 2, 0x2dd4ee, 0x24406e);
    grid.position.y = 0.02;
    scene.add(grid);
    // Cover boxes
    const geoCache = {};
    for (const b of a.boxes) {
      const key = `${b.w}x${b.d}x${b.h}`;
      if (!geoCache[key]) geoCache[key] = new THREE.BoxGeometry(b.w, b.h, b.d);
      const m = new THREE.Mesh(geoCache[key], new THREE.MeshStandardMaterial({
        color: 0x2b4a77, roughness: 0.6, metalness: 0.25,
        emissive: 0x0a1a30
      }));
      m.position.set(b.x, b.h / 2, b.z);
      scene.add(m); boxMeshes.push(m);
      // glowing top edge strip
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.06, 0.07, b.d + 0.06),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff })
      );
      edge.position.set(b.x, b.h + 0.03, b.z);
      scene.add(edge);
    }
    // Perimeter walls
    const half = a.size / 2;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1d3355, roughness: 0.8 });
    const mkWall = (w, d, x, z) => {
      const wgeo = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallMat);
      wgeo.position.set(x, 2, z); scene.add(wgeo);
    };
    mkWall(a.size + 2, 1, 0, -half - 0.5); mkWall(a.size + 2, 1, 0, half + 0.5);
    mkWall(1, a.size + 2, -half - 0.5, 0); mkWall(1, a.size + 2, half + 0.5, 0);
  }

  // Opponent avatar
  function makeAvatar(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.05, 14), mat);
    body.position.y = 0.85; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 14), mat);
    head.position.y = 1.62; g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    visor.position.set(0, 1.66, -0.28); g.add(visor);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x222831 }));
    gun.position.set(0.3, 1.25, -0.45); g.add(gun);
    return g;
  }
  let oppMesh = null, oppNameSprite = null;
  function makeNameSprite(text, colorCss) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 64;
    const ctx = c.getContext("2d");
    ctx.font = "bold 34px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = colorCss;
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 6;
    ctx.strokeText(text, 128, 42); ctx.fillText(text, 128, 42);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.scale.set(2.4, 0.6, 1);
    sp.position.y = 2.25;
    return sp;
  }

  // Own gun (attached to camera)
  const gunGroup = new THREE.Group();
  {
    const gmat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.4, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.52), gmat);
    gunGroup.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), gmat);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.04, -0.38); gunGroup.add(barrel);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0 }));
    tip.position.set(0, 0.04, -0.55); tip.name = "flash"; gunGroup.add(tip);
    gunGroup.position.set(0.28, -0.26, -0.55);
    camera.add(gunGroup);
    scene.add(camera);
  }
  const flash = gunGroup.getObjectByName("flash");

  // Tracers
  const tracers = [];
  function spawnTracer(from, dir, colorHex) {
    const len = 60;
    const end = from.clone().add(dir.clone().multiplyScalar(len));
    // shorten at first box hit (visual only)
    const ray = new THREE.Raycaster(from, dir, 0, len);
    const hits = ray.intersectObjects(boxMeshes);
    if (hits.length) end.copy(hits[0].point);
    const geo = new THREE.BufferGeometry().setFromPoints([from, end]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.95
    }));
    scene.add(line);
    tracers.push({ line, born: performance.now() });
  }

  // ---------- tiny synth sounds ----------
  let AC = null;
  function beep(f0, f1, dur, type = "square", vol = 0.12) {
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, AC.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), AC.currentTime + dur);
      g.gain.setValueAtTime(vol, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
      o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
    } catch (_) {}
  }
  const sfx = {
    shoot: () => beep(660, 90, 0.1, "square", 0.1),
    hit: () => { beep(180, 40, 0.3, "sawtooth", 0.16); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, f, 0.16, "triangle", 0.14), i * 120)); },
    lose: () => { [400, 300, 200, 120].forEach((f, i) => setTimeout(() => beep(f, f, 0.18, "triangle", 0.12), i * 130)); },
    count: () => beep(440, 440, 0.09, "sine", 0.1)
  };

  // ---------- collision (circle vs boxes / bounds) ----------
  function collide(x, z) {
    if (!arena) return { x, z };
    const half = arena.size / 2 - 1;
    x = Math.max(-half, Math.min(half, x));
    z = Math.max(-half, Math.min(half, z));
    for (const b of arena.boxes) {
      const minX = b.x - b.w / 2 - RADIUS, maxX = b.x + b.w / 2 + RADIUS;
      const minZ = b.z - b.d / 2 - RADIUS, maxZ = b.z + b.d / 2 + RADIUS;
      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        const pushL = x - minX, pushR = maxX - x, pushB = z - minZ, pushF = maxZ - z;
        const m = Math.min(pushL, pushR, pushB, pushF);
        if (m === pushL) x = minX; else if (m === pushR) x = maxX;
        else if (m === pushB) z = minZ; else z = maxZ;
      }
    }
    return { x, z };
  }

  // ---------- socket flow ----------
  socket.on("arena", a => {if(!arena)buildArena(a);});
  socket.on('disconnect',()=>{
    needsRejoin=true;mySlot=null;status='lobby';clearInputs();
    $('lobby').classList.remove('hidden');$('ready-box').classList.add('hidden');$('join-box').classList.remove('hidden');
    $('notice').textContent='Connection lost. Reconnecting...';hideBig();
  });
  socket.on('connect',()=>{if(needsRejoin){needsRejoin=false;$('notice').textContent='Reconnected. Join again, then both press READY.';}});
  socket.on('correction',p=>{if(Math.hypot(p.x-me.x,p.z-me.z)>1){me.x=p.x;me.z=p.z;}});
  socket.on("joined", ({ slot, name }) => {
    mySlot = slot; myName = name;
    $("join-box").classList.add("hidden");
    $("ready-box").classList.remove("hidden");
    $("slot-info").textContent = `You are Player ${slot + 1} ${slot === 0 ? "🔵" : "🟠"} — ${name}`;
    startGesture();
  });
  socket.on("joinDenied", ({ text }) => { $("notice").textContent = text; });
  socket.on("notice", ({ text }) => {
    $("notice").textContent = text;
    if (status === "playing") showBig(text, "", 1200);
  });

  socket.on("state", st => {
    const prev = status;
    status = st.status; winner = st.winner; endsAt=st.endsAt;
    playersState = st.players;

    // Top bar
    $("p0-name").textContent = st.players[0] ? st.players[0].name : "— waiting —";
    $("p1-name").textContent = st.players[1] ? st.players[1].name : "— waiting —";
    $("status-text").textContent =
      status === "lobby" ? "LOBBY" :
      status === "countdown" ? "GET READY" :
      status === "playing" ? "⚔️ FIGHT" : "🏆 ROUND OVER";

    if (mySlot !== null && st.players[mySlot]) {
      const mine = st.players[mySlot];
      if (status === "countdown" && prev !== "countdown") {
        // snap to spawn at countdown start
        me.x = mine.x; me.z = mine.z; me.yaw = mine.yaw; me.pitch = 0;
      }
      me.alive = mine.alive;
    }
    const o = st.players[mySlot === 0 ? 1 : 0];
    if (o) {
      opp.name = o.name; opp.alive = o.alive;
      opp.tx = o.x; opp.tz = o.z; opp.tyaw = o.yaw; opp.tpitch = o.pitch;
      if (opp.x === 0 && opp.z === 0) { opp.x = o.x; opp.z = o.z; }
    }

    // Lobby visibility
    const inGame = status === "countdown" || status === "playing" || status === "ended";
    $("lobby").classList.toggle("hidden", inGame && mySlot !== null);
    $("topbar").classList.toggle("hidden", mySlot === null);
    $("crosshair").classList.toggle("hidden", status !== "playing");
    $("cam-wrap").classList.toggle("hidden", mySlot === null);
    $("help").classList.toggle("hidden", mySlot === null);
    if (mySlot !== null && status === "lobby") {
      const both = st.players[0] && st.players[1];
      const readyTxt = [0, 1].map(i => st.players[i]
        ? `${st.players[i].name}: ${st.players[i].ready ? "READY ✅" : "not ready"}`
        : `Player ${i + 1}: empty`).join(" · ");
      $("lobby-msg").textContent = both ? readyTxt : "Waiting for both players to join… " + readyTxt;
    }
  });

  let bigTimer = null;
  function showBig(text, sub, ms) {
    $("big-text").textContent = text;
    $("big-sub").textContent = sub || "";
    $("big-overlay").classList.remove("hidden");
    clearTimeout(bigTimer);
    if (ms) bigTimer = setTimeout(() => $("big-overlay").classList.add("hidden"), ms);
  }
  function hideBig() { $("big-overlay").classList.add("hidden"); }

  socket.on("countdownStart", ({ ms }) => {
    let n = Math.ceil(ms / 1000);
    showBig(n, "First hit wins the round!", 0);
    sfx.count();
    const iv = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(iv); hideBig(); }
      else { $("big-text").textContent = n; sfx.count(); }
    }, 1000);
  });
  socket.on("roundStart", () => showBig("FIGHT! 🥊", "", 750));
  socket.on("roundEnd", ({ winnerSlot, winnerName }) => {
    const draw=winnerSlot===null;
    const iWon = winnerSlot === mySlot;
    showBig(draw ? "DRAW" : iWon ? "🏆 YOU WIN!" : `🏆 ${winnerName} WINS`, draw ? "90 seconds. Next round in 6 seconds." : iWon ? "Clean elimination!" : "You got eliminated!", 5600);
    if (iWon) sfx.win(); else sfx.lose();
    if (document.pointerLockElement) document.exitPointerLock();
  });
  socket.on("lobbyReset", () => {
    hideBig();clearInputs();
    $("notice").textContent = "Next pair — join & press READY!";
    snapToSpawn();
  });

  function snapToSpawn() {
    const mine = playersState[mySlot ?? 0];
    if (mine) { me.x = mine.x; me.z = mine.z; me.yaw = mine.yaw; me.pitch = 0; }
  }

  socket.on("shotFired", ({ slot, hit }) => {
    const isMe = slot === mySlot;
    const dir = new THREE.Vector3();
    if (isMe) {
      camera.getWorldDirection(dir);
      const from = camera.position.clone().add(new THREE.Vector3(0, -0.1, 0));
      spawnTracer(from, dir, 0x00f0ff);
      flash.material.opacity = 1;
      setTimeout(() => flash.material.opacity = 0, 55);
      sfx.shoot();
    } else if (oppMesh) {
      const from = new THREE.Vector3(opp.x, 1.45, opp.z);
      dir.set(-Math.sin(opp.tyaw || 0), 0, -Math.cos(opp.tyaw || 0)).normalize();
      spawnTracer(from, dir, 0xfb923c);
      sfx.shoot();
    }
    if (hit) sfx.hit();
  });

  // ---------- input ----------
  $("join-btn").addEventListener("click", () => {
    const name = $("name-input").value.trim();
    socket.emit("join", { name });
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  });
  $("name-input").addEventListener("keydown", e => { if (e.key === "Enter") $("join-btn").click(); });
  $("ready-btn").addEventListener("click", () => socket.emit("ready"));
  $("reset-btn").addEventListener("click", () => socket.emit("resetMatch"));

  addEventListener("keydown", e => {
    if(e.target instanceof HTMLInputElement)return;
    keys[e.key.toLowerCase()] = true;
    if(e.key.toLowerCase()==='c'){window.GestureControl.calibrate();clearInputs();}
    if (e.key === " " && status === "playing") { e.preventDefault(); tryShoot(); }
  });
  addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

  renderer.domElement.addEventListener("click", () => {
    if (status === "playing" && mySlot !== null && !document.pointerLockElement) {
      renderer.domElement.requestPointerLock();
    } else if (status === "playing" && document.pointerLockElement) {
      tryShoot();
    }
  });
  document.addEventListener("mousemove", e => {
    if (!document.pointerLockElement || status !== "playing") return;
    me.yaw -= e.movementX * 0.0021;
    me.pitch -= e.movementY * 0.0021;
    me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch));
  });

  let shootQueued = false;
  addEventListener('blur', clearInputs);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInputs();});
  function tryShoot() { shootQueued = true; }

  function startGesture() {
    window.GestureControl.start($("webcam"), {
      onAim: (x, y) => { lastGesture=performance.now();gestureAim.x = x; gestureAim.y = y; },
      onMove: (x, z) => { gestureMove.x = x; gestureMove.z = z; },
      onShoot: () => { if (status === "playing") tryShoot(); },
      onStatus: t => { $("gesture-status").textContent = t; }
    });
  }

  // ---------- main loop ----------
  let last = performance.now(), sendAcc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;

    if(performance.now()-lastGesture>450){gestureAim.x=gestureAim.y=gestureMove.x=gestureMove.z=0;}
    if(document.hidden||!document.hasFocus())clearInputs();
    if (mySlot !== null && status === "playing" && me.alive && document.hasFocus() && !document.hidden) {
      // Gesture aim (velocity style)
      if (gestureAim.x || gestureAim.y) {
        me.yaw -= gestureAim.x * 2.3 * dt;
        me.pitch += gestureAim.y * 1.7 * dt;
        me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch));
      }
      // Movement: keyboard + gesture
      let f = 0, s = 0;
      if (keys["w"] || keys["arrowup"]) f += 1;
      if (keys["s"] || keys["arrowdown"]) f -= 1;
      if (keys["d"] || keys["arrowright"]) s += 1;
      if (keys["a"] || keys["arrowleft"]) s -= 1;
      f += gestureMove.z; s += gestureMove.x;
      const len = Math.hypot(f, s);
      if (len > 0.01) {
        f /= Math.max(1, len); s /= Math.max(1, len);
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
        const rx = -fz, rz = fx;
        const nx = me.x + (fx * f + rx * s) * SPEED * dt;
        const nz = me.z + (fz * f + rz * s) * SPEED * dt;
        const c = collide(nx, nz);
        me.x = c.x; me.z = c.z;
      }
      if (shootQueued) { shootQueued = false; socket.emit("shoot",{ x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch }); }
      sendAcc += dt;
      if (sendAcc > 0.066) {
        sendAcc = 0;
        socket.emit("update", { x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch });
      }
    }

    if(status==='playing'&&endsAt)$('status-text').textContent='FIGHT '+Math.max(0,Math.ceil((endsAt-Date.now())/1000))+'s';
    // Camera
    camera.position.set(me.x, EYE, me.z);
    camera.rotation.y = me.yaw;
    camera.rotation.x = me.pitch;

    // Opponent avatar
    if (mySlot !== null) {
      const oslot = mySlot === 0 ? 1 : 0;
      if (!oppMesh && playersState[oslot]) {
        oppMesh = makeAvatar(SLOT_COLORS[oslot]);
        scene.add(oppMesh);
      }
      if (oppMesh) {
        if (opp.tx !== undefined) {
          const k = 1 - Math.exp(-14 * dt);
          opp.x += (opp.tx - opp.x) * k;
          opp.z += (opp.tz - opp.z) * k;
        }
        oppMesh.position.set(opp.x, 0, opp.z);
        oppMesh.rotation.y = (opp.tyaw || 0) + Math.PI; // model faces -z; align to their forward
        oppMesh.rotation.z = opp.alive ? 0 : Math.PI / 2;
        if (opp.name && (!oppNameSprite || oppNameSprite.name !== opp.name)) {
          if (oppNameSprite) oppMesh.remove(oppNameSprite);
          oppNameSprite = makeNameSprite(opp.name, oslot === 0 ? "#22d3ee" : "#fb923c");
          oppNameSprite.name = opp.name;
          oppMesh.add(oppNameSprite);
        }
        oppMesh.visible = !!playersState[oslot];
      }
    }

    // Tracer fade
    for (let i = tracers.length - 1; i >= 0; i--) {
      const age = now - tracers[i].born;
      if (age > 110) {
        scene.remove(tracers[i].line);
        tracers[i].line.geometry.dispose();
        tracers.splice(i, 1);
      }
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
})();
