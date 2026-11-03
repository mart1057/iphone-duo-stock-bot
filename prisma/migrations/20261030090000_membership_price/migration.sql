CREATE TABLE "membership_settings" (
    "id" TEXT NOT NULL,
    "price_satang" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_price_nonnegative" CHECK ("price_satang" >= 0)
);
