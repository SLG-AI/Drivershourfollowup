-- Add centre_cout column to wp_target_needs
ALTER TABLE wp_target_needs ADD COLUMN IF NOT EXISTS centre_cout TEXT DEFAULT '';
