@echo off
chcp 65001 >nul
rem Mode jeu : la carte graphique est réservée au jeu.
curl -s -f -X POST http://127.0.0.1:7870/api/pause -H "content-type: application/json" -d "{}" >nul
if errorlevel 1 (echo Le gardien ne répond pas : est-il lancé ?) else (echo Mode jeu : la carte graphique est réservée au jeu.)
timeout /t 3 >nul
