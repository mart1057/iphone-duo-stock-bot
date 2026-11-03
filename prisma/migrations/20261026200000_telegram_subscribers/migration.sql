-- CreateTable
CREATE TABLE "telegram_subscribers" (
    "chat_id" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_subscribers_pkey" PRIMARY KEY ("chat_id")
);
