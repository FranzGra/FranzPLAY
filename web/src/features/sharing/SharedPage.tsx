import { useCallback } from "react";
import { fetchVideos } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { type LoadPage, usePagedVideos } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./SharedPage.module.css";

// SharedPage lists what someone shared only with some people, me among
// them: it shows up nowhere else.
export function SharedPage() {
  usePageTitle("Condivisi con te");
  const load = useCallback<LoadPage>(
    (page, signal) => fetchVideos({ shared: true, ...page }, signal),
    [],
  );
  const { state, loadMore } = usePagedVideos(load);
  return (
    <>
      <h1 className={styles.heading}>
        <Icon name="share" size={26} />
        Condivisi con te
      </h1>
      <VideoGrid
        state={state}
        onMore={loadMore}
        label="Video condivisi con te"
        empty={{
          title: "Nessuno ti ha condiviso niente, per ora",
          text: "Quando qualcuno carica un video e lo fa vedere solo ad alcune persone, te compreso, lo trovi qui.",
        }}
      />
    </>
  );
}
