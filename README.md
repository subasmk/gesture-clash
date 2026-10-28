# 🥊 Gesture Clash — 1v1 Gesture-Controlled FPS Arena

A small **3D first-person 1v1 arena** for two laptops on the same WiFi/hotspot.
Your **webcam is the controller**: move your hand to aim, **pinch 👌 to shoot**,
use a second hand (or WASD) to move. One round — **first elimination wins** —
winner screen shows, then the match auto-resets for the next pair.

Built for a school project expo: no installs for players, everything runs in the browser,
and all AI hand-tracking runs **locally** (no internet needed after `npm install`).

## Quick start

**Laptop 1 (server + Player 1):**
```bash
npm install   # one time only
npm start
```
The terminal prints two links. Laptop 1 opens the `localhost` link.

**Laptop 2 (Player 2):** open the second link (the server laptop's WiFi IP)
in Chrome/Edge. Both laptops must be on the **same WiFi/hotspot**.

> The server uses a self-signed HTTPS certificate (needed for webcam access on the
> second laptop). On each laptop, click **Advanced → Proceed** once — that's normal.

## How a round works
1. Both players enter a name → **JOIN ARENA**
2. Both press **I'M READY ✋**
3. 3-2-1 countdown → **FIGHT!**
4. First hit eliminates — 🏆 winner screen — auto-reset in 6 seconds for the next pair

## Controls
| Action | Gesture | Backup |
|---|---|---|
| Aim | Move your hand (right hand) around the camera view | Mouse (click arena first) |
| Shoot | Pinch thumb + index finger 👌 | Click / SPACE |
| Move | Second hand: high = forward, low = back, sides = strafe | WASD / arrow keys |

## Tech
- **Server:** Node.js + Express + Socket.IO — server-validated hits (aim angle +
  line-of-sight vs cover boxes), 320 ms shot cooldown, authoritative round flow
- **3D:** Three.js arena with mirror-symmetric cover layout (fair spawns)
- **Gestures:** MediaPipe Hands (vendored locally — works fully offline)

## Notes for expo day
- Test both laptops on the actual hotspot once before the event.
- Keep players ~0.5–1 m from the webcam, with decent light on their hands.
- Gesture is primary; keyboard/mouse backup is always live if tracking struggles.
