-- People who open the invite link now wait for an admin to approve them.
-- Everyone already subscribed stays approved (column default true).
ALTER TABLE "telegram_subscribers" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "telegram_subscribers" ADD COLUMN "approved_at" TIMESTAMP(3);
UPDATE "telegram_subscribers" SET "approved_at" = "joined_at" WHERE "approved_at" IS NULL;
