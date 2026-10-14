begin;

CREATE TABLE content_library_asset_exclusions (
  workspace_id text NOT NULL,
  brand_id text NOT NULL,
  library_id text NOT NULL,
  external_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, brand_id, library_id, external_id),
  FOREIGN KEY (workspace_id, brand_id, library_id)
    REFERENCES content_asset_libraries (workspace_id, brand_id, id)
    ON DELETE CASCADE
);

-- This file was visually confirmed to be a Cafejubilee dashboard screenshot
-- appearing in TheDukeMan's production library. Exclude its stable Drive ID so
-- a later re-index cannot put it back in the picker.
INSERT INTO content_library_asset_exclusions
  (workspace_id, brand_id, library_id, external_id, reason)
SELECT a.workspace_id, a.brand_id, a.library_id, a.external_id,
       'Cross-brand Cafejubilee screenshot observed in TheDukeMan production picker'
FROM content_library_assets a
WHERE a.brand_id = 'f00f0ec6-53bb-40da-ac20-f4c2ecb381d7'
  AND lower(a.name) = lower('IMG_8797.png')
ON CONFLICT (workspace_id, brand_id, library_id, external_id) DO NOTHING;

commit;
