-- PostgreSQL metadata only. No S3 side effects and no demo credentials.
CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL CHECK (email = lower(email)),
    display_name VARCHAR(100) NOT NULL CHECK (length(trim(display_name)) > 0),
    password_hash VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_email UNIQUE (email)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL CHECK (length(trim(name)) > 0),
    description VARCHAR(2000) NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES app_users(id),
    quota_bytes BIGINT NOT NULL CHECK (quota_bytes > 0),
    used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_project_quota CHECK (used_bytes <= quota_bytes AND reserved_bytes <= quota_bytes - used_bytes)
);

CREATE TABLE memberships (
    project_id UUID NOT NULL REFERENCES projects(id),
    user_id UUID NOT NULL REFERENCES app_users(id),
    role VARCHAR(10) NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
-- Week 1 has one immutable owner. Ownership transfer is deliberately out of scope.
CREATE UNIQUE INDEX uq_project_owner ON memberships(project_id) WHERE role = 'OWNER';
CREATE INDEX ix_membership_user ON memberships(user_id, project_id);

CREATE TABLE file_metadata (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    filename VARCHAR(255) NOT NULL CHECK (length(trim(filename)) > 0),
    created_by UUID NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, project_id)
);
CREATE INDEX ix_file_project ON file_metadata(project_id, created_at);

CREATE TABLE file_versions (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL,
    project_id UUID NOT NULL,
    bucket VARCHAR(255) NOT NULL CHECK (length(bucket) > 0),
    object_key TEXT NOT NULL CHECK (object_key LIKE 'uploads/%'),
    s3_version_id TEXT,
    content_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    expected_sha256 VARCHAR(64) NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
    actual_sha256 VARCHAR(64) CHECK (actual_sha256 ~ '^[0-9a-f]{64}$'),
    upload_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (upload_status IN ('PENDING','AVAILABLE','FAILED','EXPIRED')),
    integrity_status VARCHAR(24) NOT NULL DEFAULT 'INTEGRITY_PENDING' CHECK (integrity_status IN ('INTEGRITY_PENDING','VERIFIED','MISMATCH','FAILED')),
    created_by UUID NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (file_id, project_id) REFERENCES file_metadata(id, project_id),
    UNIQUE (id, project_id),
    UNIQUE (bucket, object_key, s3_version_id),
    CHECK (s3_version_id IS NULL OR (length(trim(s3_version_id)) > 0 AND s3_version_id <> 'null')),
    CHECK (upload_status <> 'AVAILABLE' OR s3_version_id IS NOT NULL),
    CHECK (integrity_status NOT IN ('VERIFIED','MISMATCH') OR (upload_status = 'AVAILABLE' AND actual_sha256 IS NOT NULL)),
    CHECK (integrity_status <> 'VERIFIED' OR actual_sha256 = expected_sha256),
    CHECK (integrity_status <> 'MISMATCH' OR actual_sha256 <> expected_sha256)
);
CREATE INDEX ix_version_file ON file_versions(file_id, created_at);
CREATE INDEX ix_version_project_status ON file_versions(project_id, upload_status, integrity_status);

CREATE TABLE upload_sessions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    file_version_id UUID NOT NULL UNIQUE,
    initiated_by UUID NOT NULL REFERENCES app_users(id),
    reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (file_version_id, project_id) REFERENCES file_versions(id, project_id),
    CHECK (expires_at > created_at)
);
CREATE INDEX ix_upload_expiry ON upload_sessions(expires_at) WHERE completed_at IS NULL;

CREATE TABLE handovers (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','CONFIRMED')),
    access_status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (access_status IN ('ACTIVE','REVOKED')),
    created_by UUID NOT NULL REFERENCES app_users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, project_id),
    CHECK (expires_at > created_at),
    CHECK (status = 'DRAFT' OR published_at IS NOT NULL)
);
CREATE INDEX ix_handover_project ON handovers(project_id, created_at);

CREATE TABLE handover_items (
    handover_id UUID NOT NULL,
    project_id UUID NOT NULL,
    file_version_id UUID NOT NULL,
    PRIMARY KEY (handover_id, file_version_id),
    FOREIGN KEY (handover_id, project_id) REFERENCES handovers(id, project_id),
    FOREIGN KEY (file_version_id, project_id) REFERENCES file_versions(id, project_id)
);
CREATE INDEX ix_handover_item_version ON handover_items(file_version_id);

CREATE TABLE handover_recipients (
    handover_id UUID NOT NULL REFERENCES handovers(id),
    user_id UUID NOT NULL REFERENCES app_users(id),
    access_status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (access_status IN ('ACTIVE','REVOKED')),
    confirmed_at TIMESTAMPTZ,
    PRIMARY KEY (handover_id, user_id)
);
CREATE INDEX ix_recipient_user ON handover_recipients(user_id, handover_id);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    actor_id UUID NOT NULL REFERENCES app_users(id),
    action VARCHAR(80) NOT NULL,
    target_id UUID NOT NULL,
    request_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_project_time ON audit_events(project_id, created_at);
