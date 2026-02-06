import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // --- FUNZIONE PER APPLICARE IL TEMA CSS ---
  const applyTheme = (color) => {
    if (!color) return;
    document.documentElement.style.setProperty('--primary-color', color);
    // Salviamo anche in localStorage per evitare flash bianchi al riavvio (opzionale ma consigliato)
    localStorage.setItem('franz_theme', color);
  };

  // --- HELPER: FORMATTAZIONE DATI ---
  const formatUser = (data) => {
    const userData = data.user || data.utente || data;
    if (!userData) return null;

    const rawUsername = userData.username || userData.Nome_Utente || userData.nome_utente;
    const rawAvatar = userData.avatar || userData.Immagine_Profilo || userData.immagine_profilo;
    const rawAdmin = userData.isAdmin || userData.Admin || userData.amministratore;
    // Recupera il colore dal DB o usa il default
    const rawTheme = userData.themeColor || userData.colore_theme || '#dc2626';
    // Recupera preferenze home
    const rawHomePrefs = userData.homePreferences || userData.preferenze_home || {};

    return {
      username: rawUsername || "Utente",
      avatar: rawAvatar
        ? (rawAvatar.startsWith('http') || rawAvatar.startsWith('/') ? rawAvatar : `/img_utenti/${rawAvatar}`)
        : null,
      isAdmin: Boolean(rawAdmin),
      themeColor: rawTheme,
      homePreferences: rawHomePrefs
    };
  };

  // --- 1. CONTROLLO SESSIONE ALL'AVVIO ---
  const checkAuth = async () => {
    try {
      // Carica eventuale tema salvato in cache locale per istantaneità
      const cachedTheme = localStorage.getItem('franz_theme');
      if (cachedTheme) applyTheme(cachedTheme);

      const formData = new FormData();
      formData.append('action', 'ottieni_info_utente');

      const data = await apiRequest('/profilo.php', 'POST', formData);

      if (data && data.successo) {
        const formattedUser = formatUser(data);
        setUser(formattedUser);

        // 🛠️ FIX: Applica il colore dell'utente, non uno statico
        if (formattedUser.themeColor) {
          applyTheme(formattedUser.themeColor);
        }
      } else {
        setUser(null);
        applyTheme('#dc2626'); // Reset al rosso default se non loggato
      }
    } catch (error) {
      setUser(null);
      applyTheme('#dc2626');
    } finally {
      setLoading(false);
    }
  };

  // --- 2. LOGIN ---
  const login = async (username, password) => {
    try {
      const data = await apiRequest('/login.php', 'POST', { username, password }, false);

      if (data.successo) {
        const formattedUser = formatUser(data);
        setUser(formattedUser);
        // Applica subito il tema appena ricevuto dal login
        applyTheme(formattedUser.themeColor);
        return { success: true };
      } else {
        return { success: false, message: data.messaggio || "Errore Login" };
      }
    } catch (error) {
      return { success: false, message: error.message || "Errore di connessione" };
    }
  };

  // --- 3. LOGOUT ---
  const logout = async () => {
    try {
      await apiRequest('/logout.php');
      setUser(null);
      applyTheme('#dc2626'); // Reset al tema base
      localStorage.removeItem('franz_theme');
    } catch (error) {
      console.error("Errore Logout:", error);
    }
  };

  // Funzione per aggiornare il tema localmente (es. dal Color Picker del profilo)
  const updateLocalTheme = (newColor) => {
    if (user) {
      setUser({ ...user, themeColor: newColor }); // Aggiorna lo stato React
      applyTheme(newColor); // Aggiorna il CSS
    }
  };

  // --- 4. AGGIORNA PREFERENZE HOME ---
  const updateHomePreferences = async (newPrefs) => {
    if (!user) return;

    // 1. Optimistic Update (UI istantanea)
    const updatedUser = { ...user, homePreferences: newPrefs };
    setUser(updatedUser);

    try {
      // 2. Sync con Backend
      const formData = new FormData();
      formData.append('action', 'salva_preferenze_home');
      formData.append('preferenze', JSON.stringify(newPrefs));
      await apiRequest('/profilo.php', 'POST', formData);
    } catch (e) {
      console.error("Errore salvataggio preferenze:", e);
      // In caso di errore, potremmo revertare, ma per ora teniamo l'optimistic
    }
  };

  const refreshUser = () => {
    checkAuth();
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, updateLocalTheme, updateHomePreferences, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);