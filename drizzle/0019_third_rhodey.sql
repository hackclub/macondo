CREATE INDEX "referral_visits_created_at_idx" ON "referral_visits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "referral_visits_visitor_cookie_idx" ON "referral_visits" USING btree ("visitor_cookie");--> statement-breakpoint
CREATE INDEX "referral_visits_user_id_idx" ON "referral_visits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referral_visits_utm_source_idx" ON "referral_visits" USING btree ("utm_source");--> statement-breakpoint
CREATE INDEX "referral_visits_utm_campaign_idx" ON "referral_visits" USING btree ("utm_campaign");--> statement-breakpoint
CREATE INDEX "referral_visits_referer_host_idx" ON "referral_visits" USING btree ("referer_host");