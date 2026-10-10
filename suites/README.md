# The frozen suites

- `decisions-v1.json`: 900 decision states (300 up, 300 down, 150 ball moving away, 150 covered) with the rule's move,
  and the SHA-256 of the items. Every run verifies the hash; `node bin/pongbench.js suites --build` rebuilds the file
  byte for byte from seeds, on any OS. Never edit it: a change makes a new version.
- `rally-v1.json`: the lockstep rally plan (seeds 101 to 104, 300 decisions each; the quick plan uses two seeds of 150).

Each item's `ds` is the full decision state; a track picks which of its fields a model gets (see
[../docs/PROMPTS.md](../docs/PROMPTS.md)). Other languages can read this file directly to run the same states.
