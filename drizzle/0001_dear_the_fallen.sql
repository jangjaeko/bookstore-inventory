ALTER TABLE "import_presets" ADD COLUMN "direction" text DEFAULT 'in' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_presets" ADD COLUMN "multi_row" boolean DEFAULT false NOT NULL;