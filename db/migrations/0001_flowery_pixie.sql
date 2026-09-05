ALTER TABLE `users` ADD `calendar_token` text;--> statement-breakpoint
CREATE INDEX `users_calendar_token_idx` ON `users` (`calendar_token`);