# Client budgets (release measurement, copied from reports/budgets.md)

Generated 2026-09-25T09:55:07.198Z by `pnpm measure:client` · commit 901fc2b+dirty · Chromium 141.0.7390.37 · Node v22.22.2

Machine: 4 × Intel(R) Xeon(R) Processor @ 2.80GHz; 1-minute load average 0.6 at start, 1.29 at end.

**9 of 9 budgets pass.** Spec 12.3 (R-TECH-003) and 11.4 (R-ART-004); sizes in decimal units (1 kB = 1000 B).

## Budgets

| Budget                                                                                                                                                                                                 | Spec            | Limit                  | Measured                           | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------- | ---------------------------------- | ------ |
| Initial JavaScript (entry JS + CSS, gzip)<br><small>CSS is counted too, which is stricter than the JavaScript-only budget.</small>                                                                     | 12.3 R-TECH-003 | ≤ 600 kB               | 101.4 kB (JS 93.8 kB + CSS 7.6 kB) | ✓ pass |
| First load, to the title screen (gzip)<br><small>index.html, initial JS and CSS, manifest and icons.</small>                                                                                           | 11.4 R-ART-004  | ≤ 2 MB                 | 102.4 kB                           | ✓ pass |
| First playable, whole build incl. Phaser and NPC worker (gzip)<br><small>The tutorial town arrives in M5; until then a local battle is the first playable.</small>                                     | 11.4 R-ART-004  | ≤ 5 MB                 | 583.3 kB (Phaser chunk 353.7 kB)   | ✓ pass |
| Frame rate, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling (lower of idle battle and NPC game)                                                                                               | 12.3 R-TECH-003 | ≥ 30 fps floor         | 38.3 fps (idle 60, NPC game 38.3)  | ✓ pass |
| Memory: peak JS heap, Minimum device: 360x640, DPR 2, touch, 4x CPU throttling                                                                                                                         | 12.3 R-TECH-003 | ≤ 150 MB               | 21.9 MB (after GC 9.1 MB)          | ✓ pass |
| Memory: tab renderer process (PSS), Minimum device: 360x640, DPR 2, touch, 4x CPU throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small> | 12.3 R-TECH-003 | ≤ 150 MB               | 129.5 MB                           | ✓ pass |
| Frame rate, Desktop: 1280x800, DPR 1, no throttling (lower of idle battle and NPC game)                                                                                                                | 12.3 R-TECH-003 | 60 fps (≥ 57 measured) | 58.3 fps (idle 60, NPC game 58.3)  | ✓ pass |
| Memory: peak JS heap, Desktop: 1280x800, DPR 1, no throttling                                                                                                                                          | 12.3 R-TECH-003 | ≤ 150 MB               | 25.6 MB (after GC 9.9 MB)          | ✓ pass |
| Memory: tab renderer process (PSS), Desktop: 1280x800, DPR 1, no throttling<br><small>Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.</small>                  | 12.3 R-TECH-003 | ≤ 150 MB               | 148.8 MB                           | ✓ pass |

## Bundle

Initial chunks: the entry script, stylesheets and modulepreloads of `index.html` plus their static imports (/assets/index-DNhtcx1o.js, /assets/signals.module-CPYC4lQx.js, /assets/types-C_0LeeO1.js, /assets/preview-C-XXlH8Y.js; CSS /assets/index-caIe_BVO.css). Everything else loads on demand.

| File                                     | Loads               |      Raw |  gzip -9 | brotli -11 |
| ---------------------------------------- | ------------------- | -------: | -------: | ---------: |
| `/assets/phaser.esm-CTbIuaw5.js`         | lazy (Phaser board) |  1.37 MB | 353.7 kB |   282.9 kB |
| `/assets/index-DNhtcx1o.js`              | initial             | 258.7 kB |  78.7 kB |    68.3 kB |
| `/assets/WorldScreen-CcNa381_.js`        | lazy                | 171.3 kB |  38.5 kB |    33.3 kB |
| `/assets/npc.worker-CEYN1jow.js`         | lazy (worker)       |  99.4 kB |  31.2 kB |    27.6 kB |
| `/assets/game-BwOkNpqi.js`               | lazy                |  28.8 kB |  13.0 kB |    11.4 kB |
| `/assets/game-DI8sX7Oj.js`               | lazy                |  32.8 kB |  11.7 kB |    10.6 kB |
| `/assets/signals.module-CPYC4lQx.js`     | initial             |  21.4 kB |   8.2 kB |     7.5 kB |
| `/assets/index-caIe_BVO.css`             | initial             |  32.3 kB |   7.6 kB |     6.7 kB |
| `/assets/preview-C-XXlH8Y.js`            | initial             |  17.0 kB |   6.8 kB |     6.1 kB |
| `/assets/WatchScreen-Axs9869T.js`        | lazy                |  17.8 kB |   6.7 kB |     6.0 kB |
| `/assets/src-dBmvYcfS.js`                | lazy                |  11.1 kB |   4.4 kB |     4.1 kB |
| `/assets/TournamentsScreen-DJmaZGVP.js`  | lazy                |  13.1 kB |   4.4 kB |     3.9 kB |
| `/assets/AccountScreen-CGkiSBZp.js`      | lazy                |   9.7 kB |   3.3 kB |     2.9 kB |
| `/assets/palette-B9jI6vch.js`            | lazy                |   5.7 kB |   2.7 kB |     2.3 kB |
| `/assets/OnlineScreen-2b09wLDR.js`       | lazy                |   6.7 kB |   2.5 kB |     2.2 kB |
| `/assets/GuildPanel-Cj6MFkhT.js`         | lazy                |   6.7 kB |   2.4 kB |     2.0 kB |
| `/assets/LoginScreen-ACJMlCZh.js`        | lazy                |   3.9 kB |   1.8 kB |     1.5 kB |
| `/assets/LeaderboardsScreen-CBrgABim.js` | lazy                |   4.7 kB |   1.7 kB |     1.5 kB |
| `/assets/RankedPanel-COk1oQ3x.js`        | lazy                |   3.0 kB |   1.5 kB |     1.3 kB |
| `/assets/SafetyPanel-3l2RP1BT.js`        | lazy                |   2.3 kB |   1.1 kB |     0.9 kB |
| `/index.html`                            | first-load asset    |   1.0 kB |   0.5 kB |     0.3 kB |
| `/assets/GuildScreen-Bn6hMtEf.js`        | lazy                |   0.7 kB |   0.4 kB |     0.4 kB |
| `/manifest.webmanifest`                  | first-load asset    |   0.5 kB |   0.3 kB |     0.2 kB |
| `/icon.svg`                              | first-load asset    |   0.5 kB |   0.2 kB |     0.2 kB |
| `/assets/types-C_0LeeO1.js`              | initial             |   0.2 kB |   0.2 kB |     0.2 kB |
| **Total**                                |                     |  2.12 MB | 583.3 kB |            |

## Runtime

Headless Chromium, production build served by `vite preview` (gzip). A local Full Battle against the Elite NPC: 5 s of idle battle, then 5 s of an NPC game in which the script plays random legal moves through the Move panel. Frame rates come from a requestAnimationFrame counter; JS heap from CDP Performance.getMetrics (after a forced GC where noted) and performance.memory; tab memory is the renderer process PSS from /proc.

| Metric                                                 |                                               min-device |                                 desktop |
| ------------------------------------------------------ | -------------------------------------------------------: | --------------------------------------: |
| Profile                                                | Minimum device: 360x640, DPR 2, touch, 4x CPU throttling | Desktop: 1280x800, DPR 1, no throttling |
| Board renderer                                         |                                                    WebGL |                                   WebGL |
| Title visible after                                    |                                                   439 ms |                                  103 ms |
| Board ready after Start                                |                                                  1234 ms |                                  376 ms |
| Title: files / transferred / gzip -9                   |                                  8 / 105.6 kB / 102.1 kB |                 8 / 105.6 kB / 102.1 kB |
| Playable battle: files / transferred / gzip -9         |                                 12 / 477.8 kB / 501.4 kB |                12 / 477.8 kB / 501.4 kB |
| Title screen fps, no board (p95 / worst frame)         |                                      60 (16.7 / 16.8 ms) |                     60 (16.7 / 16.8 ms) |
| Idle battle fps (p95 / worst frame)                    |                                      60 (16.7 / 16.8 ms) |                     60 (16.8 / 16.8 ms) |
| NPC game fps (p95 / worst frame)                       |                                       38.3 (50 / 100 ms) |                   58.3 (16.8 / 49.9 ms) |
| NPC game: frames over 33 ms                            |                                                17 of 196 |                                1 of 302 |
| Main thread in tasks / on CPU / in script: title       |                                        4.2% / n/a / 1.2% |                      0.8% / 1.1% / 0.3% |
| Main thread in tasks / on CPU / in script: idle battle |                                        8.2% / n/a / 2.1% |                      3.1% / 1.6% / 0.5% |
| Main thread in tasks / on CPU / in script: NPC game    |                                      95.7% / n/a / 17.5% |                      91.1% / 22% / 6.1% |
| NPC game: our moves / log actions                      |                                                   7 / 14 |                                 16 / 29 |
| JS heap used, title (after GC)                         |                                                   2.5 MB |                                  2.4 MB |
| JS heap used, idle battle (after GC)                   |                                                   7.8 MB |                                  7.9 MB |
| JS heap used, NPC game peak                            |                                                  21.9 MB |                                 25.6 MB |
| JS heap used / total after the game                    |                           13 / 20.5 MB (after GC 9.1 MB) |        14.8 / 27.6 MB (after GC 9.9 MB) |
| Tab renderer process PSS                               |                                                 129.5 MB |                                148.8 MB |
| GPU process PSS (not counted)                          |                                                  73.5 MB |                                   81 MB |

## Caveats

- Headless Chromium renders WebGL in software (SwiftShader) in the GPU process, which CPU throttling does not slow; a real 2019 mid-range phone has a GPU but a slower CPU. Treat the frame rates as indicative and re-measure on a device before release.
- Read the frame rates with the title-screen row (same browser, no WebGL board) and the main-thread rows: "in tasks" includes time blocked on the GPU process, "on CPU" is the thread's own CPU time. A low frame rate with the main thread in tasks near 100% but little CPU or script time means frames wait on the software WebGL rasteriser, not on client code.
- "Transferred" counts response bodies and headers as Chromium reports them; the NPC worker script is not always reported, so the gzip -9 column (static sizes of the files that were requested) is the reliable one.
- The 60 fps target is checked with a 5% tolerance for requestAnimationFrame jitter; the 30 fps floor has none.
