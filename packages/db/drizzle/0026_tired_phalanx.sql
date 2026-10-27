ALTER TABLE "oauth_access_tokens" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash");