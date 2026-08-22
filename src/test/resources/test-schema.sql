CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE IF NOT EXISTS places (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(40) NOT NULL,
    source_place_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(120),
    address VARCHAR(500),
    road_address VARCHAR(500),
    location GEOGRAPHY(Point, 4326),
    district VARCHAR(80),
    raw_category VARCHAR(500),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_places_source_source_place_id UNIQUE (source, source_place_id)
);

CREATE TABLE IF NOT EXISTS tourism_data_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_key VARCHAR(160) NOT NULL,
    name VARCHAR(255) NOT NULL,
    source_name VARCHAR(255) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    license_use_condition TEXT,
    update_cycle VARCHAR(120),
    spatial_granularity VARCHAR(120) NOT NULL,
    temporal_granularity VARCHAR(120) NOT NULL,
    api_available BOOLEAN NOT NULL DEFAULT false,
    csv_available BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tourism_data_sources_dataset_key UNIQUE (dataset_key)
);

CREATE TABLE IF NOT EXISTS tourism_import_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES tourism_data_sources(id) ON DELETE RESTRICT,
    file_name VARCHAR(500) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    reference_period VARCHAR(160),
    mode VARCHAR(8) NOT NULL CHECK (mode IN ('live', 'mock')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_tourism_import_runs_source_sha256 UNIQUE (source_id, file_sha256)
);

CREATE TABLE IF NOT EXISTS tourism_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES tourism_data_sources(id) ON DELETE RESTRICT,
    import_run_id UUID NOT NULL REFERENCES tourism_import_runs(id) ON DELETE RESTRICT,
    place_id UUID REFERENCES places(id) ON DELETE SET NULL,
    area_code VARCHAR(120),
    area_name VARCHAR(255),
    metric_type VARCHAR(160) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(80) NOT NULL,
    period_start DATE,
    period_end DATE,
    dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
    dimension_key CHAR(64) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tourism_metrics_source_dimension_key UNIQUE (source_id, dimension_key)
);

CREATE TABLE IF NOT EXISTS recommendation_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scenario_key VARCHAR(120),
    preference_snapshot JSONB NOT NULL,
    candidate_snapshot JSONB NOT NULL,
    data_mode VARCHAR(16) NOT NULL CHECK (data_mode IN ('live', 'mock', 'mixed', 'unavailable')),
    baseline_algorithm_version VARCHAR(160) NOT NULL,
    michi_algorithm_version VARCHAR(160) NOT NULL,
    baseline_metrics JSONB NOT NULL,
    michi_metrics JSONB NOT NULL,
    delta JSONB NOT NULL,
    source_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    random_seed INTEGER,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
