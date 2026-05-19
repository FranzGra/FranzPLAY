@echo off

:: Posizionati nella root del progetto (cartella padre di /scripts)
cd /d "%~dp0.."

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

:: NON creiamo manualmente Database_Data: in rootless Docker la directory
:: va creata dal container con l'uid corretto del processo mysql.
:: Lasciamo che sia docker compose up a crearla.

docker compose up -d

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