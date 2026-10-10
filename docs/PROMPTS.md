# Prompts and tracks

A **prompt** is plain data: instructions and the meaning of each answer (with `{tol}` where the stay tolerance goes), an
optional context line, which state fields the model gets, and the number precision. The benchmark asks every model the
same 900 states through one of four built-in prompts, the **tracks**; the app's Prompt lab edits any of them.

## The tracks, word for word

### `standard`

Decisio's own Pong prompt and state, word for word: the official track (comparable with the original demo). State fields: `court`, `ballPos`, `ballVel`, `paddleH`, `intercept`, `dir`, plus `paddle.y`.

```text
instructions:
You control the right paddle in a game of Pong. The state is a JSON object of numbers: the court size, the ball position and velocity, your paddle (paddle.y is its CENTRE, paddle.h its height), interceptY, and dir. y = 0 is the top edge and y grows downward, so "up" DECREASES y and "down" INCREASES y. interceptY is the y value where the ball will cross your paddle plane after any wall bounces; it is null when the ball is moving away from you. Move so that paddle.y covers interceptY. Treat the paddle as already covering it when paddle.y is within 5 units of interceptY. Answer with one move only.

up: interceptY is more than 5 units above paddle.y (interceptY < paddle.y - 5). Moving up decreases paddle.y.
down: interceptY is more than 5 units below paddle.y (interceptY > paddle.y + 5). Moving down increases paddle.y.
stay: interceptY is null, or paddle.y is already within 5 units of interceptY.
```

### `compact`

The same rule in about half the words, and only the fields the rule needs. State fields: `intercept`, `dir`, plus `paddle.y`.

```text
instructions:
Pong: you move the right paddle. y = 0 is the top edge and y grows downward. interceptY is where the ball will reach your paddle (null when the ball moves away). Compare interceptY with paddle.y and answer with one move (within 5 units counts as covered).

up: interceptY < paddle.y - 5: the ball will arrive above the paddle.
down: interceptY > paddle.y + 5: the ball will arrive below the paddle.
stay: interceptY is null, or within 5 units of paddle.y.
```

### `minimal`

One line of instructions and bare comparisons: how much does the model need to be told?. State fields: `intercept`, plus `paddle.y`.

```text
instructions:
Right Pong paddle. y grows downward.

up: interceptY < paddle.y - 5
down: interceptY > paddle.y + 5
stay: otherwise, or interceptY is null
```

### `reasoning`

No interceptY: the model gets the ball's position and velocity and must work out the bounce itself. State fields: `court`, `ballPos`, `ballVel`, `paddleX`, `paddleH`, plus `paddle.y`.

```text
instructions:
You control the right paddle in a game of Pong. The court is court.w wide and court.h tall; y = 0 is the top edge and y grows downward, so "up" DECREASES y and "down" INCREASES y. The ball moves by (ball.vx, ball.vy) each step and bounces off the top and bottom edges. Your paddle (paddle.y is its centre) sits at x = paddle.x. When ball.vx > 0 the ball is coming to you: work out the y where it will reach x = paddle.x and move so that paddle.y is within 5 units of it. When ball.vx < 0 the ball is moving away. Answer with one move only.

up: The ball is coming and will reach your paddle more than 5 units above paddle.y.
down: The ball is coming and will reach your paddle more than 5 units below paddle.y.
stay: The ball is moving away, or it will reach your paddle within 5 units of paddle.y.
```

| Field | Sent as |
|---|---|
| `court` (Court size) | court.w, court.h |
| `ballPos` (Ball position) | ball.x, ball.y |
| `ballVel` (Ball velocity) | ball.vx, ball.vy |
| `paddleX` (Paddle x) | paddle.x (156: the right paddle's plane) |
| `paddleH` (Paddle height) | paddle.h |
| `intercept` (interceptY) | where the ball will reach the paddle (null when moving away) |
| `offset` (Offset) | offset = interceptY - paddle.y (null when moving away) |
| `window` (Stay window) | window.from / window.to = paddle.y - / + the tolerance |
| `dir` (Direction) | dir: "toward" or "away" |

## A custom prompt

The Prompt lab saves prompts in this shape, and the command line takes the same file:

```json
{
  "name": "My prompt",
  "instructions": "Pong: you move the right paddle. y = 0 is the top edge and y grows downward. ...",
  "criteria": {
    "up": "interceptY < paddle.y - {tol}: the ball will arrive above the paddle.",
    "down": "interceptY > paddle.y + {tol}: the ball will arrive below the paddle.",
    "stay": "interceptY is null, or within {tol} units of paddle.y."
  },
  "context": "",
  "fields": ["intercept", "dir"],
  "decimals": 1
}
```

```bash
node bin/pongbench.js run --config <name> --prompt my-prompt.json
```

The result is recorded as track `custom` with the full prompt in its scorecard: it is not comparable with the
official track, but it shows exactly what a prompt change does. Optional: `"order": ["stay", "up", "down"]` changes the
order the options are listed in (a test for position bias), and `"decimals": 0` sends whole numbers.

## Tuning a prompt in the app

1. **Prompt lab** tab: start from a track, edit the instructions, what each answer means, the context and the fields.
   The right side shows the exact request.
2. **Run 300 states**: the same 300 states as a quick benchmark run (a third of each kind). The result table keeps
   every check, so versions can be compared side by side; it shows per-move accuracy, endpoint time and the input
   tokens the endpoint counted.
3. **Apply to the game** to play with it, **Save as preset** to keep it, and in the **Bench** tab choose the track
   "The game's prompt" to run the full benchmark with it.

What usually matters, from tuning on real games: spelling out that `up` makes `paddle.y` smaller helps models that
confuse the direction; worked examples near the threshold help the 5 to 8 unit band; giving the model a pre-computed
window or a signed offset can backfire (one model read every negative offset as "up"); fewer words are faster but
often less accurate. Measure, do not guess: that is what the check is for.
