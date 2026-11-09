-- Face ID sign-in (src/passkeys.ts): passkeys, the app's own sign-in sessions, and invite links,
-- so the app can stop relying on Cloudflare Access's emailed codes.

-- One row per passkey (a phone, an iPad, a Mac). id is the credential id, base64url.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                          -- lowercased, the same identity Access gave
  public_key TEXT NOT NULL,                     -- COSE public key, base64url
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                              -- JSON list, as the browser reported
  device TEXT,                                  -- "iPhone", "Mac": a label for the Goals list
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_passkeys_email ON passkeys(email);

-- Signed-in browsers. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                      -- a year from the last use
);
CREATE INDEX idx_sessions_email ON sessions(email);

-- One-time WebAuthn challenges, each good for a few minutes and one use.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,                        -- register | signin
  email TEXT,                                   -- who is registering (null for signin)
  invite_hash TEXT,                             -- the invite link used to register, if any
  expires_at TEXT NOT NULL
);

-- Invite links: open one on a phone to set up Face ID as that person. Seven days, one use.
CREATE TABLE invite_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
