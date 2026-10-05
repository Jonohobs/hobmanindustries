# Drone Dodgeball — Tetherball Zero

A playable browser concept: fly against a computer opponent, hold to focus and catch, then release to throw. First to five wins. Keyboard and touch controls are available, with a Canvas view for devices without WebGL 2.

WASD / arrows move, Shift ascends, F descends, Space or the primary mouse button holds focus, and releasing throws. V changes camera, Escape pauses, and R resets. Touch uses a flight stick and hold/release action button.

## Simulation scope

Keyboard and touch input stand in for decoded intent. No EEG hardware is connected; the focus meter is a game state. Movement delay and noise are synthetic. Visible cables illustrate the proposed rig but do not solve loads, tension, slack, crossing clearance or failure recovery. The caged drone ball follows game trajectories; propulsion, impact energy, collision avoidance and airworthiness are not validated. This prototype does not establish human-flight safety or hardware feasibility.

Three.js is distributed locally under its MIT license in vendor/LICENSE. The game supports a Canvas fallback; use ?renderer=canvas to select it.
