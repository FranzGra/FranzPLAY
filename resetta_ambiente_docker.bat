@echo off

docker-compose down --volumes
docker-compose build
docker-compose up -d

echo.
echo ==================================
echo ===== Elenco Container Docker ====
echo ==================================
echo.

docker ps

echo.
echo.
echo ============================================
echo.
echo ===== Applicazione Docker Inizializzata ====
echo.
echo ============================================
echo.
echo.

pause