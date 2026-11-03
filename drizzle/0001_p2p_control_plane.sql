CREATE TABLE "admin_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidr" text NOT NULL,
	CONSTRAINT "admin_whitelist_cidr_unique" UNIQUE("cidr")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"buffer_seconds" integer DEFAULT 15 NOT NULL,
	"max_upload_kbps" integer DEFAULT 2048 NOT NULL,
	"max_connections_per_node" integer DEFAULT 4 NOT NULL,
	"max_peers_per_channel" integer DEFAULT 256 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_routes" (
	"channel" text PRIMARY KEY NOT NULL,
	"stream_id" integer NOT NULL,
	"server_id" uuid NOT NULL,
	"fallback_server_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xui_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_token" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stream_routes" ADD CONSTRAINT "stream_routes_server_id_xui_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."xui_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");