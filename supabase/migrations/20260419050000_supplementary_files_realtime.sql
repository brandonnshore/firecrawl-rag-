-- M5F6 knowledge-ui — enable Realtime on supplementary_files so the
-- dashboard UI reflects queued -> processing -> ready transitions live.

alter publication supabase_realtime add table supplementary_files;
