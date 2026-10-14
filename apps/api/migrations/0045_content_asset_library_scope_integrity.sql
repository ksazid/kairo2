-- Keep each indexed asset attached to a library in the same workspace and brand.
ALTER TABLE content_asset_libraries
  ADD CONSTRAINT content_asset_libraries_scope_key
  UNIQUE (workspace_id, brand_id, id);

-- NOT VALID preserves migration compatibility with any historical inconsistent rows.
-- New and updated rows are still checked; reads filter historical mismatches.
ALTER TABLE content_library_assets
  ADD CONSTRAINT content_library_assets_library_scope_fk
  FOREIGN KEY (workspace_id, brand_id, library_id)
  REFERENCES content_asset_libraries (workspace_id, brand_id, id)
  NOT VALID;
