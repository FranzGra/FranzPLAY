@echo off

:: Verifica presenza file .env fondamentale per il db
if not exist ".env" (
    echo.
    echo [ERRORE] Il file .env non esiste in questa cartella!
    echo Per avviare FranzPLAY, per favore crea il file .env.
    echo Puoi copiare il file .env.example e rinominarlo in .env.
    echo.
    pause
    exit /b 1
)

if not exist "App_Data\Database_Data" (
    mkdir "App_Data\Database_Data"
)

docker-compose up -d

echo.
echo ==================================
echo ===== Elenco Container Docker ====
echo ==================================
echo.

docker ps

echo.
echo.
echo ===================================
echo.
echo ===== Container Docker AVVIATI ====
echo.
echo ===================================
echo.
echo.

pause