PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`order` integer DEFAULT 0 NOT NULL,
	`col_span` integer DEFAULT 1 NOT NULL,
	`row_span` integer DEFAULT 6 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`config` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_widgets` (`id`, `type`, `title`, `order`, `col_span`, `row_span`, `hidden`, `config`)
SELECT `id`, `type`, `title`,
	ROW_NUMBER() OVER (ORDER BY `column`, `order`) - 1 AS `order`,
	1 AS `col_span`, 6 AS `row_span`,
	`hidden`, `config`
FROM `widgets`;
--> statement-breakpoint
DROP TABLE `widgets`;
--> statement-breakpoint
ALTER TABLE `__new_widgets` RENAME TO `widgets`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
