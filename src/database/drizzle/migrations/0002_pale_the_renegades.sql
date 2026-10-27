CREATE TABLE "revoked_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "revoked_tokens_expiry_hash_idx" ON "revoked_tokens" USING btree ("expires_at","token_hash");