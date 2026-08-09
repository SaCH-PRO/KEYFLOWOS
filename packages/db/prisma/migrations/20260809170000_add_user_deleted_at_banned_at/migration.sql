-- Add soft-delete and ban timestamps to users so AuthMiddleware can reject
-- tokens for deleted or suspended accounts.
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "banned_at" TIMESTAMP(3);
