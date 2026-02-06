#!/bin/bash

echo "🔹 [Frontend Init] Avvio procedura..."

# --- 1. SCAFFOLDING PROGETTO (Se vuoto) ---
if [ ! -f "package.json" ]; then
    echo "⚠️  Nessun progetto trovato. Creazione nuovo progetto Vite+React..."
    npm create vite@latest temp-app -- --template react --yes
    cp -r temp-app/. .
    rm -rf temp-app
    echo "✅ Progetto base creato."
fi

# --- 2. GESTIONE DIPENDENZE BASE ---
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules mancante. Installazione dipendenze base..."
    npm install
else
    echo "📦 node_modules presente."
fi

# --- 3. GESTIONE ADDONS DINAMICI ---
if [ -f "addons.txt" ]; then
    echo "🔍 Trovato addons.txt. Pulizia e lettura..."
    
    # Pulisce i caratteri invisibili di Windows (\r)
    PACKAGES=$(tr -d '\r' < addons.txt | grep -v '^\s*$' | xargs)
    
    if [ ! -z "$PACKAGES" ]; then
        echo "➕ Installazione pacchetti: $PACKAGES"
        npm install $PACKAGES --save
        
        # --- CONFIGURAZIONE TAILWIND v4 (Vite Plugin) ---
        if [[ "$PACKAGES" == *"tailwindcss"* ]]; then
            echo "🎨 Rilevato Tailwind v4. Configurazione plugin Vite..."

            # 1. CONFIGURAZIONE VITE.CONFIG.JS
            # Nella v4 dobbiamo aggiungere il plugin in vite.config.js.
            # AGGIUNTA QUI LA CONFIGURAZIONE SERVER PER HOSTS
            cat > vite.config.js <<EOF
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true, // Permette qualsiasi dominio/IP (es. video.franzpage.it)
    strictPort: true,
    port: 5173
  }
})
EOF
            echo "✅ vite.config.js aggiornato con il plugin Tailwind e permessi Host."

            # 2. CONFIGURAZIONE CSS
            # Nella v4 basta un solo import.
            CSS_FILE="./src/index.css"
            if [ -f "$CSS_FILE" ]; then
                EXISTING_CSS=$(cat "$CSS_FILE")
                # Controlla se l'import esiste già
                if [[ "$EXISTING_CSS" != *"@import \"tailwindcss\";"* ]]; then
                    echo "🎨 Aggiornamento $CSS_FILE..."
                    # Sovrascrive mettendo l'import in cima
                    echo "@import \"tailwindcss\";" > "$CSS_FILE"
                    echo "" >> "$CSS_FILE"
                    echo "$EXISTING_CSS" >> "$CSS_FILE"
                    echo "✅ CSS configurato."
                fi
            fi

            # 3. PULIZIA VECCHI FILE (Se presenti da vecchi tentativi)
            rm -f tailwind.config.js postcss.config.js
        fi
    fi
fi

# --- 4. CONTROLLO E AVVIO ---
if [ ! -f "./node_modules/.bin/vite" ]; then
    echo "⚠️  Vite non trovato. Riparazione..."
    npm install
fi

echo "🚀 Avvio Server Vite..."
# L'host è già configurato nel file js, ma lo lasciamo anche qui per sicurezza
exec npm run dev -- --host 0.0.0.0