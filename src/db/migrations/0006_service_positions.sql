ALTER TABLE "service_items" DROP CONSTRAINT "service_items_kind_check";--> statement-breakpoint
ALTER TABLE "service_items" ADD COLUMN "people" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_kind_check" CHECK ("service_items"."kind" in ('song', 'item', 'header', 'position'));