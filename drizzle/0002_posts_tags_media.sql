CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"old_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cover_image_key" text,
	"cover_image_alt" text,
	"seo_title" text,
	"seo_description" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_vector" "tsvector",
	CONSTRAINT "posts_slug_format" CHECK ("posts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "posts_status_valid" CHECK ("posts"."status" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_slug_redirects" ADD CONSTRAINT "post_slug_redirects_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_media_r2_key" ON "media" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_slug_redirects_old_slug" ON "post_slug_redirects" USING btree ("old_slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_posts_slug_active" ON "posts" USING btree ("slug") WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_status_published_at" ON "posts" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_deleted_at" ON "posts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_search_vector" ON "posts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_title_trgm" ON "posts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_name" ON "tags" USING btree ("name");--> statement-breakpoint
-- Drizzle's schema.ts can't express a trigger, so this is appended by hand
-- to the generated file before commit (spec/data-model: "updated_at ...
-- bumped by a BEFORE UPDATE trigger on every row change"). Scoped to
-- `posts` only; no other table currently needs it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS posts_set_updated_at ON "posts";
--> statement-breakpoint
CREATE TRIGGER posts_set_updated_at
BEFORE UPDATE ON "posts"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
