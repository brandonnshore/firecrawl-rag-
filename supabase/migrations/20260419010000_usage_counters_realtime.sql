-- M3F5 usage-meter-ui — enable Supabase Realtime on usage_counters so the
-- UsageMeterSet client component can subscribe to UPDATE events and reflect
-- chat / crawl activity live on the dashboard without a page refresh.

alter publication supabase_realtime add table usage_counters;
