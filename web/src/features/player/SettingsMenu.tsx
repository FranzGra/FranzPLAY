import { useState } from "react";
import { Icon } from "../../components/Icon";
import { speedLabel, speeds } from "./controls";
import styles from "./Player.module.css";

type SettingsMenuProps = {
  speed: number;
  onSpeed: (speed: number) => void;
  onClose: () => void;
};

type Page = "main" | "speed";

// SettingsMenu is the panel opened by the gear button. Each setting has its
// own page, as on YouTube, so the panel stays small on phones.
export function SettingsMenu({ speed, onSpeed, onClose }: SettingsMenuProps) {
  const [page, setPage] = useState<Page>("main");

  return (
    <div
      className={`glass ${styles.menu}`}
      role="dialog"
      aria-label="Impostazioni del video"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {page === "main" && (
        <button type="button" className={styles.menuRow} onClick={() => setPage("speed")}>
          <span>Velocità</span>
          <span className={styles.menuValue}>
            {speedLabel(speed)}
            <Icon name="chevronRight" size={16} />
          </span>
        </button>
      )}
      {page === "speed" && (
        <>
          <button type="button" className={styles.menuBack} onClick={() => setPage("main")}>
            <Icon name="chevronLeft" size={16} />
            Velocità
          </button>
          <ul className={styles.menuList} aria-label="Velocità">
            {speeds.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={s === speed}
                  className={styles.menuRow}
                  onClick={() => {
                    onSpeed(s);
                    onClose();
                  }}
                >
                  <span className={styles.menuCheck}>
                    {s === speed && <Icon name="check" size={16} />}
                  </span>
                  <span className={styles.menuLabel}>{speedLabel(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
