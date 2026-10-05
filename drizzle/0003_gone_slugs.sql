CREATE TABLE IF NOT EXISTS "gone_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"post_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gone_slugs_reason_valid" CHECK ("gone_slugs"."reason" in ('deleted', 'purged'))
);
