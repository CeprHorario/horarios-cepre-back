ALTER TABLE files ADD COLUMN thumbnail JSONB;
ALTER TABLE files ADD CONSTRAINT files_thumbnail_object CHECK (thumbnail IS NULL OR jsonb_typeof(thumbnail)='object');
