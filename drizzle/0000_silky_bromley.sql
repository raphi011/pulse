CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`icon` text,
	`order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prefs` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `widget_cache` (
	`widget_id` text PRIMARY KEY NOT NULL,
	`payload` text,
	`fetched_at` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`error_kind` text
);
--> statement-breakpoint
CREATE TABLE `widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`order` integer DEFAULT 0 NOT NULL,
	`col_span` integer DEFAULT 1 NOT NULL,
	`row_span` integer DEFAULT 6 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`config` text NOT NULL
);
