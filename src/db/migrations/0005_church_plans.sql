CREATE TABLE "church_plans" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church_plans" ADD CONSTRAINT "church_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;