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
    // Salviamo in localStorage per evitare flash o perdite cache
    localStorage.setItem('franz_theme', color);
  };

  // --- HELPER: FORMATTAZIONE DATI ---
  const formatUser = (userData) => {
    if (!userData) return null;

    return {
      username: userData.username || "Utente",
      avatar: userData.avatar
        ? (userData.avatar.startsWith('http') || userData.avatar.startsWith('/') ? userData.avatar : `/img_utenti/${userData.avatar}`)
        : null,
      isAdmin: Boolean(userData.isAdmin),
      themeColor: userData.themeColor || null,
      appDefaultThemeColor: userData.appDefaultThemeColor || null,
      homePreferences: userData.homePreferences || {}
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

      if (data && data.success) {
        const formattedUser = formatUser(data.user);
        setUser(formattedUser);

        // 🛠️ FIX: Applica il colore dell'utente, non uno statico
        if (formattedUser.themeColor) {
          applyTheme(formattedUser.themeColor);
        } else if (formattedUser.appDefaultThemeColor) {
          applyTheme(formattedUser.appDefaultThemeColor);
        } else {
          // Usa il tema default se l'utente non ne ha uno
          applyTheme(localStorage.getItem('franz_default_theme') || '#dc2626');
        }
      } else {
        setUser(null);
        applyTheme(localStorage.getItem('franz_default_theme') || '#dc2626'); // Reset al globale default se non loggato
      }
    } catch (error) {
      setUser(null);
      applyTheme(localStorage.getItem('franz_default_theme') || '#dc2626');
    } finally {
      setLoading(false);
    }
  };

  // --- 2. LOGIN ---
  const login = async (username, password) => {
    try {
      const data = await apiRequest('/login.php', 'POST', { username, password }, false);

      if (data.success) {
        const formattedUser = formatUser(data.user);
        setUser(formattedUser);
        // Applica subito il tema appena ricevuto dal login
        applyTheme(formattedUser.themeColor);
        return { success: true };
      } else {
        return { success: false, message: data.message || "Errore Login" };
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
      localStorage.removeItem('franz_theme');
      applyTheme(localStorage.getItem('franz_default_theme') || '#dc2626'); // Reset al tema globale
    } catch (error) {
      console.error("Errore Logout:", error);
    }
  };

  // Funzione per aggiornare il tema localmente (es. dal Color Picker del profilo)
  const updateLocalTheme = (newColor) => {
    if (user) {
      setUser({ ...user, themeColor: newColor || null }); // Aggiorna lo stato React
      if (newColor) {
        applyTheme(newColor); // Aggiorna il CSS
      } else {
        applyTheme(user.appDefaultThemeColor || localStorage.getItem('franz_default_theme') || '#dc2626'); // Usa default app se resettato
      }
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