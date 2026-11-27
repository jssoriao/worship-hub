ALTER TABLE "members" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
-- the last sign-in we can still see: the newest open session of each person
UPDATE "users" SET "last_sign_in_at" = s."at" FROM (SELECT "user_id", max("created_at") AS "at" FROM "sessions" GROUP BY "user_id") s WHERE s."user_id" = "users"."id";
