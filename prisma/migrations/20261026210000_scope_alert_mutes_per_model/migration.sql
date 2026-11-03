-- Color / storage mutes become per model ("iPhone Duo::2TB") so the same
-- storage can be on for one model and off for another. Existing unscoped
-- rows are copied to every model known today, then removed. Models added
-- later start with everything switched on.
INSERT INTO "telegram_alert_mutes" ("id", "chat_id", "kind", "value", "created_at")
SELECT gen_random_uuid()::text, m."chat_id", m."kind", p."model" || '::' || m."value", m."created_at"
FROM "telegram_alert_mutes" m
CROSS JOIN "products" p
WHERE m."kind" IN ('color', 'storage') AND position('::' IN m."value") = 0
ON CONFLICT ("chat_id", "kind", "value") DO NOTHING;

DELETE FROM "telegram_alert_mutes"
WHERE "kind" IN ('color', 'storage') AND position('::' IN "value") = 0;
