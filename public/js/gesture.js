// ==========================================
// GESTURE CONTROL — webcam hand tracking (MediaPipe Hands)
//   Aim hand  : move hand around the frame centre -> turn / look
//   Shoot     : pinch thumb + index finger together (👌)
//   Move hand : second hand position -> forward / back / strafe
// Everything runs locally in the browser. If the camera or the
// model fails, the game still works with keyboard + mouse.
// ==========================================
window.GestureControl = (function () {
  const DEAD = 0.09;          // aim dead-zone around frame centre
  const PINCH_ON = 0.055;     // pinch distance to fire
  const PINCH_OFF = 0.085;    // pinch distance to re-arm
  let pinchArmed = true;
  let running = false;

  function palmCenter(lm) {
    const idx = [0, 5, 9, 13, 17];
    let x = 0, y = 0;
    for (const i of idx) { x += lm[i].x; y += lm[i].y; }
    return { x: x / idx.length, y: y / idx.length };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function start(videoEl, handlers) {
    if (running) return;
    if (typeof Hands === "undefined" || typeof Camera === "undefined") {
      handlers.onStatus("Gesture: model files missing — keyboard/mouse mode");
      return;
    }
    let hands;
    try {
      hands = new Hands({ locateFile: f => `/vendor/hands/${f}` });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
      });
    } catch (e) {
      handlers.onStatus("Gesture: failed to start — keyboard/mouse mode");
      return;
    }

    hands.onResults(results => {
      const all = results.multiHandLandmarks || [];
      const labels = results.multiHandedness || [];
      if (!all.length) {
        handlers.onAim(0, 0);
        handlers.onMove(0, 0);
        handlers.onStatus("Gesture: show your hand to the camera 🖐️");
        return;
      }
      // Aim hand: prefer the one MediaPipe labels "Right"
      let aimIdx = labels.findIndex(h => h && h.label === "Right");
      if (aimIdx < 0 || aimIdx >= all.length) aimIdx = 0;
      const aimLm = all[aimIdx];
      const moveLm = all.length > 1 ? all[1 - aimIdx] : null;

      // --- Aim (mirrored x so it feels like a mirror) ---
      const c = palmCenter(aimLm);
      const mx = 1 - c.x; // selfie view
      let rx = (mx - 0.5) * 2;         // -1..1, right = +
      let ry = (0.5 - c.y) * 2;        // -1..1, up = +
      if (Math.abs(rx) < DEAD) rx = 0;
      if (Math.abs(ry) < DEAD) ry = 0;
      handlers.onAim(rx, ry);

      // --- Shoot: pinch thumb tip (4) to index tip (8) ---
      const d = dist(aimLm[4], aimLm[8]);
      if (pinchArmed && d < PINCH_ON) {
        pinchArmed = false;
        handlers.onShoot();
      } else if (!pinchArmed && d > PINCH_OFF) {
        pinchArmed = true;
      }

      // --- Move: second hand position in its half of the frame ---
      if (moveLm) {
        const mc = palmCenter(moveLm);
        const mmx = 1 - mc.x;
        let sx = (mmx - 0.5) * 2;      // strafe: right = +
        let fz = (0.5 - mc.y) * 2;     // hand high = forward, low = back
        if (Math.abs(sx) < 0.3) sx = 0;
        if (Math.abs(fz) < 0.3) fz = 0;
        handlers.onMove(
          Math.max(-1, Math.min(1, sx)),
          Math.max(-1, Math.min(1, fz))
        );
        handlers.onStatus("Gesture: ACTIVE — 2 hands (aim + move) 🎯");
      } else {
        handlers.onMove(0, 0);
        handlers.onStatus("Gesture: ACTIVE — aim + pinch ✋ (add 2nd hand to move)");
      }
    });

    const camera = new Camera(videoEl, {
      onFrame: async () => { try { await hands.send({ image: videoEl }); } catch (_) {} },
      width: 640, height: 480
    });
    camera.start()
      .then(() => { running = true; handlers.onStatus("Gesture: show your hand to the camera 🖐️"); })
      .catch(() => handlers.onStatus("Gesture: camera blocked — keyboard/mouse mode"));
  }

  return { start };
})();
