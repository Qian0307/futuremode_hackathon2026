CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`headcount` integer NOT NULL,
	`familiarity` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`predicted_drain` integer NOT NULL,
	`actual_drain` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_user_id_idx` ON `activities` (`user_id`);--> statement-breakpoint
CREATE INDEX `activities_scheduled_at_idx` ON `activities` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`anonymous_session_id` text NOT NULL,
	`personality_profile` text NOT NULL,
	`base_battery_capacity` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_anonymous_session_id_idx` ON `users` (`anonymous_session_id`);