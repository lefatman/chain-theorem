# Client budgets (release measurement, copied from reports/budgets.md)

Generated 2026-10-06T05:54:42.472Z by `pnpm measure:client` · commit a760565 · Chromium 141.0.7390.37 · Node v22.22.2

Machine: 4 × Intel(R) Xeon(R) Processor @ 2.10GHz; 1-minute load average 2.38 at start, 2.01 at end.

**9 of 9 budgets pass.** Spec 12.3 (R-TECH-003) and 11.4 (R-ART-004); sizes in decimal units (1 kB = 1000 B).

## Budgets

| Budget                                                                                                                                                                                                 | Spec            | Limit                  | Measured                           | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------- | ---------------------------------- | ------ |
| Initial JavaScript (entry JS + CSS, gzip)<br><small>CSS is counted too, which is stricter than the JavaScript-only budget.</small>                                                                     | 12.3 R-TECH-003 | ≤ 600 kB               | 102.8 kB (JS 95.3 kB + CSS 7.6 kB) | ✓ pass |
| First load, to the title screen (gzip)<br><small>index.html, initial JS and CSS, manifest and icons.</small>                                                                                           | 11.4 R-ART-004  | ≤ 2 MB                 | 103.8 kB                           | ✓ pass |
| First playable, whole build incl. Phaser and NPC worker (gzip)<br><small>The tutorial town arrives in M5; until then a local battle is the first playable.</small>                                     | 11.4 R-ART-004  | ≤ 5 MB                 | 587.0 kB (Phaser chunk 353.7 kB)   | ✓ pass |
| Frame rate, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling (lower of idle battle and NPC game)                                                                                               | 12.3 R-TECH-003 | ≥ 30 fps floor         | 38.2 fps (idle 60, NPC game 38.2)  | ✓ pass |
| Memory: peak JS heap, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling                                                                                                                         | 12.3 R-TECH-003 | ≤ 150 MB               | 22.3 MB (after GC 9.1 MB)          | ✓ pass |
| Memory: tab renderer process (PSS), Minimum device: 360x640, DPR 2, touch, 4x CPU throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small> | 12.3 R-TECH-003 | ≤ 150 MB               | 126 MB                             | ✓ pass |
| Frame rate, Desktop: 1280x800, DPR 1, no throttling (lower of idle battle and NPC game)                                                                                                                | 12.3 R-TECH-003 | 60 fps (≥ 57 measured) | 58.3 fps (idle 60, NPC game 58.3)  | ✓ pass |
| Memory: peak JS heap, Desktop: 1280x800, DPR 1, no throttling                                                                                                                                          | 12.3 R-TECH-003 | ≤ 150 MB               | 26.5 MB (after GC 9.8 MB)          | ✓ pass |
| Memory: tab renderer process (PSS), Desktop: 1280x800, DPR 1, no throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small>                  | 12.3 R-TECH-003 | ≤ 150 MB               | 147 MB                             | ✓ pass |

## Bundle

Initial chunks: the entry script, stylesheets and modulepreloads of `index.html` plus their static imports (/assets/index-CObQI50a.js, /assets/signals.module-CPYC4lQx.js, /assets/types-C_0LeeO1.js, /assets/preview-C-XXlH8Y.js; CSS /assets/index-caIe_BVO.css). Everything else loads on demand.

| File                                     | Loads               |      Raw |  gzip -9 | brotli -11 |
| ---------------------------------------- | ------------------- | -------: | -------: | ---------: |
| `/assets/phaser.esm-CTbIuaw5.js`         | lazy (Phaser board) |  1.37 MB | 353.7 kB |   282.9 kB |
| `/assets/index-CObQI50a.js`              | initial             | 262.4 kB |  80.1 kB |    69.7 kB |
| `/assets/WorldScreen-DkgYEy6O.js`        | lazy                | 171.9 kB |  38.8 kB |    33.5 kB |
| `/assets/npc.worker-CEYN1jow.js`         | lazy (worker)       |  99.4 kB |  31.2 kB |    27.6 kB |
| `/assets/game-DBZsTRU_.js`               | lazy                |  39.4 kB |  13.3 kB |    11.9 kB |
| `/assets/game-4g0C5HN9.js`               | lazy                |  28.8 kB |  13.0 kB |    11.4 kB |
| `/assets/signals.module-CPYC4lQx.js`     | initial             |  21.4 kB |   8.2 kB |     7.5 kB |
| `/assets/index-caIe_BVO.css`             | initial             |  32.3 kB |   7.6 kB |     6.7 kB |
| `/assets/preview-C-XXlH8Y.js`            | initial             |  17.0 kB |   6.8 kB |     6.1 kB |
| `/assets/WatchScreen-BxvO-OwR.js`        | lazy                |  18.0 kB |   6.7 kB |     6.1 kB |
| `/assets/src-dBmvYcfS.js`                | lazy                |  11.1 kB |   4.4 kB |     4.1 kB |
| `/assets/TournamentsScreen-1PHUnixU.js`  | lazy                |  13.1 kB |   4.4 kB |     3.9 kB |
| `/assets/AccountScreen-D7ZDmwWp.js`      | lazy                |   9.7 kB |   3.3 kB |     2.9 kB |
| `/assets/palette-BTW6nhdB.js`            | lazy                |   6.5 kB |   3.0 kB |     2.6 kB |
| `/assets/OnlineScreen-CGDqGK5K.js`       | lazy                |   6.7 kB |   2.5 kB |     2.2 kB |
| `/assets/GuildPanel-R851xjzA.js`         | lazy                |   6.7 kB |   2.4 kB |     2.0 kB |
| `/assets/LoginScreen-OKMGuMLI.js`        | lazy                |   3.9 kB |   1.8 kB |     1.5 kB |
| `/assets/LeaderboardsScreen-L1Mo2WKj.js` | lazy                |   4.7 kB |   1.7 kB |     1.5 kB |
| `/assets/RankedPanel-BdC1QNAR.js`        | lazy                |   3.0 kB |   1.5 kB |     1.3 kB |
| `/assets/SafetyPanel-CzJquOTY.js`        | lazy                |   2.3 kB |   1.1 kB |     0.9 kB |
| `/index.html`                            | first-load asset    |   1.0 kB |   0.5 kB |     0.3 kB |
| `/assets/GuildScreen-BWWe1CM2.js`        | lazy                |   0.7 kB |   0.4 kB |     0.4 kB |
| `/manifest.webmanifest`                  | first-load asset    |   0.5 kB |   0.3 kB |     0.2 kB |
| `/icon.svg`                              | first-load asset    |   0.5 kB |   0.2 kB |     0.2 kB |
| `/assets/types-C_0LeeO1.js`              | initial             |   0.2 kB |   0.2 kB |     0.2 kB |
| **Total**                                |                     |  2.14 MB | 587.0 kB |            |

## Runtime

Headless Chromium, production build served by `vite preview` (gzip). A local Full Battle against the Elite NPC: 5 s of idle battle, then 5 s of an NPC game in which the script plays random legal moves through the Move panel. Frame rates come from a requestAnimationFrame counter; JS heap from CDP Performance.getMetrics (after a forced GC where noted) and performance.memory; tab memory is the renderer process PSS from /proc.

| Metric                                                 |                                               min-device |                                 desktop |
| ------------------------------------------------------ | -------------------------------------------------------: | --------------------------------------: |
| Profile                                                | Minimum device: 360x640, DPR 2, touch, 4x CPU throttling | Desktop: 1280x800, DPR 1, no throttling |
| Board renderer                                         |                                                    WebGL |                                   WebGL |
| Title visible after                                    |                                                   477 ms |                                  123 ms |
| Board ready after Start                                |                                                  1179 ms |                                  435 ms |
| Title: files / transferred / gzip -9                   |                                  8 / 107.1 kB / 103.6 kB |                 8 / 107.1 kB / 103.6 kB |
| Playable battle: files / transferred / gzip -9         |                                 12 / 481.2 kB / 504.8 kB |                12 / 481.2 kB / 504.8 kB |
| Title screen fps, no board (p95 / worst frame)         |                                    59.6 (16.7 / 33.3 ms) |                     60 (16.7 / 16.8 ms) |
| Idle battle fps (p95 / worst frame)                    |                                      60 (16.7 / 16.8 ms) |                     60 (16.8 / 16.8 ms) |
| NPC game fps (p95 / worst frame)                       |                                     38.2 (50 / 116.7 ms) |                   58.3 (16.8 / 50.1 ms) |
| NPC game: frames over 33 ms                            |                                                18 of 202 |                                2 of 300 |
| Main thread in tasks / on CPU / in script: title       |                                        4.1% / n/a / 1.2% |                      1.2% / 1.5% / 0.3% |
| Main thread in tasks / on CPU / in script: idle battle |                                        7.6% / n/a / 2.3% |                      3.2% / 1.9% / 0.6% |
| Main thread in tasks / on CPU / in script: NPC game    |                                      94.3% / n/a / 19.2% |                    84.8% / 25.2% / 6.7% |
| NPC game: our moves / log actions                      |                                                   7 / 14 |                                 17 / 29 |
| JS heap used, title (after GC)                         |                                                   2.5 MB |                                  2.4 MB |
| JS heap used, idle battle (after GC)                   |                                                   7.9 MB |                                    8 MB |
| JS heap used, NPC game peak                            |                                                  22.3 MB |                                 26.5 MB |
| JS heap used / total after the game                    |                           12.7 / 21 MB (after GC 9.1 MB) |        15.8 / 27.1 MB (after GC 9.8 MB) |
| Tab renderer process PSS                               |                                                   126 MB |                                  147 MB |
| GPU process PSS (not counted)                          |                                                  72.5 MB |                                 79.7 MB |

## Caveats

- Headless Chromium renders WebGL in software (SwiftShader) in the GPU process, which CPU throttling does not slow; a real 2019 mid-range phone has a GPU but a slower CPU. Treat the frame rates as indicative and re-measure on a device before release.
- Read the frame rates with the title-screen row (same browser, no WebGL board) and the main-thread rows: "in tasks" includes time blocked on the GPU process, "on CPU" is the thread's own CPU time. A low frame rate with the main thread in tasks near 100% but little CPU or script time means frames wait on the software WebGL rasteriser, not on client code.
- "Transferred" counts response bodies and headers as Chromium reports them; the NPC worker script is not always reported, so the gzip -9 column (static sizes of the files that were requested) is the reliable one.
- The 60 fps target is checked with a 5% tolerance for requestAnimationFrame jitter; the 30 fps floor has none.
- Other processes were busy during this run (load average above 2 on 4 CPUs). Software WebGL competes with them for the CPU, so frame rates and tab memory vary between runs; re-run on an idle machine for comparable numbers.
