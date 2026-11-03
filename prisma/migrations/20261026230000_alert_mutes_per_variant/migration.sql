-- The /alerts menu now switches each exact variant (model + color + storage)
-- on or off. Rewrite every older setting - a whole model, or a color / size of
-- a model (scoped "Model::Value" or unscoped "Value") - as the variants it
-- covered, so every chat keeps receiving exactly what it received before.
INSERT INTO "telegram_alert_mutes" ("id", "chat_id", "kind", "value", "created_at")
SELECT gen_random_uuid()::text, m."chat_id", 'variant',
       p."model" || '::' || v."color" || '::' || v."storage", MIN(m."created_at")
FROM "telegram_alert_mutes" m
JOIN "product_variants" v ON TRUE
JOIN "products" p ON p."id" = v."product_id"
WHERE (m."kind" = 'model'   AND m."value" = p."model")
   OR (m."kind" = 'color'   AND m."value" IN (v."color",   p."model" || '::' || v."color"))
   OR (m."kind" = 'storage' AND m."value" IN (v."storage", p."model" || '::' || v."storage"))
GROUP BY m."chat_id", p."model", v."color", v."storage"
ON CONFLICT ("chat_id", "kind", "value") DO NOTHING;

DELETE FROM "telegram_alert_mutes" WHERE "kind" IN ('model', 'color', 'storage');
