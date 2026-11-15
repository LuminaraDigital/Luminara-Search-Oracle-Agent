-- A share can name the project it was generated for.
-- The public page uses that to render the workspace brand.
-- Null means the share has no project and keeps the Luminara brand.
-- Rollback: readers treat a missing column as null.

ALTER TABLE shared_reports ADD COLUMN project_id TEXT;
