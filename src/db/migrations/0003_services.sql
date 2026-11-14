CREATE TABLE "service_items" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'song' NOT NULL,
	"song_id" text,
	"title" text NOT NULL,
	"music_key" text,
	"notes" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "service_items_kind_check" CHECK ("service_items"."kind" in ('song', 'item', 'header'))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"title" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_organization_id_date_time_key" UNIQUE NULLS NOT DISTINCT("organization_id","date","time")
);
--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_items_service_id_position_idx" ON "service_items" USING btree ("service_id","position");