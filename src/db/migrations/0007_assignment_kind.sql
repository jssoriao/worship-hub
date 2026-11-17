ALTER TABLE "service_items" DROP CONSTRAINT "service_items_kind_check";--> statement-breakpoint
UPDATE "service_items" SET "kind" = 'assignment' WHERE "kind" = 'position';--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_kind_check" CHECK ("service_items"."kind" in ('song', 'item', 'header', 'assignment'));
