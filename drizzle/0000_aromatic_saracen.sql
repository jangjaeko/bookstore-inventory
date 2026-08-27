CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_key" text NOT NULL,
	"isbn" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"pub_date" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"krw" integer,
	"cad" double precision,
	"weight" integer,
	"location" text DEFAULT '' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_match_key_unique" UNIQUE("match_key")
);
--> statement-breakpoint
CREATE TABLE "import_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"qty_after" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_title_idx" ON "books" USING btree ("title");--> statement-breakpoint
CREATE INDEX "books_isbn_idx" ON "books" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "books_updated_idx" ON "books" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "stock_logs_book_idx" ON "stock_logs" USING btree ("book_id","created_at");