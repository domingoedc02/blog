-- Custom migration (drizzle-kit generate --custom): enables the two
-- extensions every later migration/query depends on. Must run before
-- 0001_posts_tags_media, which uses gen_random_uuid() (pgcrypto) as a
-- column default and gin_trgm_ops (pg_trgm) in idx_posts_title_trgm.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
