@echo off
rem PongBench: starts the app at http://127.0.0.1:8800 and opens it. Close this window to stop.
rem   Start-PongBench.bat                  (the endpoint picked last time is not remembered: pick one in the Bench tab)
rem   Start-PongBench.bat typesafe-jev     (start with a config from configs\)
title PongBench
cd /d "%~dp0"
where node >nul 2>nul || (echo PongBench needs Node.js 18 or newer: https://nodejs.org & pause & exit /b 1)
set CFG=%1
if "%CFG%"=="" set CFG=mock-oracle
start "" http://127.0.0.1:8800/
node bin\pongbench.js serve --config %CFG%
if errorlevel 1 pause
