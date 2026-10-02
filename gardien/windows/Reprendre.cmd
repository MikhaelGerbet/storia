@echo off
chcp 65001 >nul
rem Reprise : la carte graphique est de nouveau partagée.
curl -s -f -X POST http://127.0.0.1:7870/api/reprise -H "content-type: application/json" -d "{}" >nul
if errorlevel 1 (echo Le gardien ne répond pas : est-il lancé ?) else (echo Reprise : la carte graphique est de nouveau partagée.)
timeout /t 3 >nul
