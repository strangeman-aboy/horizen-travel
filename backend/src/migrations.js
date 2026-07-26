import { createHash } from "node:crypto";

export const LATEST_SCHEMA_VERSION = 7;

const VERIFIED_BAIDU_ANCHORS = Object.freeze({
  "place-lama-temple": { latitude: 39.953377859, longitude: 116.42370918 },
  "place-wudaoying": { latitude: 39.954949461, longitude: 116.415124973 },
  "place-guozijian": { latitude: 39.951771858, longitude: 116.418891837 },
  "place-dongsi-art": { latitude: 39.92988923, longitude: 116.416619483 },
  "place-jingshan": { latitude: 39.93227005, longitude: 116.402818007 },
  "place-shichahai": { latitude: 39.94223553, longitude: 116.397197669 },
  "place-forbidden-city": { latitude: 39.924091, longitude: 116.403414 },
  "place-bell-drum-towers": { latitude: 39.946598, longitude: 116.399153 }
});

function tableExists(db, tableName) {
  return Boolean(db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name)
  );
}

function addMissingColumns(db, tableName, definitions) {
  const columns = tableColumns(db, tableName);
  for (const [name, definition] of definitions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    }
  }
}

function createCurrentIdempotencyTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      owner_user_id TEXT NOT NULL,
      method TEXT NOT NULL,
      route_pattern TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      response_headers_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, method, route_pattern, idempotency_key)
    );
  `);
}

export function migrateAgentOperationsToProviderLineage(db) {
  addMissingColumns(db, "agent_runs", [
    [
      "provider_lineage",
      "provider_lineage INTEGER NOT NULL DEFAULT 1 CHECK (provider_lineage >= 1)"
    ]
  ]);
  if (tableColumns(db, "agent_operations").has("provider_lineage")) return;
  db.exec(`
    ALTER TABLE agent_operations RENAME TO agent_operations_legacy_v6;

    CREATE TABLE agent_operations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      provider_lineage INTEGER NOT NULL CHECK (provider_lineage >= 1),
      provider_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL CHECK (tool_name IN (
        'move_stop', 'set_stop_lock', 'remove_stop', 'finish_replan'
      )),
      arguments_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'PENDING', 'APPLIED', 'REJECTED', 'FAILED'
      )),
      base_revision_id TEXT NOT NULL,
      result_revision_id TEXT,
      output_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id, sequence),
      UNIQUE (run_id, provider_lineage, provider_call_id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (base_revision_id) REFERENCES trip_revisions(id),
      FOREIGN KEY (result_revision_id) REFERENCES trip_revisions(id)
    );

    INSERT INTO agent_operations (
      id, run_id, sequence, provider_lineage, provider_call_id, tool_name,
      arguments_json, status, base_revision_id, result_revision_id,
      output_json, error_json, created_at, updated_at
    )
    SELECT
      id, run_id, sequence, 1, provider_call_id, tool_name,
      arguments_json, status, base_revision_id, result_revision_id,
      output_json, error_json, created_at, updated_at
    FROM agent_operations_legacy_v6;

    DROP TABLE agent_operations_legacy_v6;

    CREATE INDEX idx_agent_operations_run_sequence
      ON agent_operations (run_id, sequence);
  `);
}

const migrations = [
  {
    version: 1,
    name: "baseline_schema",
    fingerprint: "baseline-v2-with-owner-provenance-and-idempotency-v2",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS places (
          id TEXT PRIMARY KEY,
          document_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS routes (
          id TEXT PRIMARY KEY,
          document_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL DEFAULT 'demo-user',
          share_url TEXT NOT NULL,
          status TEXT NOT NULL,
          source_json TEXT NOT NULL,
          extraction_json TEXT NOT NULL,
          warnings_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trips (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL DEFAULT 'demo-user',
          title TEXT NOT NULL,
          city TEXT NOT NULL,
          timezone TEXT NOT NULL,
          status TEXT NOT NULL,
          source_import_id TEXT,
          source_url TEXT,
          source_json TEXT NOT NULL DEFAULT '{}',
          current_revision_id TEXT NOT NULL,
          current_revision_no INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (source_import_id) REFERENCES imports(id)
        );

        CREATE TABLE IF NOT EXISTS trip_revisions (
          id TEXT PRIMARY KEY,
          trip_id TEXT NOT NULL,
          revision_no INTEGER NOT NULL,
          parent_revision_id TEXT,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (trip_id, revision_no),
          FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trip_revision_stops (
          revision_id TEXT NOT NULL,
          client_stop_id TEXT NOT NULL,
          source_stop_id TEXT,
          place_id TEXT,
          provider_refs_json TEXT NOT NULL DEFAULT '[]',
          name TEXT NOT NULL,
          scheduled_time TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          note TEXT NOT NULL,
          address TEXT,
          latitude REAL,
          longitude REAL,
          coord_system TEXT,
          image_url TEXT,
          category TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (revision_id, client_stop_id),
          FOREIGN KEY (revision_id) REFERENCES trip_revisions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          trip_id TEXT NOT NULL,
          base_revision_id TEXT NOT NULL,
          result_revision_id TEXT NOT NULL,
          status TEXT NOT NULL,
          instruction TEXT NOT NULL,
          scenario TEXT NOT NULL,
          operations_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS execution_events (
          id TEXT PRIMARY KEY,
          trip_id TEXT NOT NULL,
          type TEXT NOT NULL,
          client_stop_id TEXT,
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS booking_redirects (
          id TEXT PRIMARY KEY,
          trip_id TEXT NOT NULL,
          booking_option_id TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );
      `);
      createCurrentIdempotencyTable(db);
    }
  },
  {
    version: 2,
    name: "trip_stop_location",
    fingerprint: "trip_revision_stops-address-latitude-longitude-coordinate-system",
    apply(db) {
      addMissingColumns(db, "trip_revision_stops", [
        ["address", "address TEXT"],
        ["latitude", "latitude REAL"],
        ["longitude", "longitude REAL"],
        ["coord_system", "coord_system TEXT"]
      ]);
    }
  },
  {
    version: 3,
    name: "ownership_provenance_and_atomic_idempotency",
    fingerprint: "owners-source-json-source-stop-provider-refs-image-category-idempotency-owner-headers-expiry",
    apply(db) {
      addMissingColumns(db, "imports", [
        ["owner_user_id", "owner_user_id TEXT NOT NULL DEFAULT 'demo-user'"]
      ]);
      addMissingColumns(db, "trips", [
        ["owner_user_id", "owner_user_id TEXT NOT NULL DEFAULT 'demo-user'"],
        ["source_json", "source_json TEXT NOT NULL DEFAULT '{}'"]
      ]);
      addMissingColumns(db, "trip_revision_stops", [
        ["source_stop_id", "source_stop_id TEXT"],
        ["provider_refs_json", "provider_refs_json TEXT NOT NULL DEFAULT '[]'"],
        ["image_url", "image_url TEXT"],
        ["category", "category TEXT"]
      ]);

      const idempotencyColumns = tableColumns(db, "idempotency_records");
      const currentColumns = [
        "owner_user_id",
        "route_pattern",
        "response_headers_json",
        "expires_at"
      ];
      if (!currentColumns.every((column) => idempotencyColumns.has(column))) {
        db.exec("ALTER TABLE idempotency_records RENAME TO idempotency_records_legacy_v1");
        createCurrentIdempotencyTable(db);

        const legacyColumns = tableColumns(db, "idempotency_records_legacy_v1");
        const ownerExpression = legacyColumns.has("owner_user_id")
          ? "owner_user_id"
          : "'demo-user'";
        const routeExpression = legacyColumns.has("route_pattern")
          ? "route_pattern"
          : "path";
        const headersExpression = legacyColumns.has("response_headers_json")
          ? "response_headers_json"
          : "'{}'";
        const expiresExpression = legacyColumns.has("expires_at")
          ? "expires_at"
          : "strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')";

        db.exec(`
          INSERT OR IGNORE INTO idempotency_records
            (owner_user_id, method, route_pattern, idempotency_key, request_hash,
             status_code, response_json, response_headers_json, created_at, expires_at)
          SELECT
            ${ownerExpression}, method, ${routeExpression}, idempotency_key, request_hash,
            status_code, response_json, ${headersExpression}, created_at, ${expiresExpression}
          FROM idempotency_records_legacy_v1;
          DROP TABLE idempotency_records_legacy_v1;
        `);
      }
    }
  },
  {
    version: 4,
    name: "operational_indexes",
    fingerprint: "indexes-trip-list-revision-stop-events-agent-booking-import-idempotency",
    apply(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_imports_owner_created
          ON imports (owner_user_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_trips_owner_updated
          ON trips (owner_user_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_trip_revisions_trip_number
          ON trip_revisions (trip_id, revision_no DESC);
        CREATE INDEX IF NOT EXISTS idx_trip_revision_stops_order
          ON trip_revision_stops (revision_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_trip_created
          ON agent_runs (trip_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_events_trip_time
          ON execution_events (trip_id, occurred_at, recorded_at);
        CREATE INDEX IF NOT EXISTS idx_booking_redirects_trip_created
          ON booking_redirects (trip_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
          ON idempotency_records (expires_at);
      `);
    }
  },
  {
    version: 5,
    name: "durable_agent_runs_and_verified_baidu_coordinates",
    fingerprint: [
      "agent-runs-v2-state-machine-owner-provider-revisions-version",
      "agent-operations-strict-tools-per-revision",
      "agent-events-monotonic-sequence",
      "trip-revision-planner-state",
      "verified-bd09ll-demo-anchors-no-mock-provider-ids"
    ].join("-"),
    apply(db) {
      addMissingColumns(db, "trip_revisions", [
        [
          "planner_state_json",
          `planner_state_json TEXT NOT NULL DEFAULT '{"constraints":[],"transportModeOverrides":{}}'`
        ]
      ]);
      db.exec(`
        ALTER TABLE agent_runs RENAME TO agent_runs_legacy_v4;

        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          trip_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          base_revision_id TEXT NOT NULL,
          current_revision_id TEXT NOT NULL,
          result_revision_id TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'QUEUED', 'PLANNING', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED',
            'RESUMING', 'STOP_REQUESTED', 'STOPPED', 'COMPLETED', 'FAILED',
            'CONFLICTED', 'UNDOING', 'UNDONE'
          )),
          instruction TEXT NOT NULL,
          scenario TEXT,
          operations_json TEXT NOT NULL DEFAULT '[]',
          provider TEXT NOT NULL,
          model TEXT,
          provider_response_id TEXT,
          summary TEXT,
          error_code TEXT,
          error_message TEXT,
          run_version INTEGER NOT NULL DEFAULT 1 CHECK (run_version >= 1),
          next_event_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_event_sequence >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
          FOREIGN KEY (base_revision_id) REFERENCES trip_revisions(id),
          FOREIGN KEY (current_revision_id) REFERENCES trip_revisions(id),
          FOREIGN KEY (result_revision_id) REFERENCES trip_revisions(id)
        );

        INSERT INTO agent_runs (
          id, trip_id, owner_user_id, base_revision_id, current_revision_id,
          result_revision_id, status, instruction, scenario, operations_json,
          provider, model, provider_response_id, summary, error_code, error_message,
          run_version, next_event_sequence, created_at, updated_at, started_at,
          completed_at
        )
        SELECT
          legacy.id,
          legacy.trip_id,
          trips.owner_user_id,
          legacy.base_revision_id,
          legacy.result_revision_id,
          legacy.result_revision_id,
          legacy.status,
          legacy.instruction,
          legacy.scenario,
          legacy.operations_json,
          'legacy-deterministic',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          1,
          1,
          legacy.created_at,
          legacy.created_at,
          legacy.created_at,
          legacy.created_at
        FROM agent_runs_legacy_v4 AS legacy
        JOIN trips ON trips.id = legacy.trip_id;

        DROP TABLE agent_runs_legacy_v4;

        CREATE TABLE agent_operations (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 1),
          provider_call_id TEXT NOT NULL,
          tool_name TEXT NOT NULL CHECK (tool_name IN (
            'move_stop', 'set_stop_lock', 'remove_stop', 'finish_replan'
          )),
          arguments_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'PENDING', 'APPLIED', 'REJECTED', 'FAILED'
          )),
          base_revision_id TEXT NOT NULL,
          result_revision_id TEXT,
          output_json TEXT,
          error_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (run_id, sequence),
          UNIQUE (run_id, provider_call_id),
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (base_revision_id) REFERENCES trip_revisions(id),
          FOREIGN KEY (result_revision_id) REFERENCES trip_revisions(id)
        );

        CREATE TABLE agent_events (
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 1),
          id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (run_id, sequence),
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_agent_runs_trip_created
          ON agent_runs (trip_id, created_at DESC);
        CREATE INDEX idx_agent_runs_owner_created
          ON agent_runs (owner_user_id, created_at DESC);
        CREATE UNIQUE INDEX idx_agent_runs_one_active_per_trip
          ON agent_runs (trip_id)
          WHERE status IN (
            'QUEUED', 'PLANNING', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED',
            'RESUMING', 'STOP_REQUESTED', 'UNDOING'
          );
        CREATE INDEX idx_agent_operations_run_sequence
          ON agent_operations (run_id, sequence);
        CREATE INDEX idx_agent_events_run_sequence
          ON agent_events (run_id, sequence);
      `);

      const selectPlace = db.prepare("SELECT document_json FROM places WHERE id = ?");
      const updatePlace = db.prepare("UPDATE places SET document_json = ? WHERE id = ?");
      const updateRevisionStops = db.prepare(`
        UPDATE trip_revision_stops
        SET latitude = ?, longitude = ?, coord_system = 'BD09LL', provider_refs_json = '[]'
        WHERE place_id = ?
      `);
      for (const [placeId, coordinates] of Object.entries(VERIFIED_BAIDU_ANCHORS)) {
        const row = selectPlace.get(placeId);
        if (row) {
          const document = JSON.parse(row.document_json);
          document.lat = coordinates.latitude;
          document.lng = coordinates.longitude;
          document.coordSystem = "BD09LL";
          document.coordinateSource = "VERIFIED_BAIDU_GEOCODE_ANCHOR";
          delete document.baiduProviderId;
          updatePlace.run(JSON.stringify(document), placeId);
        }
        updateRevisionStops.run(
          coordinates.latitude,
          coordinates.longitude,
          placeId
        );
      }
    }
  },
  {
    version: 6,
    name: "agent_provider_conversation_state",
    fingerprint: "agent-runs-provider-conversation-json-for-restart-safe-chat-tools",
    apply(db) {
      addMissingColumns(db, "agent_runs", [
        ["provider_conversation_json", "provider_conversation_json TEXT"]
      ]);
    }
  },
  {
    version: 7,
    name: "agent_provider_lineage_scoped_call_ids",
    fingerprint: [
      "agent-runs-provider-lineage-generation",
      "agent-operations-call-id-unique-per-lineage",
      "preserve-existing-operation-audit"
    ].join("-"),
    apply(db) {
      migrateAgentOperationsToProviderLineage(db);
    }
  }
];

function migrationChecksum(migration) {
  return createHash("sha256")
    .update(`${migration.version}:${migration.name}:${migration.fingerprint}`)
    .digest("hex");
}

export function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare(`
    SELECT version, name, checksum FROM schema_migrations ORDER BY version
  `).all();
  const applied = new Map(appliedRows.map((row) => [row.version, row]));

  for (const migration of migrations) {
    const checksum = migrationChecksum(migration);
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== checksum) {
        throw new Error(
          `Schema migration ${migration.version} does not match its recorded checksum.`
        );
      }
      continue;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      migration.apply(db);
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, checksum, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
  return LATEST_SCHEMA_VERSION;
}
