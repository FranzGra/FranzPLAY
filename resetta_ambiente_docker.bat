@echo off

echo.
echo ATTENZIONE: Questa un'operazione distruttiva!
echo Verranno cancellati tutti i container, i volumi e i file del database.
echo Il file .env e la cartella App_Data verranno ripristinati.
echo.
pause

docker-compose down --volumes
docker-compose rm -fsv

echo Rimozione file locali del database in corso (App_Data\Database_Data)...
if exist "App_Data\Database_Data" rmdir /S /Q "App_Data\Database_Data"

docker-compose build

if not exist "App_Data\Database_Data" (
    mkdir "App_Data\Database_Data"
)

docker-compose up -d
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