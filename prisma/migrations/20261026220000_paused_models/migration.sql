-- CreateTable
CREATE TABLE "paused_models" (
    "model" TEXT NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paused_models_pkey" PRIMARY KEY ("model")
);
