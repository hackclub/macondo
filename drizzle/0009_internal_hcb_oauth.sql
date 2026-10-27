CREATE TABLE "internal_oauth_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "token_type" text,
  "scope" text,
  "expires_at" timestamp,
  "connected_by_user_id" text,
  "external_user_id" text,
  "external_user_email" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "internal_oauth_connections_provider_unique" UNIQUE("provider")
);--> statement-breakpoint
ALTER TABLE "internal_oauth_connections" ADD CONSTRAINT "internal_oauth_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
