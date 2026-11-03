-- CreateTable
CREATE TABLE "telegram_alert_mutes" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_alert_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telegram_alert_mutes_chat_id_idx" ON "telegram_alert_mutes"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_alert_mutes_chat_id_kind_value_key" ON "telegram_alert_mutes"("chat_id", "kind", "value");
