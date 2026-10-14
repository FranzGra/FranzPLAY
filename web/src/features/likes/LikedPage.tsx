import { fetchLiked } from "../../api/likes";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { usePagedVideos } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./LikedPage.module.css";

// LikedPage lists the videos I like, the last liked first.
export function LikedPage() {
  usePageTitle("Mi piace");
  const { state, loadMore } = usePagedVideos(fetchLiked);
  return (
    <>
      <h1 className={styles.heading}>
        <Icon name="like" size={26} />
        Video che ti piacciono
      </h1>
      <VideoGrid
        state={state}
        onMore={loadMore}
        label="Video che ti piacciono"
        empty={{
          title: "Nessun video ti piace ancora",
          text: "Premi «Mi piace» sotto un video e lo ritroverai qui, dal più recente.",
        }}
      />
    </>
  );
}
