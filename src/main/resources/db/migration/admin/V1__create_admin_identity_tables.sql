CREATE TABLE admin.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255),
    auth_provider VARCHAR(30) NOT NULL DEFAULT 'password',
    provider_subject VARCHAR(255),
    role VARCHAR(30) NOT NULL DEFAULT 'viewer',
    status VARCHAR(30) NOT NULL DEFAULT 'invited',
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_admin_users_created_by
        FOREIGN KEY (created_by) REFERENCES admin.admin_users(id) ON DELETE SET NULL,
    CONSTRAINT ck_admin_users_role
        CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
    CONSTRAINT ck_admin_users_status
        CHECK (status IN ('invited', 'active', 'suspended', 'disabled')),
    CONSTRAINT ck_admin_users_auth_provider
        CHECK (auth_provider IN ('password', 'github', 'google')),
    CONSTRAINT ck_admin_users_auth_identity
        CHECK (
            status = 'invited'
            OR (auth_provider = 'password' AND password_hash IS NOT NULL)
            OR (auth_provider <> 'password' AND provider_subject IS NOT NULL)
        )
);

CREATE UNIQUE INDEX uq_admin_users_normalized_email
    ON admin.admin_users (LOWER(email));

CREATE UNIQUE INDEX uq_admin_users_provider_subject
    ON admin.admin_users (auth_provider, provider_subject)
    WHERE provider_subject IS NOT NULL;

CREATE INDEX idx_admin_users_status_role
    ON admin.admin_users (status, role);

CREATE TABLE admin.admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL,
    session_token_hash CHAR(64) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_admin_sessions_user
        FOREIGN KEY (admin_user_id) REFERENCES admin.admin_users(id) ON DELETE CASCADE,
    CONSTRAINT uq_admin_sessions_token_hash UNIQUE (session_token_hash),
    CONSTRAINT ck_admin_sessions_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_admin_sessions_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_admin_sessions_user_created
    ON admin.admin_sessions (admin_user_id, created_at DESC);

CREATE INDEX idx_admin_sessions_active_expiry
    ON admin.admin_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE admin.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    result VARCHAR(30) NOT NULL,
    request_id VARCHAR(100),
    ip_address INET,
    before_data JSONB,
    after_data JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_admin_audit_logs_user
        FOREIGN KEY (admin_user_id) REFERENCES admin.admin_users(id) ON DELETE SET NULL,
    CONSTRAINT ck_admin_audit_logs_result
        CHECK (result IN ('success', 'failure', 'denied'))
);

CREATE INDEX idx_admin_audit_logs_user_created
    ON admin.admin_audit_logs (admin_user_id, created_at DESC);

CREATE INDEX idx_admin_audit_logs_resource_created
    ON admin.admin_audit_logs (resource_type, resource_id, created_at DESC);

CREATE INDEX idx_admin_audit_logs_created
    ON admin.admin_audit_logs (created_at DESC);
