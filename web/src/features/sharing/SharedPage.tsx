import { useCallback, useEffect, useState } from "react";
import { fetchSharedPlaylists, type Playlist } from "../../api/playlists";
import { fetchVideos } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { PlaylistCard } from "../playlists/PlaylistCard";
import { type LoadPage, usePagedVideos } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./SharedPage.module.css";

// SharedPage lists what others shared only with some people, me among
// them: playlists first, then videos. They show up nowhere else.
export function SharedPage() {
  usePageTitle("Condivisi con te");
  const load = useCallback<LoadPage>(
    (page, signal) => fetchVideos({ shared: true, ...page }, signal),
    [],
  );
  const { state, loadMore } = usePagedVideos(load);
  const lists = useSharedPlaylists();
  return (
    <>
      <h1 className={styles.heading}>
        <Icon name="share" size={26} />
        Condivisi con te
      </h1>
      {lists.length > 0 && (
        <section className={styles.section} aria-label="Playlist condivise con te">
          <h2 className={styles.subheading}>Playlist</h2>
          <ul className={styles.lists}>
            {lists.map((list) => (
              <li key={list.id}>
                <PlaylistCard list={list} showOwner />
              </li>
            ))}
          </ul>
          <h2 className={styles.subheading}>Video</h2>
        </section>
      )}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label="Video condivisi con te"
        empty={
          lists.length > 0
            ? {
                title: "Nessun video condiviso con te",
                text: "Quando qualcuno ti farà vedere un suo video solo ad alcune persone, lo troverai qui.",
              }
            : {
                title: "Nessuno ti ha condiviso niente, per ora",
                text: "Quando qualcuno fa vedere un suo video o una sua playlist solo ad alcune persone, te compreso, li trovi qui.",
              }
        }
      />
    </>
  );
}

// useSharedPlaylists returns the playlists shared with me; none while
// they arrive or if the server does not answer, since the videos below
// still make sense on their own.
function useSharedPlaylists(): Playlist[] {
  const [lists, setLists] = useState<Playlist[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchSharedPlaylists(controller.signal)
      .then(setLists)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);
  return lists;
}
