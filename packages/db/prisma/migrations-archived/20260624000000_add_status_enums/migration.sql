-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID', 'OVERDUE', 'FAILED', 'PENDING', 'PARTIALLY_PAID', 'FULLY_CREDITED', 'PARTIALLY_CREDITED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'VIEWED', 'EXPIRED', 'INVOICED', 'PAID', 'CONVERTED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BusinessAssetStatus" AS ENUM ('ACTIVE', 'PENDING', 'EXPIRED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "InvoiceStatus" USING "status"::"InvoiceStatus", ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "quotes" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "QuoteStatus" USING "status"::"QuoteStatus", ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "deals" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "DealStatus" USING "status"::"DealStatus", ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "BookingStatus" USING "status"::"BookingStatus", ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "SubscriptionStatus" USING "status"::"SubscriptionStatus", ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "subscription_payments" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "SubscriptionPaymentStatus" USING "status"::"SubscriptionPaymentStatus", ALTER COLUMN "status" SET DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "project_tasks" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "ProjectTaskStatus" USING "status"::"ProjectTaskStatus", ALTER COLUMN "status" SET DEFAULT 'TODO';

-- AlterTable
ALTER TABLE "business_assets" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "BusinessAssetStatus" USING "status"::"BusinessAssetStatus", ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
