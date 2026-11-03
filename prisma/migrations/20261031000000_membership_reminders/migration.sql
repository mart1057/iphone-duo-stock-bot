CREATE TABLE "membership_reminders" (
    "chat_id" TEXT NOT NULL,
    "expires_on" DATE NOT NULL,
    "lease_until" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    CONSTRAINT "membership_reminders_pkey" PRIMARY KEY ("chat_id", "expires_on")
);
