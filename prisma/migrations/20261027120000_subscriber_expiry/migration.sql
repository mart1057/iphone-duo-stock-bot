-- Admins pick an expiry date when approving a member. On that date the
-- member is removed and admins get a report. NULL = never expires.
ALTER TABLE "telegram_subscribers" ADD COLUMN "expires_on" DATE;
