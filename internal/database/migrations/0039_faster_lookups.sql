-- Indexes that keep FranzPLAY quick with tens of thousands of videos.
--
-- Deleting a video also deletes its rows in other tables. Without an index
-- on the link, SQLite reads the whole other table for every video deleted:
-- forgetting 1,500 missing videos took 6 seconds instead of 0.3.
CREATE INDEX watch_progress_video ON watch_progress (video_id);
CREATE INDEX subtitle_requests_video ON subtitle_requests (video_id);
CREATE INDEX online_proposals_video ON online_proposals (video_id);
-- Replies of a comment: counted in the administration, deleted with it.
CREATE INDEX comments_parent ON comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_user ON comments (user_id);

-- The videos people see, with their category. Home, search and the
-- categories count them on every visit: this small index answers without
-- reading the whole videos table, descriptions included.
CREATE INDEX videos_shown ON videos (category) WHERE visible;
