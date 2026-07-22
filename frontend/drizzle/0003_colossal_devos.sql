CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `tabs` (`id`, `name`, `order`) VALUES ('default', 'Dashboard', 0);
--> statement-breakpoint
ALTER TABLE `widgets` ADD `tab_id` text DEFAULT 'default' NOT NULL;