import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../services/api';

const SettingsContext = createContext(null);

export const SettingsProvider = ({ children }) => {
  const [logoParts, setLogoParts] = useState({ part1: 'FRANZ', part2: 'PLAY' });
  const [defaultTheme, setDefaultTheme] = useState(() => localStorage.getItem('franz_default_theme') || '#dc2626');
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const fetchSettings = async () => {
    try {
      // 1. Controllo Stato Sistema (Setup Wizard)
      const statusRes = await apiRequest('/status.php', 'GET');
      if (statusRes?.success && statusRes?.needsSetup) {
        setNeedsSetup(true);
        // Se ha bisogno del setup, non carichiamo le impostazioni perché
        // non ce ne sono, usiamo i valori di default dello state.
        return;
      }

      // 2. Fetch Impostazioni normali
      const res = await apiRequest('/impostazioni.php', 'GET');
      if (res?.success) {
        const data = res.data || res.dati || {};
        const dTheme = data.colore_tema_default || '#dc2626';
        setLogoParts({
          part1: data.logo_part_1 || 'FRANZ',
          part2: data.logo_part_2 || 'PLAY'
        });
        setDefaultTheme(dTheme);
        localStorage.setItem('franz_default_theme', dTheme);

        // Se l'utente non è loggato (o non ha forzato un tema) spingiamo questo come fallback globale
        if (!localStorage.getItem('franz_theme')) {
          document.documentElement.style.setProperty('--primary-color', dTheme);
        }
      }
    } catch (e) {
      console.error("Errore fetch impostazioni:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <SettingsContext.Provider value={{ logoParts, defaultTheme, fetchSettings, loading, needsSetup }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
