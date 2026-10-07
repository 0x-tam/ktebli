-- Extend the public source catalogue and persist location evidence separately
-- from the legacy Lebanon-focused qualification field.
ALTER TABLE membership.opportunities DROP CONSTRAINT opportunities_source_check;
ALTER TABLE membership.opportunities ADD CONSTRAINT opportunities_source_check
  CHECK (source IN ('cdr','ppa','japan-ggp','australia-dap','czech-ssp','canada-cfli','eeas','aics','undp','ungm','mawred','worldbank','grants-gov','sam-gov'));

ALTER TABLE membership.opportunities
  ADD COLUMN locations jsonb NOT NULL DEFAULT '{"countryCodes":[],"scope":"unknown","evidence":[]}'::jsonb,
  ADD CONSTRAINT opportunities_locations_shape_check CHECK (COALESCE(
    jsonb_typeof(locations)='object'
    AND locations ?& ARRAY['countryCodes','scope','evidence']
    AND jsonb_typeof(locations->'countryCodes')='array'
    AND jsonb_typeof(locations->'evidence')='array'
    AND locations->>'scope' IN ('countries','worldwide','unknown')
    AND ((locations->>'scope'='countries'
          AND CASE WHEN jsonb_typeof(locations->'countryCodes')='array'
            THEN jsonb_array_length(locations->'countryCodes')>0 ELSE false END
          AND CASE WHEN jsonb_typeof(locations->'evidence')='array'
            THEN jsonb_array_length(locations->'evidence')>0 ELSE false END)
      OR (locations->>'scope'='worldwide'
          AND CASE WHEN jsonb_typeof(locations->'countryCodes')='array'
            THEN jsonb_array_length(locations->'countryCodes')=0 ELSE false END
          AND CASE WHEN jsonb_typeof(locations->'evidence')='array'
            THEN jsonb_array_length(locations->'evidence')>0 ELSE false END)
      OR (locations->>'scope'='unknown'
          AND CASE WHEN jsonb_typeof(locations->'countryCodes')='array'
            THEN jsonb_array_length(locations->'countryCodes')=0 ELSE false END
          AND CASE WHEN jsonb_typeof(locations->'evidence')='array'
            THEN jsonb_array_length(locations->'evidence')=0 ELSE false END)),
    false
  ));

-- Recover Lebanon only from copied, explicit project or beneficiary-country
-- evidence. Publisher jurisdiction and applicant-origin evidence do not qualify.
UPDATE membership.opportunities o
SET locations=jsonb_build_object(
  'countryCodes',jsonb_build_array('LB'),
  'scope','countries',
  'evidence',(
    SELECT jsonb_agg(item)
    FROM jsonb_array_elements(o.geography_evidence) AS e(item)
    WHERE (item->>'label' IN ('Project country','Country of implementation')
           AND btrim(item->>'text')='Lebanon')
       OR (item->>'label'='Beneficiary countries or territories'
           AND item->>'text' ~* '(^|[,;[:space:]])Lebanon($|[,;[:space:]])')
  )
)
WHERE o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(o.geography_evidence) AS e(item)
    WHERE (item->>'label' IN ('Project country','Country of implementation')
           AND btrim(item->>'text')='Lebanon')
       OR (item->>'label'='Beneficiary countries or territories'
           AND item->>'text' ~* '(^|[,;[:space:]])Lebanon($|[,;[:space:]])')
  );

-- The Lebanese procurement portal identifies the opportunity's procurement
-- jurisdiction. This is kept distinct from the location of project delivery.
UPDATE membership.opportunities o
SET locations=jsonb_build_object(
  'countryCodes',jsonb_build_array('LB'),
  'scope','countries',
  'evidence',jsonb_build_array(jsonb_build_object(
    'label','Procurement jurisdiction',
    'text','Lebanon Public Procurement Authority official portal',
    'url',o.source_url
  ))
)
WHERE o.source='ppa';

CREATE INDEX opportunities_locations_countries_gin_idx
  ON membership.opportunities USING gin ((locations->'countryCodes'));

ALTER TABLE membership.crawler_checkpoints DROP CONSTRAINT crawler_checkpoints_source_check;
ALTER TABLE membership.crawler_checkpoints ADD CONSTRAINT crawler_checkpoints_source_check
  CHECK (source IN ('ppa','ungm-curated','mawred','worldbank','grants-gov','sam-gov'));
