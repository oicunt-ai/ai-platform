-- OICUNT AI Platform: Model Registry Schema
-- Version: 002_add_model_family

ALTER TABLE model_registry.canonical_models
ADD COLUMN IF NOT EXISTS family VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_canonical_models_family
ON model_registry.canonical_models(family);
