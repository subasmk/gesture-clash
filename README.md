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

## Expo fixes and testing (28 October)
- After JOIN, hold BOTH open palms comfortably still for one second. Those actual
  hand positions become neutral. Press C any time to recalibrate. Do not move
  while calibration is running. Left hand controls movement; right controls aim.
- Up with LEFT palm = forward; down = backward; sides = strafe. Returning to the
  calibrated neutral deadzone stops movement. Missing either hand stops gestures.
- Pinch is scaled to your palm size. Open fingers before each pinch to re-arm.
- Camera/model stale for 400ms, window blur or hidden tab clears gesture input.
- Reconnection requires JOIN again. Both press READY for each new round.
- 90-second round timeout gives DRAW, then resets. First valid hit wins otherwise.
- Hit checks use a real 3D aim ray and cover heights, not horizontal angle only.
- Server caps movement speed and checks cover collision. Use private LAN only.

### Run on two laptops
Install a current supported Node.js LTS on HOST, run `npm ci`, then `npm start`.
Open printed HTTPS localhost URL on host. Friend opens printed Wi-Fi IPv4 HTTPS
URL on the same trusted hotspot. Verify IP using `ipconfig` if a VPN/virtual
adapter is present; `HOST_IP` can override the printed choice. Allow Node only
on PRIVATE networks if firewall prompts; do not disable the firewall.
The self-signed certificate is regenerated on restart, so a certificate warning
can recur. Verify it is YOUR host's private IP and expected port before using
browser's certificate exception. Do not bypass warnings for unrelated sites.
Allow camera in both browsers. If the remote browser refuses secure camera
access after that, do not disable browser security: use host-local gesture play
with the other keyboard/mouse fallback for a demonstration, or pause and report
the exact error. Two remote webcams have NOT been verified here.

### Verified vs unverified
`node test.js` tests server geometry/movement/IP logic. Syntax and local HTTPS
server, two synthetic Socket.IO clients and browser rendering were checked.
Real Windows webcams, mirrored directions, model performance and the physical
hotspot connection still require tonight's test. This is not a guarantee that
all bugs are gone. Browser certificate/camera behavior varies by device policy.
