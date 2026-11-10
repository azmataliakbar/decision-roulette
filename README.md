# Decision Roulette

Spin a neon wheel to make a decision. Add options, give each one a weight and colour, save presets, and keep a history of results. Plain HTML, CSS and JavaScript. No build step, no npm, no API keys.

## Run it

Double-click `index.html`. Press **Spin** (or the Space bar) to spin the wheel.

## What it does

- **Wheel:** an SVG wheel drawn from your options. Each slice's size comes from its weight, so a weight of 3 gets three times the slice of a weight of 1.
- **Physics spin:** the wheel starts from rest, speeds up quickly, cruises, then slows with quadratic friction until it stops. It runs on `requestAnimationFrame`, so it stays smooth.
- **Fair result:** the winner is chosen first, with probability proportional to weight. The wheel then turns to stop inside that slice, so the result never depends on where the animation happens to end.
- **Result dialog:** an accessible dialog shows the winner. Press Escape to close it, or choose **Spin again**.
- **Entry matrix:** add options (up to 40, labels up to 30 characters), change each label, weight (1 to 10) and colour, or delete one. Changes are blocked while the wheel is turning.
- **Presets:** save the current list under a name, load it later, or delete it (up to 20).
- **History logs:** every result is recorded with the time and the number of options. You can clear the log.
- **Sound:** a short tick as the pointer crosses each slice, and a chime on the result. Turn it off with the Sound button. Audio is generated in the browser, with no files.
- **Reduced motion:** if your device asks for reduced motion, the spin is shorter.

## Layout

- **Phones (below 1024px):** three tabs at the bottom: **Wheel**, **Matrix Entries** and **History Logs**. The wheel is sized to fit the screen.
- **Wide laptops (1024px and up):** a split screen, with entries and history on the left and the wheel on the right.
- **Footer:** the "Idea By: Azmat Ali" signature stays fixed at the bottom in a calligraphy font. It never wraps or causes sideways scrolling.

## Storage

Your options, presets, history and sound setting are saved in this browser only, under the namespace `dr_vault_v1_`. Clearing the site's data resets everything. If browser storage is blocked, the app still works for the current visit.

## How it works

Every change goes through one command dispatcher, which validates its input before changing anything:

| Command | What it does |
|---|---|
| `choices.add`, `choices.update`, `choices.remove` | Manage the options |
| `choices.savePreset`, `choices.loadPreset`, `choices.deletePreset` | Manage presets |
| `wheel.spin` | Choose the winner and plan the spin |
| `logs.add`, `logs.clear` | Manage the history |
| `settings.set` | Save the sound setting |

## Tests

```bash
node --test tests/engine.test.js
```

The 13 tests cover: slice angles adding up to 360°, the pointer reading the right slice, planned spins always stopping inside their winning slice, weighted odds, the spin profile starting and ending at rest, validation, the dispatcher's limits, presets, the `dr_vault_v1_` namespace, history limits, and behaviour when storage is blocked.

## Structure

```
index.html            page: wheel console, entry matrix, history, dialog, tabs, footer
css/app.css           dark neon theme, glass cards, layouts, footer
js/config.js          spin durations and defaults
js/engine.js          pure logic: validation, slices, fair choice, spin profile, vault, dispatcher
js/wheel.js           SVG wheel renderer (built with DOM methods, so labels are never parsed as HTML)
js/app.js             controller: spin loop, sound, matrix, presets, history, tabs
tests/engine.test.js  Node tests for the engine
```
