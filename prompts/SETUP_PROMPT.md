# A prompt for your coding agent

Copy this into Claude Code, Codex, Cursor or any coding agent, with the two placeholders filled in:

```text
Set up PongBench for my model and benchmark it.

Repository: <path to this folder, or its git URL>
My model:   <how to reach it, for example:
             "Jev on TypeSafe, key in TYPESAFE_API_KEY" /
             "Qwen3-8B on my vLLM server at http://localhost:8000/v1" /
             "the open-weight model at ./models/my-model, nothing is serving it yet" /
             "Claude Haiku 5.5" /
             "my Python function decide(state) in ./bot.py">

Read AGENTS.md in the repository and follow it step by step: write a config for my model (never put my key in a file
other than .env), run the check until it shows four answers, do a quick run, tell me how many calls a full run makes
before starting it, then run the full benchmark on the standard track. Finish with the score, the per-move accuracy,
the rally rate and the weak spots from the scorecard, in plain words.
```

The agent will ask before anything that costs money or needs a key. It works the same on Windows, macOS and Linux:
the agent uses the commands for your system.
