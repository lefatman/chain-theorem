# Client budgets (M3 measurement, copied from reports/budgets.md)

Generated 2026-09-25T03:09:34.263Z by `pnpm measure:client` · commit f0c9c9a+dirty · Chromium 141.0.7390.37 · Node v22.22.2

Machine: 4 × Intel(R) Xeon(R) Processor @ 2.80GHz; 1-minute load average 2.63 at start, 2.48 at end.

**9 of 9 budgets pass.** Spec 12.3 (R-TECH-003) and 11.4 (R-ART-004); sizes in decimal units (1 kB = 1000 B).

## Budgets

| Budget                                                                                                                                                                                                 | Spec            | Limit                  | Measured                          | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------- | --------------------------------- | ------ |
| Initial JavaScript (entry JS + CSS, gzip)<br><small>CSS is counted too, which is stricter than the JavaScript-only budget.</small>                                                                     | 12.3 R-TECH-003 | ≤ 600 kB               | 66.4 kB (JS 61.9 kB + CSS 4.5 kB) | ✓ pass |
| First load, to the title screen (gzip)<br><small>index.html, initial JS and CSS, manifest and icons.</small>                                                                                           | 11.4 R-ART-004  | ≤ 2 MB                 | 67.3 kB                           | ✓ pass |
| First playable, whole build incl. Phaser and NPC worker (gzip)<br><small>The tutorial town arrives in M5; until then a local battle is the first playable.</small>                                     | 11.4 R-ART-004  | ≤ 5 MB                 | 462.7 kB (Phaser chunk 366.9 kB)  | ✓ pass |
| Frame rate, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling (lower of idle battle and NPC game)                                                                                               | 12.3 R-TECH-003 | ≥ 30 fps floor         | 38.3 fps (idle 60, NPC game 38.3) | ✓ pass |
| Memory: peak JS heap, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling                                                                                                                         | 12.3 R-TECH-003 | ≤ 150 MB               | 22 MB (after GC 8.5 MB)           | ✓ pass |
| Memory: tab renderer process (PSS), Minimum device: 360x640, DPR 2, touch, 4x CPU throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small> | 12.3 R-TECH-003 | ≤ 150 MB               | 126.3 MB                          | ✓ pass |
| Frame rate, Desktop: 1280x800, DPR 1, no throttling (lower of idle battle and NPC game)                                                                                                                | 12.3 R-TECH-003 | 60 fps (≥ 57 measured) | 58.6 fps (idle 60, NPC game 58.6) | ✓ pass |
| Memory: peak JS heap, Desktop: 1280x800, DPR 1, no throttling                                                                                                                                          | 12.3 R-TECH-003 | ≤ 150 MB               | 26 MB (after GC 9.3 MB)           | ✓ pass |
| Memory: tab renderer process (PSS), Desktop: 1280x800, DPR 1, no throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small>                  | 12.3 R-TECH-003 | ≤ 150 MB               | 148.2 MB                          | ✓ pass |

## Bundle

Initial chunks: the entry script, stylesheets and modulepreloads of `index.html` plus their static imports (/assets/index-BTTewTgI.js; CSS /assets/index-D_mfL5rN.css). Everything else loads on demand.

| File                             | Loads               |      Raw |  gzip -9 | brotli -11 |
| -------------------------------- | ------------------- | -------: | -------: | ---------: |
| `/assets/game-DFAl8acc.js`       | lazy (Phaser board) |  1.41 MB | 366.9 kB |   294.3 kB |
| `/assets/index-BTTewTgI.js`      | initial             | 186.8 kB |  61.9 kB |    54.5 kB |
| `/assets/npc.worker-DUDIeiNu.js` | lazy (worker)       |  86.9 kB |  28.5 kB |    25.4 kB |
| `/assets/index-D_mfL5rN.css`     | initial             |  17.1 kB |   4.5 kB |     4.0 kB |
| `/index.html`                    | first-load asset    |   0.7 kB |   0.4 kB |     0.3 kB |
| `/manifest.webmanifest`          | first-load asset    |   0.5 kB |   0.3 kB |     0.2 kB |
| `/icon.svg`                      | first-load asset    |   0.5 kB |   0.2 kB |     0.2 kB |
| **Total**                        |                     |  1.70 MB | 462.7 kB |            |

## Runtime

Headless Chromium, production build served by `vite preview` (gzip). A local Full Battle against the Elite NPC: 5 s of idle battle, then 5 s of an NPC game in which the script plays random legal moves through the Move panel. Frame rates come from a requestAnimationFrame counter; JS heap from CDP Performance.getMetrics (after a forced GC where noted) and performance.memory; tab memory is the renderer process PSS from /proc.

| Metric                                                 |                                               min-device |                                 desktop |
| ------------------------------------------------------ | -------------------------------------------------------: | --------------------------------------: |
| Profile                                                | Minimum device: 360x640, DPR 2, touch, 4x CPU throttling | Desktop: 1280x800, DPR 1, no throttling |
| Board renderer                                         |                                                    WebGL |                                   WebGL |
| Title visible after                                    |                                                   245 ms |                                   81 ms |
| Board ready after Start                                |                                                  1118 ms |                                  314 ms |
| Title: files / transferred / gzip -9                   |                                    4 / 69.0 kB / 67.0 kB |                   4 / 69.0 kB / 67.0 kB |
| Playable battle: files / transferred / gzip -9         |                                  6 / 439.3 kB / 462.5 kB |                 6 / 439.3 kB / 462.5 kB |
| Title screen fps, no board (p95 / worst frame)         |                                      60 (16.7 / 16.8 ms) |                     60 (16.7 / 16.8 ms) |
| Idle battle fps (p95 / worst frame)                    |                                      60 (16.8 / 16.8 ms) |                     60 (16.8 / 16.8 ms) |
| NPC game fps (p95 / worst frame)                       |                                       38.3 (50 / 100 ms) |                     58.6 (16.8 / 50 ms) |
| NPC game: frames over 33 ms                            |                                                15 of 198 |                                1 of 302 |
| Main thread in tasks / on CPU / in script: title       |                                        3.7% / n/a / 1.1% |                      0.8% / 1.1% / 0.3% |
| Main thread in tasks / on CPU / in script: idle battle |                                          8% / n/a / 2.3% |                      2.9% / 1.5% / 0.5% |
| Main thread in tasks / on CPU / in script: NPC game    |                                      96.1% / n/a / 19.5% |                      89.4% / 22.9% / 6% |
| NPC game: our moves / log actions                      |                                                   7 / 14 |                                 18 / 29 |
| JS heap used, title (after GC)                         |                                                   1.9 MB |                                  1.9 MB |
| JS heap used, idle battle (after GC)                   |                                                   7.3 MB |                                  7.3 MB |
| JS heap used, NPC game peak                            |                                                    22 MB |                                   26 MB |
| JS heap used / total after the game                    |                         10.1 / 19.7 MB (after GC 8.5 MB) |          12 / 28.4 MB (after GC 9.3 MB) |
| Tab renderer process PSS                               |                                                 126.3 MB |                                148.2 MB |
| GPU process PSS (not counted)                          |                                                  74.2 MB |                                 81.9 MB |

## Caveats

- Headless Chromium renders WebGL in software (SwiftShader) in the GPU process, which CPU throttling does not slow; a real 2019 mid-range phone has a GPU but a slower CPU. Treat the frame rates as indicative and re-measure on a device before release.
- Read the frame rates with the title-screen row (same browser, no WebGL board) and the main-thread rows: "in tasks" includes time blocked on the GPU process, "on CPU" is the thread's own CPU time. A low frame rate with the main thread in tasks near 100% but little CPU or script time means frames wait on the software WebGL rasteriser, not on client code.
- "Transferred" counts response bodies and headers as Chromium reports them; the NPC worker script is not always reported, so the gzip -9 column (static sizes of the files that were requested) is the reliable one.
- The 60 fps target is checked with a 5% tolerance for requestAnimationFrame jitter; the 30 fps floor has none.
- Other processes were busy during this run (load average above 2 on 4 CPUs). Software WebGL competes with them for the CPU, so frame rates and tab memory vary between runs; re-run on an idle machine for comparable numbers.
