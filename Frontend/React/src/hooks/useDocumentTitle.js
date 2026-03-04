import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

/**
 * Custom hook per aggiornare il titolo della pagina (document.title)
 * usando dinamicamente il logo salvato nelle impostazioni globali.
 *
 * @param {string} title - Il titolo specifico della pagina (es. "Home", "Player")
 */
export const useDocumentTitle = (title) => {
    const { logoParts } = useSettings();

    useEffect(() => {
        const siteName = `${logoParts.part1} ${logoParts.part2}`.trim();
        if (title) {
            document.title = `${title} | ${siteName}`;
        } else {
            document.title = siteName;
        }
    }, [title, logoParts]);
};
