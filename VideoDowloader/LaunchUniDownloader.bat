@echo off
title UniDownloader Backend
cd /d "%~dp0backend"
:: Start Node.js server in the background
start /b node server.js
:: Wait 2 seconds for server setup and initialization
timeout /t 2 /nobreak >nul
:: Open Chrome in standalone App Mode with a neat mobile-like desktop window size
start chrome.exe --app=http://localhost:4000 --window-size=440,730
exit
