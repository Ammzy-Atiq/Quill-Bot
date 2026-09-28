CREATE TABLE "config_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"source" varchar(16) NOT NULL,
	"path" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_counters" (
	"guild_id" varchar(20) NOT NULL,
	"key" varchar(32) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guild_counters_guild_id_key_pk" PRIMARY KEY("guild_id","key")
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(20),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"owner_id" varchar(20) NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"added_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credentials" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" text,
	"api_key_enc" text NOT NULL,
	"created_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"case_number" integer NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"moderator_id" varchar(20),
	"source" varchar(16) NOT NULL,
	"type" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points" real DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"name" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"term" varchar(200) NOT NULL,
	"match" varchar(16) NOT NULL,
	"severity" smallint DEFAULT 3 NOT NULL,
	"created_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_bans" (
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"reason" text,
	"moderator_id" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_bans_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "risk_scores" (
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"last_step_threshold" real DEFAULT 0 NOT NULL,
	"last_violation_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_scores_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "scam_domains" (
	"domain" varchar(253) PRIMARY KEY NOT NULL,
	"source" varchar(16) DEFAULT 'builtin' NOT NULL,
	"added_by" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scam_image_hashes" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" varchar(16) NOT NULL,
	"label" varchar(100) DEFAULT 'scam image' NOT NULL,
	"guild_id" varchar(20),
	"added_by" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_guild_id" varchar(20) NOT NULL,
	"target_guild_id" varchar(20) NOT NULL,
	"owner_id" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_states" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"reason" text,
	"triggered_by" varchar(20),
	"automatic" boolean DEFAULT false NOT NULL,
	"previous" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"incident_number" integer NOT NULL,
	"actor_id" varchar(20),
	"module" varchar(16) NOT NULL,
	"threat_level" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_pull_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_guild_id" varchar(20) NOT NULL,
	"target_guild_id" varchar(20) NOT NULL,
	"requested_by" varchar(20) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"incident_id" bigint,
	"module" varchar(16) NOT NULL,
	"action" varchar(48) NOT NULL,
	"actor_id" varchar(20),
	"target_id" varchar(20),
	"severity" smallint DEFAULT 1 NOT NULL,
	"trust" varchar(16),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"label" varchar(100),
	"created_by" varchar(20),
	"role_count" integer DEFAULT 0 NOT NULL,
	"channel_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fingerprints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"ip_prefix_hash" varchar(64) NOT NULL,
	"device_hash" varchar(64) NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asn" integer,
	"country" varchar(2),
	"is_proxy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_verifications" (
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"status" varchar(16) NOT NULL,
	"method" varchar(16) NOT NULL,
	"session_id" uuid,
	"reviewed_by" varchar(20),
	"backup_consent" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_verifications_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "identity_links" (
	"user_a" varchar(20) NOT NULL,
	"user_b" varchar(20) NOT NULL,
	"confidence" real NOT NULL,
	"signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_links_user_a_user_b_pk" PRIMARY KEY("user_a","user_b")
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"user_id" varchar(20) PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"verdict" varchar(8),
	"confidence" real,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backup_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_sessions_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "verified_identities" (
	"user_id" varchar(20) PRIMARY KEY NOT NULL,
	"first_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_count" integer DEFAULT 1 NOT NULL,
	"cluster_id" uuid,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "config_audit_guild_idx" ON "config_audit" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trust_entries_unique" ON "trust_entries" USING btree ("guild_id","user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_guild_number_unique" ON "cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "cases_guild_user_idx" ON "cases" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_policies_unique" ON "custom_policies" USING btree ("guild_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_words_unique" ON "custom_words" USING btree ("guild_id","term");--> statement-breakpoint
CREATE INDEX "guild_bans_user_idx" ON "guild_bans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scam_image_hash_idx" ON "scam_image_hashes" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_servers_unique" ON "backup_servers" USING btree ("source_guild_id","target_guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_guild_number_unique" ON "incidents" USING btree ("guild_id","incident_number");--> statement-breakpoint
CREATE INDEX "incidents_guild_idx" ON "incidents" USING btree ("guild_id","started_at");--> statement-breakpoint
CREATE INDEX "member_pull_jobs_source_idx" ON "member_pull_jobs" USING btree ("source_guild_id");--> statement-breakpoint
CREATE INDEX "security_events_guild_idx" ON "security_events" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "security_events_incident_idx" ON "security_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "snapshots_guild_idx" ON "snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "fingerprints_user_idx" ON "fingerprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fingerprints_ip_idx" ON "fingerprints" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "fingerprints_device_idx" ON "fingerprints" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "fingerprints_prefix_idx" ON "fingerprints" USING btree ("ip_prefix_hash");--> statement-breakpoint
CREATE INDEX "guild_verifications_user_idx" ON "guild_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_links_b_idx" ON "identity_links" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "verification_sessions_guild_user_idx" ON "verification_sessions" USING btree ("guild_id","user_id");