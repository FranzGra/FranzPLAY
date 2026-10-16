import { type ComponentType, lazy } from "react";

// Pages are loaded only when someone opens them: the first visit downloads
// just the home page and the frame around it, so FranzPLAY starts faster on a
// phone or away from home. Each loader can also be called early (preload) to
// fetch a page's code before the click, for example while the mouse rests on
// a video.

// page makes a lazy page from a loader, and keeps the loader to preload it.
// biome-ignore lint/suspicious/noExplicitAny: pages take different props.
function page<C extends ComponentType<any>>(load: () => Promise<C>) {
  let started: Promise<C> | null = null;
  const preload = () => {
    started ??= load().catch((err: unknown) => {
      // A failed preload must not stop a later real try.
      started = null;
      throw err;
    });
    return started;
  };
  const Component = lazy(() => preload().then((c) => ({ default: c })));
  return Object.assign(Component, { preload });
}

export const AdminVideoPage = page(() =>
  import("../features/admin/AdminVideoPage").then((m) => m.AdminVideoPage),
);
export const VideoPage = page(() => import("../features/video/VideoPage").then((m) => m.VideoPage));
export const PublicVideoPage = page(() =>
  import("../features/public/PublicVideoPage").then((m) => m.PublicVideoPage),
);
export const PlaylistsPage = page(() =>
  import("../features/playlists/PlaylistsPage").then((m) => m.PlaylistsPage),
);
export const PlaylistPage = page(() =>
  import("../features/playlists/PlaylistPage").then((m) => m.PlaylistPage),
);
export const ProfilePage = page(() =>
  import("../features/profile/ProfilePage").then((m) => m.ProfilePage),
);
export const UploadPage = page(() =>
  import("../features/upload/UploadPage").then((m) => m.UploadPage),
);
export const ChannelPage = page(() =>
  import("../features/channel/ChannelPage").then((m) => m.ChannelPage),
);
export const SearchPage = page(() =>
  import("../features/search/SearchPage").then((m) => m.SearchPage),
);
export const HistoryPage = page(() =>
  import("../features/history/HistoryPage").then((m) => m.HistoryPage),
);
export const LikedPage = page(() => import("../features/likes/LikedPage").then((m) => m.LikedPage));
export const SharedPage = page(() =>
  import("../features/sharing/SharedPage").then((m) => m.SharedPage),
);
export const CategoriesPage = page(() =>
  import("../features/categories/CategoriesPage").then((m) => m.CategoriesPage),
);
export const CategoryPage = page(() =>
  import("../features/categories/CategoryPage").then((m) => m.CategoryPage),
);
export const AdminPage = page(() => import("../features/admin/AdminPage").then((m) => m.AdminPage));
export const OverviewPage = page(() =>
  import("../features/admin/OverviewPage").then((m) => m.OverviewPage),
);
export const PeoplePage = page(() =>
  import("../features/admin/PeoplePage").then((m) => m.PeoplePage),
);
export const InvitesPage = page(() =>
  import("../features/admin/InvitesPage").then((m) => m.InvitesPage),
);
export const AccessPage = page(() =>
  import("../features/admin/AccessPage").then((m) => m.AccessPage),
);
export const VideosPage = page(() =>
  import("../features/admin/VideosPage").then((m) => m.VideosPage),
);
export const CategoriesAdminPage = page(() =>
  import("../features/admin/CategoriesAdminPage").then((m) => m.CategoriesAdminPage),
);
export const SubtitlesPage = page(() =>
  import("../features/admin/SubtitlesPage").then((m) => m.SubtitlesPage),
);
export const CommentsPage = page(() =>
  import("../features/admin/CommentsPage").then((m) => m.CommentsPage),
);
export const FoldersPage = page(() =>
  import("../features/admin/FoldersPage").then((m) => m.FoldersPage),
);
export const OnlinePage = page(() =>
  import("../features/admin/OnlinePage").then((m) => m.OnlinePage),
);
export const JobsPage = page(() => import("../features/admin/JobsPage").then((m) => m.JobsPage));
export const SitePage = page(() => import("../features/admin/SitePage").then((m) => m.SitePage));
export const ChooseMethodPage = page(() =>
  import("../features/auth/ChooseMethodPage").then((m) => m.ChooseMethodPage),
);
export const AuthPage = page(() => import("../features/auth/AuthPage").then((m) => m.AuthPage));
export const JoinPage = page(() => import("../features/auth/JoinPage").then((m) => m.JoinPage));

// preloadLikelyPages fetches, when the browser has nothing else to do, the
// code of the pages opened most often after the home page.
export function preloadLikelyPages(): undefined {
  const run = () => {
    for (const p of [VideoPage, CategoriesPage, CategoryPage, PlaylistsPage]) {
      p.preload().catch(() => {});
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 2000);
  }
}
