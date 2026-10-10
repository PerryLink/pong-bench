#!/bin/sh
# macOS: double-click in Finder to start PongBench (a Terminal window opens; close it to stop).
cd "$(dirname "$0")" && exec sh ./start-pongbench.sh "$@"
