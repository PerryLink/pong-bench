# The app

```bash
node bin/pongbench.js serve --config typesafe-jev --open   # http://127.0.0.1:8800, opened in the default browser
```

| | Start it with | Stop it |
|---|---|---|
| any system | `npm start` (the scripted player) or the command above | Ctrl+C |
| Windows | double-click `Start-PongBench.bat`, or `Start-PongBench.bat typesafe-jev` | close the window |
| macOS | double-click `Start-PongBench.command` in Finder, or `./start-pongbench.sh typesafe-jev` | close the Terminal window, or Ctrl+C |
| Linux | `./start-pongbench.sh typesafe-jev` | Ctrl+C |

`--open` uses the system's own opener (`start`, `open` or `xdg-open`); without a desktop (a server, SSH, a container)
it prints the address instead. The server holds the endpoint config and any key; the page never sees a key. It binds
to 127.0.0.1 unless you pass `--host`. The page is plain HTML, CSS and JavaScript modules with no build step; it was
checked in Chrome.

Other websites open in the same browser cannot use it. The server answers only requests addressed to
`127.0.0.1:<port>` or `localhost:<port>` (so a rebound DNS name gets nothing), refuses any browser request or WebSocket
whose Origin is not the app itself, takes request bodies only as `application/json` (so a page cannot post a plain form
to it), and switches endpoints only by a config's name in `configs/`, never by a path. To open the app from another
machine on your network, start it with `--host 0.0.0.0` and list the names you will use in `PONGBENCH_ALLOWED_HOSTS`
(for example `PONGBENCH_ALLOWED_HOSTS=192.168.1.20`); anyone who can reach it can spend your endpoint's credits.

| Tab | What it is for |
|---|---|
| **Play** | you (amber, left) against the model (teal, right) in real time. <kbd>W</kbd> <kbd>S</kbd>, the arrow keys or the mouse move your paddle; <kbd>Space</kbd> serves and pauses; <kbd>R</kbd> restarts |
| **Bot match** | a bot (Easy, Medium, Hard, Perfect) against the model, in real time |
| **Watch** | the model plays the upstream benchmark game (the Rally suite's mechanic: one decision, one step, against a wall that never misses). Record runs for Replays |
| **Bench** | pick and check an endpoint, run the benchmark with any settings, watch it live, read scorecards, compare runs |
| **Prompt lab** | edit everything the model reads, check it on 300 fixed states, apply it to the game, save presets |
| **Replays** | Watch recordings side by side on one clock, and the list of saved games |

## The Bench tab

- **Endpoint**: every config in `configs/`, with whether its key is found. **Use** switches the app to it; **Check**
  asks four decisions (one of each kind) and shows each answer, its latency and its probabilities.
- **Run the benchmark**: suites (Decisions, Rally, Arena), track (Standard, Compact, Minimal, Reasoning, or the prompt
  the game currently uses), quick run, requests in flight, arena bots, stay handicap (off for official runs), a label.
  The estimate line counts the calls and, after a check, the time.
- **Progress**: one bar per suite with the share right so far, and a log of each finished suite. It is the same runner
  as `node bin/pongbench.js run`, running in the server, so closing the page does not stop it.
- **Scorecard**: the score, per-move accuracy, the hard bands, the edges, calibration, latency and tokens, rally and
  arena. Every run is saved to `results/<run>/` and the leaderboard is rebuilt.
- **Runs**: every result; click one to see its scorecard.

## Settings (the sliders button, top right)

| Group | Settings |
|---|---|
| Setups | save every setting under a name; load or delete |
| Model input | the prompt (the tracks, the lab's prompt, saved presets), the stay tolerance |
| Decisions | transport between the page and the server (WebSocket or HTTP), requests in flight, minimum confidence (below it the paddle keeps its previous move), added latency, a decision cap, the stay handicap |
| Game | ball speed, speed-up per hit, paddle size and speed, fair paddles, points to win, bot level |
| Display | intercept guide, ball trail, glow and hit flashes, sound (off by default) |
| Data | save every game (on by default) |

Real-time play asks at most 125 decisions per second (physics changes from frame to frame, so faster only floods the
logs); the Decisions and Rally suites have no cap.

## The live metrics

| Metric | Meaning |
|---|---|
| decisions/s | answers per second while the ball is in play |
| round trip | the page sending a state to the answer arriving |
| endpoint p50 | the endpoint's own time, measured by the server |
| transport | round trip minus endpoint time (page to server and back) |
| reaction | state snapshot to the paddle using the answer |
| matches the rule | answers equal to the rule; a note counts "stay" answers where the rule pointed into a wall the paddle already touches |
| confidence, held | the top probability; answers held back by the minimum-confidence setting |
| Endpoint | connector, model, calls, errors, input tokens, whether probabilities are the model's own |

## Saved games

Every game in every mode is saved by default to `data/games/<when>_<mode>_<id>.jsonl` (git-ignored): a header with all
settings and the exact prompt, every decision (the exact state sent, the full game state, the rule's move, the answer
and its probabilities, the timings), every event (hits with where on the paddle, misses with how far the paddle was,
wall bounces, serves, pauses, prompt and setting changes), the ball and both paddles 20 times a second, and a
summary. The Replays tab lists them.

## How the real-time game stays honest

- The model's paddle moves only on the model's answers, at the set speed; the rule only scores.
- Physics is advanced to the moment each state is sent and each answer lands, so the model sees the state of that
  instant and its answer takes effect when it arrives.
- An answer about a rally that ended or paused while it was on its way is dropped (each rally has an epoch).
- Hits and misses are judged at the exact crossing, computed by the same function that gives the model interceptY.

`npm test` checks each of these.
