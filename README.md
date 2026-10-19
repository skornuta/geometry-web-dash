# Geometry Dash 2.2 Web Port

A high-performance, 1:1 web port of **Geometry Dash 2.2** built with vanilla **TypeScript + WebGL2**. 

Unlike emulators or binary recompilations, this engine is ultra-lightweight (~450 KB asset footprint), runs natively at **240 Hz**, and achieves locked 60/120/240 fps across all browsers and weak hardware.

## Features & Progress

- **22/22 Main Levels Solvable:** 100% completion verified by headless beam-search AI solver across all classic levels.
- **8 Gamemodes Implemented:** Cube, Ship, Ball, UFO, Wave, Robot, Spider, and Swing.
- **2.2 Trigger & Particle Engine:** HSV color channels, move stacking, rotate triggers around pivot points, screen shake, and Cocos2d-x particle emitters.
- **Sourced Binary Physics:** Ground truth derived from GD 2.2081 native ARM64 disassemblies.
- **UI & Icon Kit:** 2.2 main menu, level selection, options overlay, practice mode checkpoints, secret coins, and icon kit with 107 palette colors.

## Getting Started

### Prerequisites
- Node.js 18+ and `npm`

### Setup & Run
```bash
# Clone the repository
git clone https://github.com/skornuta/geometry-web-dash.git
cd geometry-dash/web-port

# Install dependencies
npm install

# Copy game assets from your own Geometry Dash install
# (put GD's Resources folder at ../steam-gd/Resources first;
#  game files are never committed to this repo)
npm run assets

# Start the Vite development server
npm run dev
```

### Running Tests & Verification
```bash
# Run unit tests (370+ passing)
npm test

# Run TypeScript type check
npx tsc --noEmit

# Run headless 22-level physics sweep
npm run sweep
```
