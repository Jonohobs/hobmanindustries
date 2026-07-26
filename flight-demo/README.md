# Hobman Industries Flight + Telekinesis Demo

A self-contained browser videogame prototype inspired by hobmanindustries.com: cold blue patent-interface styling, two load-bearing carrier blimps linked by a travelling pulley trolley, three vector drones suspended beneath that carrier cable, visible cargo hooks and three-point hoist lines, building collision, glowing pads, cargo cores, and a third-person camera that frames both the carriers and a readable spread-arm storybook flying pose.

## Run

```bash
cd /home/jonathan-hobman/code/hobman-flight-telekinesis-demo
python3 -m http.server 8799 --bind 127.0.0.1
```

Open: http://127.0.0.1:8799/

## Controls

- Click canvas: capture mouse
- Mouse: look
- W A S D: horizontal flight
- Space / Left Ctrl: ascend / descend
- Shift: boost
- E or Right Mouse: telekinetic grab/release nearest highlighted object
- Mouse wheel: adjust grab distance
- Left Mouse: impulse / throw grabbed object
- F: test automatic helium-bladder and parachute fall arrest
- Touch phones/tablets: left virtual stick to fly, drag the right side to look, and use UP/DOWN, HOOK, PULSE, BOOST, and SAFETY buttons
- R: reset objects

## Objective

Lift the blue cargo cores onto the glowing pads. The demo is also a sandbox: after the cargo is secured, fly around and throw debris.

## Files

- `index.html` — page/HUD
- `styles.css` — Hobman Industries visual styling
- `main.js` — pure vanilla Canvas/JS game loop, projection, flight, physics, telekinesis

No npm install required.
