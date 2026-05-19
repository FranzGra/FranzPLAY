@echo off

:: Posizionati nella root del progetto (cartella padre di /scripts)
cd /d "%~dp0.."

docker-compose down

echo.
echo.
echo ====================================
echo.
echo ===== Container Docker STOPPATI ====
echo.
echo ====================================
echo.
echo.

pause