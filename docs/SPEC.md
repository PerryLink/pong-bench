# The decision contract

Everything a model has to do to play PongBench: one request in, one move out. If your endpoint speaks TypeSafe's
System One API, it already fits. If it is a chat model, PongBench turns the same request into a chat prompt for you.

## The question

Every decision is one **choice** question named `move` with three options, always these keys:

| Key | Meaning |
|---|---|
| `up` | move the paddle up (y gets smaller) |
| `down` | move the paddle down (y gets larger) |
| `stay` | keep the paddle where it is |

The court is 160 wide and 100 tall, **y = 0 is the top edge** and y grows downward. The model plays the right paddle
(at x = 156, 20 tall). `interceptY` is where the ball will cross the paddle's line after any wall bounces, or `null`
when the ball is moving away.

## The rule (how answers are scored)

```
if interceptY is null:                 stay
if |interceptY - paddle.y| <= 5:       stay      (the paddle already covers it; 5 is the "stay tolerance")
if interceptY < paddle.y - 5:          up
if interceptY > paddle.y + 5:          down
```

The rule only scores answers. Nothing in PongBench ever plays it for the model: the paddle moves only on the model's
own answers.

## The request (System One)

`POST <your endpoint>` with `Content-Type: application/json`:

```json
{
  "model": "jev-latest",
  "state": {
    "court": { "w": 160, "h": 100 },
    "ball": { "x": 61, "y": 12.1, "vx": 19, "vy": 0 },
    "paddle": { "y": 26, "h": 20 },
    "interceptY": 12.1,
    "dir": "toward"
  },
  "questions": {
    "move": {
      "type": "choice",
      "instructions": "You control the right paddle in a game of Pong. The state is a JSON object of numbers: the court size, the ball position and velocity, your paddle (paddle.y is its CENTRE, paddle.h its height), interceptY, and dir. y = 0 is the top edge and y grows downward, so \"up\" DECREASES y and \"down\" INCREASES y. interceptY is the y value where the ball will cross your paddle plane after any wall bounces; it is null when the ball is moving away from you. Move so that paddle.y covers interceptY. Treat the paddle as already covering it when paddle.y is within 5 units of interceptY. Answer with one move only.",
      "criteria": {
        "up": "interceptY is more than 5 units above paddle.y (interceptY < paddle.y - 5). Moving up decreases paddle.y.",
        "down": "interceptY is more than 5 units below paddle.y (interceptY > paddle.y + 5). Moving down increases paddle.y.",
        "stay": "interceptY is null, or paddle.y is already within 5 units of interceptY."
      }
    }
  }
}
```

This is the **standard** track (decisio's own prompt, word for word). `model` is sent only when the config sets one.
The question name `move` is the caller's key: your model never needs to read it.

## The answer

```json
{
  "answers": {
    "move": {
      "type": "choice",
      "choice": "up",
      "probabilities": { "up": 0.93, "down": 0.02, "stay": 0.05 },
      "confidence": 0.93
    }
  },
  "usage": { "input_tokens": 312, "output_tokens": 0 }
}
```

| Field | Required | Notes |
|---|---|---|
| `answers.move.choice` | yes (or `probabilities`) | one of `up`, `down`, `stay` |
| `answers.move.probabilities` | recommended | numbers per key; PongBench normalises them. Without them the answer counts as one-hot and calibration is not measured |
| `answers.move.confidence` | no | ignored (PongBench computes it from the probabilities) |
| `usage.input_tokens` | no | shown in the app and the scorecard when present |
| anything else | no | ignored; a top-level `server_ms` is read as the model's own time |

PongBench also accepts the Cloudflare Workers AI envelope (`{"result": {"answers": ...}}`) and, when the answer key is
not `move`, the first answer.

## Errors and retries

| Status | What PongBench does |
|---|---|
| 2xx | uses the answer |
| 408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529 | retries up to 4 times: 0.5 s, 1 s, 2 s, 4 s (with jitter), or the `Retry-After` header |
| other 4xx (401, 404, 422, ...) | fails at once: the config or the request is wrong |
| no answer within `timeoutMs` (60 s for System One, 120 s for chat) | retried as above |

In a run, a decision that still fails is recorded as an error and **scored as wrong** (Decisions) or played as `stay`
(Rally, Arena). Every scorecard reports its error count.

## The tracks (what the state and instructions are)

The same 900 decision states are asked in four ways. The state fields per track, for the example above:

| Track | State sent |
|---|---|
| `standard` | `{"court":{"w":160,"h":100},"ball":{"x":61,"y":12.1,"vx":19,"vy":0},"paddle":{"y":26,"h":20},"interceptY":12.1,"dir":"toward"}` |
| `compact` | `{"paddle":{"y":26},"interceptY":12.1,"dir":"toward"}` |
| `minimal` | `{"paddle":{"y":26},"interceptY":12.1}` |
| `reasoning` | `{"court":{"w":160,"h":100},"ball":{"x":61,"y":12.1,"vx":19,"vy":0},"paddle":{"x":156,"y":26,"h":20}}` (no interceptY: the model must work out the bounce) |

Every track's instructions and criteria are in [`src/game/prompts.js`](../src/game/prompts.js) and in
[PROMPTS.md](PROMPTS.md). Numbers have one decimal. Velocities are per step, where 19 is a served ball's speed along x.

## Chat models (OpenAI-compatible and Anthropic connectors)

Chat models get one system message and one user message (the layout of decisio's gateway):

```
system: You make one decision about the state given. Answer with the key of exactly one option, and nothing else.

user:   State:
        {"paddle":{"y":26},"interceptY":12.1,"dir":"toward"}

        Question: Pong: you move the right paddle. y = 0 is the top edge and y grows downward. interceptY is where the
        ball will reach your paddle (null when the ball moves away). Compare interceptY with paddle.y and answer with
        one move (within 5 units counts as covered).
        Options:
        - up: interceptY < paddle.y - 5: the ball will arrive above the paddle.
        - down: interceptY > paddle.y + 5: the ball will arrive below the paddle.
        - stay: interceptY is null, or within 5 units of paddle.y.

        Answer with one of: up, down, stay.
```

The answer is read in one of three ways (the config's `answer`):

| Mode | Request | Probabilities |
|---|---|---|
| `logprobs` | `max_tokens` 4, `temperature` 0, `logprobs: true`, `top_logprobs: 10` | the first answer token's alternatives, matched to the three keys (`" up"`, `"Up"` and `"up"` all count for `up`) and normalised |
| `json` | `response_format` = strict JSON schema `{"move": enum[up, down, stay]}` | one-hot |
| `text` | plain | one-hot on the first key in the reply |
| `auto` (default) | `logprobs`, switching to `text` by itself when the server rejects or ignores logprobs | as above |

The Anthropic connector uses structured output (`output_config.format`) with the same enum; one-hot.

## Timing

Decisions and Rally are **speed-independent**: a model that answers in 2 s and one that answers in 2 ms get the same
score for the same answers. Arena is real time: the ball runs on a clock and the model's latency is its reaction time.
PongBench measures the round trip of every call (and reads `server_ms` when an endpoint reports its own time).
