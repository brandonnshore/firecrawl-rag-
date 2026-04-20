-- 20260420010000_remove_free_trial_default
--
-- Product decision (2026-04-20): remove the 7-day no-card trial. New
-- signups must subscribe before using the widget — our OpenAI costs
-- can't be fronted for free-riders.
--
-- Mechanism:
--   - Drop the `now() + 7 days` default on profiles.trial_ends_at.
--   - Keep subscription_status default of 'trialing' (schema constraint
--     allows several values; no need to churn it).
--   - With trial_ends_at = NULL, the existing checkSubscription()
--     returns reason='trial_expired' which flips the widget to 402 and
--     the dashboard billing page to a "subscribe" CTA state. No
--     application code changes required.
--
-- Existing rows keep whatever trial_ends_at they already had. The 11
-- prod test profiles are disposable so this doesn't matter — real
-- paying users arrive after this migration deploys.

alter table profiles
  alter column trial_ends_at drop default;
