import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "./migrations.js";
import { seedPlaces, seedRoutes } from "./seed.js";

export class RevisionConflictError extends Error {
  constructor(currentTrip) {
    super("The trip has changed since the supplied base revision.");
    this.name = "RevisionConflictError";
    this.currentTrip = currentTrip;
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export class TripStatusConflictError extends Error {
  constructor(currentTrip, requestedStatus) {
    super("The requested trip status transition is not allowed.");
    this.name = "TripStatusConflictError";
    this.currentTrip = currentTrip;
    this.requestedStatus = requestedStatus;
  }
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.parse(value);
}

function nowIso() {
  return new Date().toISOString();
}

function rowToTrip(db, row, revisionRow = null) {
  if (!row) return null;
  const revisionId = revisionRow?.id ?? row.current_revision_id;
  const effectiveRevision = revisionRow ?? db.prepare(`
    SELECT * FROM trip_revisions WHERE id = ? AND trip_id = ?
  `).get(revisionId, row.id);
  const stops = db.prepare(`
    SELECT
      client_stop_id AS clientStopId,
      source_stop_id AS sourceStopId,
      place_id AS placeId,
      provider_refs_json AS providerRefsJson,
      name,
      scheduled_time AS scheduledTime,
      duration_minutes AS durationMinutes,
      note,
      address,
      latitude,
      longitude,
      coord_system AS coordSystem,
      image_url AS imageUrl,
      category,
      locked,
      sort_order AS sortOrder
    FROM trip_revision_stops
    WHERE revision_id = ?
    ORDER BY sort_order ASC
  `).all(revisionId).map(({ providerRefsJson, ...stop }) => ({
    ...stop,
    sourceStopId: stop.sourceStopId ?? null,
    providerRefs: parseJson(providerRefsJson, []),
    address: stop.address ?? "",
    latitude: stop.latitude ?? null,
    longitude: stop.longitude ?? null,
    coordSystem: stop.coordSystem ?? null,
    imageUrl: stop.imageUrl ?? null,
    category: stop.category ?? null,
    locked: Boolean(stop.locked)
  }));

  return {
    tripId: row.id,
    title: row.title,
    city: row.city,
    timezone: row.timezone,
    status: row.status,
    sourceImportId: row.source_import_id,
    sourceUrl: row.source_url,
    source: parseJson(row.source_json, {}),
    revisionId,
    revision: revisionRow?.revision_no ?? row.current_revision_no,
    currentRevisionId: row.current_revision_id,
    isCurrentRevision: revisionId === row.current_revision_id,
    savedAt: revisionRow?.created_at ?? row.updated_at,
    createdAt: row.created_at,
    plannerState: parseJson(effectiveRevision?.planner_state_json, {
      constraints: [],
      transportModeOverrides: {}
    }),
    stops
  };
}

function rowToAgentOperation(row) {
  if (!row) return null;
  const operationArguments = parseJson(row.arguments_json, {});
  const output = parseJson(row.output_json);
  const typeByTool = {
    move_stop: "stop.move",
    set_stop_lock: operationArguments.locked ? "stop.lock" : "stop.unlock",
    remove_stop: "stop.remove",
    finish_replan: "replan.finish"
  };
  const titleByTool = {
    move_stop: "调整行程时间",
    set_stop_lock: operationArguments.locked ? "锁定行程项" : "解除行程锁定",
    remove_stop: "移除行程项",
    finish_replan: "完成重新规划"
  };
  return {
    operationId: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    providerCallId: row.provider_call_id,
    toolName: row.tool_name,
    type: typeByTool[row.tool_name] ?? row.tool_name,
    arguments: operationArguments,
    status: row.status,
    targetClientStopId: operationArguments.client_stop_id ?? null,
    before: output?.before ?? null,
    after: output?.after ?? null,
    reason: operationArguments.reason ?? operationArguments.summary ?? "",
    title: titleByTool[row.tool_name] ?? "Agent 操作",
    detail: operationArguments.reason ?? operationArguments.summary ?? "",
    baseRevisionId: row.base_revision_id,
    resultRevisionId: row.result_revision_id ?? null,
    output,
    error: parseJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function operationForEvent(operation, trip = null, status = operation.status) {
  const target = trip && operation.targetClientStopId
    ? trip.stops.find((stop) => stop.clientStopId === operation.targetClientStopId)
    : null;
  let before = operation.before;
  let after = operation.after;
  if (!before && target && operation.toolName === "move_stop") {
    before = { scheduledTime: target.scheduledTime };
    after = { scheduledTime: operation.arguments.new_scheduled_time };
  } else if (!before && target && operation.toolName === "set_stop_lock") {
    before = { locked: target.locked };
    after = { locked: operation.arguments.locked };
  } else if (!before && target && operation.toolName === "remove_stop") {
    before = {
      clientStopId: target.clientStopId,
      name: target.name,
      scheduledTime: target.scheduledTime
    };
    after = null;
  }
  return {
    ...operation,
    status,
    before,
    after
  };
}

function scheduledMinutes(time) {
  const match = String(time).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function hasValidNonOverlappingSchedule(stops) {
  const intervals = [];
  const ids = new Set();
  for (const stop of stops) {
    if (ids.has(stop.clientStopId)) return false;
    ids.add(stop.clientStopId);
    const startMinute = scheduledMinutes(stop.scheduledTime);
    const durationMinutes = Number(stop.durationMinutes);
    if (
      startMinute === null ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      startMinute + durationMinutes > 24 * 60
    ) {
      return false;
    }
    intervals.push({
      startMinute,
      endMinute: startMinute + durationMinutes
    });
  }
  intervals.sort((left, right) => left.startMinute - right.startMinute);
  return intervals.every((interval, index) => (
    index === 0 || intervals[index - 1].endMinute <= interval.startMinute
  ));
}

function sortStopsBySchedule(stops) {
  return [...stops].sort((left, right) => (
    scheduledMinutes(left.scheduledTime) - scheduledMinutes(right.scheduledTime) ||
    left.clientStopId.localeCompare(right.clientStopId)
  ));
}

function reverseAppliedAgentOperations({
  currentTrip,
  operations,
  loadRevision
}) {
  let stops = structuredClone(currentTrip.stops);
  const revertedOperationIds = [];
  const preservedOperations = [];
  const appliedOperations = operations
    .filter((operation) => operation.status === "APPLIED")
    .sort((left, right) => right.sequence - left.sequence);

  const preserve = (operation, reason) => {
    preservedOperations.push({
      operationId: operation.operationId,
      toolName: operation.toolName,
      reason
    });
  };

  for (const operation of appliedOperations) {
    if (operation.toolName === "finish_replan") continue;
    const targetId = operation.targetClientStopId;
    const targetIndex = stops.findIndex(
      (stop) => stop.clientStopId === targetId
    );
    const baseSnapshot = loadRevision(operation.baseRevisionId);
    const baseStop = baseSnapshot?.stops.find(
      (stop) => stop.clientStopId === targetId
    );

    if (operation.toolName === "move_stop") {
      if (targetIndex < 0) {
        preserve(operation, "TARGET_MISSING_AFTER_USER_CHANGES");
        continue;
      }
      const afterTime = operation.after?.scheduledTime
        ?? operation.arguments.new_scheduled_time;
      const beforeTime = operation.before?.scheduledTime
        ?? baseStop?.scheduledTime;
      if (!beforeTime) {
        preserve(operation, "BASE_VALUE_MISSING");
        continue;
      }
      if (stops[targetIndex].scheduledTime !== afterTime) {
        preserve(operation, "USER_VALUE_TAKES_PRECEDENCE");
        continue;
      }
      const candidateStops = stops.map((stop, index) => (
        index === targetIndex
          ? { ...stop, scheduledTime: beforeTime }
          : stop
      ));
      if (!hasValidNonOverlappingSchedule(candidateStops)) {
        preserve(operation, "USER_SCHEDULE_CONFLICT");
        continue;
      }
      stops = candidateStops;
      revertedOperationIds.push(operation.operationId);
      continue;
    }

    if (operation.toolName === "set_stop_lock") {
      if (targetIndex < 0) {
        preserve(operation, "TARGET_MISSING_AFTER_USER_CHANGES");
        continue;
      }
      const afterLocked = operation.after?.locked
        ?? operation.arguments.locked;
      const beforeLocked = operation.before?.locked
        ?? baseStop?.locked;
      if (typeof beforeLocked !== "boolean") {
        preserve(operation, "BASE_VALUE_MISSING");
        continue;
      }
      if (stops[targetIndex].locked !== afterLocked) {
        preserve(operation, "USER_VALUE_TAKES_PRECEDENCE");
        continue;
      }
      stops[targetIndex] = {
        ...stops[targetIndex],
        locked: beforeLocked
      };
      revertedOperationIds.push(operation.operationId);
      continue;
    }

    if (operation.toolName === "remove_stop") {
      if (targetIndex >= 0) {
        preserve(operation, "USER_RESTORED_TARGET");
        continue;
      }
      if (!baseStop) {
        preserve(operation, "BASE_STOP_MISSING");
        continue;
      }
      const candidateStops = [...stops, structuredClone(baseStop)];
      if (!hasValidNonOverlappingSchedule(candidateStops)) {
        preserve(operation, "USER_SCHEDULE_CONFLICT");
        continue;
      }
      stops = candidateStops;
      revertedOperationIds.push(operation.operationId);
    }
  }

  const addedAgentConstraints = new Map();
  for (const operation of [...appliedOperations].reverse()) {
    const baseSnapshot = loadRevision(operation.baseRevisionId);
    const resultSnapshot = operation.resultRevisionId
      ? loadRevision(operation.resultRevisionId)
      : null;
    if (!baseSnapshot || !resultSnapshot) continue;
    const baseConstraintIds = new Set(
      baseSnapshot.plannerState.constraints
        .map((constraint) => constraint?.id)
        .filter(Boolean)
    );
    for (const constraint of resultSnapshot.plannerState.constraints) {
      if (
        constraint?.id &&
        constraint.source === "agent_instruction" &&
        !baseConstraintIds.has(constraint.id) &&
        !addedAgentConstraints.has(constraint.id)
      ) {
        addedAgentConstraints.set(
          constraint.id,
          structuredClone(constraint)
        );
      }
    }
  }

  const removedConstraintIds = [];
  const constraints = currentTrip.plannerState.constraints.filter(
    (constraint) => {
      const addedConstraint = addedAgentConstraints.get(constraint?.id);
      if (
        addedConstraint &&
        JSON.stringify(constraint) === JSON.stringify(addedConstraint)
      ) {
        removedConstraintIds.push(constraint.id);
        return false;
      }
      return true;
    }
  );

  return {
    stops: sortStopsBySchedule(stops),
    plannerState: {
      constraints: structuredClone(constraints),
      transportModeOverrides: structuredClone(
        currentTrip.plannerState.transportModeOverrides ?? {}
      )
    },
    revertedOperationIds,
    preservedOperations,
    removedConstraintIds
  };
}

function rowToAgentRun(db, row, { includeOperations = true } = {}) {
  if (!row) return null;
  const persistedOperations = includeOperations
    ? db.prepare(`
        SELECT * FROM agent_operations
        WHERE run_id = ?
        ORDER BY sequence ASC
      `).all(row.id).map(rowToAgentOperation)
    : [];
  const operations = persistedOperations.length > 0
    ? persistedOperations
    : parseJson(row.operations_json, []);
  const agentRun = {
    runId: row.id,
    tripId: row.trip_id,
    ownerUserId: row.owner_user_id,
    baseRevisionId: row.base_revision_id,
    currentRevisionId: row.current_revision_id,
    resultRevisionId: row.result_revision_id ?? null,
    status: row.status,
    instruction: row.instruction,
    scenario: row.scenario ?? null,
    provider: row.provider,
    model: row.model ?? null,
    providerResponseId: row.provider_response_id ?? null,
    summary: row.summary ?? null,
    error: row.error_code
      ? { code: row.error_code, message: row.error_message ?? "Agent run failed." }
      : null,
    runVersion: row.run_version,
    operations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null
  };
  Object.defineProperty(agentRun, "providerConversationState", {
    value: parseJson(row.provider_conversation_json),
    enumerable: false,
    configurable: false,
    writable: false
  });
  return agentRun;
}

function agentTripSnapshot(trip) {
  return {
    tripId: trip.tripId,
    title: trip.title,
    city: trip.city,
    timezone: trip.timezone,
    revisionId: trip.revisionId,
    revision: trip.revision,
    status: trip.status,
    stops: trip.stops,
    plannerState: trip.plannerState
  };
}

export function createStore({ filePath, idempotencyTtlHours = 168 }) {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (filePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }

  const schemaVersion = applyMigrations(db);
  let transactionDepth = 0;
  const transaction = (work) => {
    if (transactionDepth > 0) return work();
    db.exec("BEGIN IMMEDIATE");
    transactionDepth += 1;
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  };

  transaction(() => {
    const putPlace = db.prepare("INSERT OR IGNORE INTO places (id, document_json) VALUES (?, ?)");
    for (const place of seedPlaces) putPlace.run(place.id, JSON.stringify(place));
    const putRoute = db.prepare("INSERT OR IGNORE INTO routes (id, document_json) VALUES (?, ?)");
    for (const route of seedRoutes) putRoute.run(route.id, JSON.stringify(route));
  });

  const insertRevision = ({
    tripId,
    revisionId,
    revisionNo,
    parentRevisionId,
    reason,
    plannerState,
    stops,
    createdAt
  }) => {
    db.prepare(`
      INSERT INTO trip_revisions
        (id, trip_id, revision_no, parent_revision_id, reason, planner_state_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      tripId,
      revisionNo,
      parentRevisionId,
      reason,
      JSON.stringify(plannerState ?? { constraints: [], transportModeOverrides: {} }),
      createdAt
    );

    const insertStop = db.prepare(`
      INSERT INTO trip_revision_stops
        (revision_id, client_stop_id, source_stop_id, place_id, provider_refs_json,
         name, scheduled_time, duration_minutes, note, address, latitude, longitude,
         coord_system, image_url, category, locked, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stops.forEach((stop, index) => {
      insertStop.run(
        revisionId,
        stop.clientStopId,
        stop.sourceStopId ?? null,
        stop.placeId ?? null,
        JSON.stringify(stop.providerRefs ?? []),
        stop.name,
        stop.scheduledTime,
        stop.durationMinutes,
        stop.note ?? "",
        stop.address ?? "",
        stop.latitude ?? null,
        stop.longitude ?? null,
        stop.coordSystem ?? null,
        stop.imageUrl ?? null,
        stop.category ?? null,
        stop.locked ? 1 : 0,
        index
      );
    });
  };

  const getTrip = (tripId, ownerUserId = "demo-user") => {
    const row = db.prepare(`
      SELECT * FROM trips WHERE id = ? AND owner_user_id = ?
    `).get(tripId, ownerUserId);
    return rowToTrip(db, row);
  };

  const saveScheduleInsideTransaction = ({
    tripId,
    ownerUserId = "demo-user",
    baseRevisionId,
    stops,
    reason,
    status = null,
    plannerState = null
  }) => {
    const current = getTrip(tripId, ownerUserId);
    if (!current) return null;
    if (current.revisionId !== baseRevisionId) throw new RevisionConflictError(current);
    const nextStatus = status ?? current.status;
    if (
      status !== null &&
      !(
        (current.status === "DRAFT" && status === "CONFIRMED") ||
        (current.status === "CONFIRMED" && status === "CONFIRMED")
      )
    ) {
      throw new TripStatusConflictError(current, status);
    }

    const createdAt = nowIso();
    const revisionId = `rev-${randomUUID()}`;
    const revisionNo = current.revision + 1;
    insertRevision({
      tripId,
      revisionId,
      revisionNo,
      parentRevisionId: current.revisionId,
      reason,
      plannerState: plannerState ?? current.plannerState,
      stops,
      createdAt
    });
    db.prepare(`
      UPDATE trips
      SET current_revision_id = ?, current_revision_no = ?, status = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).run(revisionId, revisionNo, nextStatus, createdAt, tripId, ownerUserId);
    return getTrip(tripId, ownerUserId);
  };

  const getAgentRunRow = (runId, ownerUserId = null) => {
    const where = ownerUserId == null
      ? "agent_runs.id = ?"
      : "agent_runs.id = ? AND agent_runs.owner_user_id = ?";
    const parameters = ownerUserId == null ? [runId] : [runId, ownerUserId];
    return db.prepare(`SELECT agent_runs.* FROM agent_runs WHERE ${where}`).get(...parameters);
  };

  const appendAgentEventInsideTransaction = (
    runId,
    type,
    payload = {},
    createdAt = nowIso()
  ) => {
    const row = db.prepare(`
      SELECT next_event_sequence FROM agent_runs WHERE id = ?
    `).get(runId);
    if (!row) return null;
    const sequence = row.next_event_sequence;
    const event = {
      eventId: `agent-event-${randomUUID()}`,
      runId,
      sequence,
      type,
      payload,
      createdAt
    };
    db.prepare(`
      INSERT INTO agent_events
        (run_id, sequence, id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      sequence,
      event.eventId,
      type,
      JSON.stringify(payload ?? {}),
      createdAt
    );
    db.prepare(`
      UPDATE agent_runs
      SET next_event_sequence = next_event_sequence + 1
      WHERE id = ?
    `).run(runId);
    return event;
  };

  const ttlHours = Number(idempotencyTtlHours);
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 24 * 365) {
    throw new Error("idempotencyTtlHours must be between 1 and 8760.");
  }
  const idempotencyTtlMilliseconds = ttlHours * 60 * 60 * 1_000;

  const getIdempotencyRecord = (ownerUserId, method, routePattern, key) => {
    const row = db.prepare(`
      SELECT * FROM idempotency_records
      WHERE owner_user_id = ?
        AND method = ?
        AND route_pattern = ?
        AND idempotency_key = ?
        AND expires_at > ?
    `).get(ownerUserId, method, routePattern, key, nowIso());
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      statusCode: row.status_code,
      response: parseJson(row.response_json),
      headers: parseJson(row.response_headers_json, {}),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  };

  const saveIdempotencyRecord = ({
    ownerUserId,
    method,
    routePattern,
    key,
    requestHash,
    statusCode,
    response,
    headers = {}
  }) => {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + idempotencyTtlMilliseconds).toISOString();
    db.prepare(`
      INSERT INTO idempotency_records
        (owner_user_id, method, route_pattern, idempotency_key, request_hash,
         status_code, response_json, response_headers_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ownerUserId,
      method,
      routePattern,
      key,
      requestHash,
      statusCode,
      JSON.stringify(response),
      JSON.stringify(headers),
      createdAt,
      expiresAt
    );
  };

  db.prepare("DELETE FROM idempotency_records WHERE expires_at <= ?").run(nowIso());

  return {
    db,
    schemaVersion,
    close() {
      db.close();
    },
    transaction,
    checkHealth() {
      const database = db.prepare("SELECT 1 AS ok").get();
      const quickCheck = db.prepare("PRAGMA quick_check").get()?.quick_check;
      return {
        ok: database?.ok === 1 && quickCheck === "ok",
        schemaVersion,
        quickCheck,
        journalMode: db.prepare("PRAGMA journal_mode").get()?.journal_mode ?? "unknown"
      };
    },
    listPlaces() {
      return db.prepare("SELECT document_json FROM places ORDER BY id").all()
        .map((row) => parseJson(row.document_json));
    },
    getPlace(placeId) {
      const row = db.prepare("SELECT document_json FROM places WHERE id = ?").get(placeId);
      return row ? parseJson(row.document_json) : null;
    },
    listRoutes() {
      return db.prepare("SELECT document_json FROM routes ORDER BY id").all()
        .map((row) => parseJson(row.document_json));
    },
    getRoute(routeId) {
      const row = db.prepare("SELECT document_json FROM routes WHERE id = ?").get(routeId);
      return row ? parseJson(row.document_json) : null;
    },
    listImports(ownerUserId = "demo-user", { limit = 20, offset = 0 } = {}) {
      const rows = db.prepare(`
        SELECT * FROM imports
        WHERE owner_user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(ownerUserId, limit, offset);
      const total = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM imports WHERE owner_user_id = ?
      `).get(ownerUserId).count);
      return {
        items: rows.map((row) => ({
          importId: row.id,
          status: row.status,
          source: parseJson(row.source_json),
          extraction: parseJson(row.extraction_json),
          warnings: parseJson(row.warnings_json, [])
        })),
        total
      };
    },
    createImport(record, ownerUserId = "demo-user") {
      db.prepare(`
        INSERT INTO imports
          (id, owner_user_id, share_url, status, source_json, extraction_json,
           warnings_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.importId,
        ownerUserId,
        record.source.sourceUrl,
        record.status,
        JSON.stringify(record.source),
        JSON.stringify(record.extraction),
        JSON.stringify(record.warnings),
        record.source.capturedAt
      );
      return record;
    },
    getImport(importId, ownerUserId = "demo-user") {
      const row = db.prepare(`
        SELECT * FROM imports WHERE id = ? AND owner_user_id = ?
      `).get(importId, ownerUserId);
      if (!row) return null;
      return {
        importId: row.id,
        status: row.status,
        source: parseJson(row.source_json),
        extraction: parseJson(row.extraction_json),
        warnings: parseJson(row.warnings_json, [])
      };
    },
    listTrips(ownerUserId = "demo-user", { status = null, limit = 20, offset = 0 } = {}) {
      const where = status
        ? "owner_user_id = ? AND status = ?"
        : "owner_user_id = ?";
      const parameters = status
        ? [ownerUserId, status, limit, offset]
        : [ownerUserId, limit, offset];
      const rows = db.prepare(`
        SELECT * FROM trips
        WHERE ${where}
        ORDER BY updated_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(...parameters);
      const countParameters = status ? [ownerUserId, status] : [ownerUserId];
      const total = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM trips WHERE ${where}
      `).get(...countParameters).count);
      return {
        items: rows.map((row) => {
          const trip = rowToTrip(db, row);
          return {
            tripId: trip.tripId,
            title: trip.title,
            city: trip.city,
            timezone: trip.timezone,
            status: trip.status,
            sourceImportId: trip.sourceImportId,
            sourceUrl: trip.sourceUrl,
            source: trip.source,
            revisionId: trip.revisionId,
            revision: trip.revision,
            stopCount: trip.stops.length,
            firstStop: trip.stops[0] ?? null,
            savedAt: trip.savedAt,
            createdAt: trip.createdAt
          };
        }),
        total
      };
    },
    createTrip({
      tripId,
      ownerUserId = "demo-user",
      title,
      city,
      timezone,
      status,
      sourceImportId,
      sourceUrl,
      source = {},
      plannerState = { constraints: [], transportModeOverrides: {} },
      stops
    }) {
      return transaction(() => {
        const createdAt = nowIso();
        const revisionId = `rev-${randomUUID()}`;
        db.prepare(`
          INSERT INTO trips
            (id, owner_user_id, title, city, timezone, status, source_import_id,
             source_url, source_json, current_revision_id, current_revision_no,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          tripId,
          ownerUserId,
          title,
          city,
          timezone,
          status,
          sourceImportId ?? null,
          sourceUrl ?? null,
          JSON.stringify(source ?? {}),
          revisionId,
          createdAt,
          createdAt
        );
        insertRevision({
          tripId,
          revisionId,
          revisionNo: 1,
          parentRevisionId: null,
          reason: "TRIP_CREATED",
          plannerState,
          stops,
          createdAt
        });
        return getTrip(tripId, ownerUserId);
      });
    },
    getTrip,
    getTripRevision(tripId, revisionId, ownerUserId = "demo-user") {
      const tripRow = db.prepare(`
        SELECT * FROM trips WHERE id = ? AND owner_user_id = ?
      `).get(tripId, ownerUserId);
      if (!tripRow) return null;
      const revisionRow = db.prepare(`
        SELECT * FROM trip_revisions WHERE id = ? AND trip_id = ?
      `).get(revisionId, tripId);
      return revisionRow ? rowToTrip(db, tripRow, revisionRow) : null;
    },
    listTripRevisions(tripId, ownerUserId = "demo-user", { limit = 20, offset = 0 } = {}) {
      const trip = getTrip(tripId, ownerUserId);
      if (!trip) return null;
      const items = db.prepare(`
        SELECT id AS revisionId, revision_no AS revision, parent_revision_id AS parentRevisionId,
               reason, created_at AS createdAt
        FROM trip_revisions
        WHERE trip_id = ?
        ORDER BY revision_no DESC
        LIMIT ? OFFSET ?
      `).all(tripId, limit, offset).map((revision) => ({
        ...revision,
        isCurrent: revision.revisionId === trip.revisionId
      }));
      const total = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM trip_revisions WHERE trip_id = ?
      `).get(tripId).count);
      return { items, total };
    },
    saveSchedule(input) {
      return transaction(() => saveScheduleInsideTransaction(input));
    },
    createQueuedAgentRun({
      runId,
      tripId,
      ownerUserId = "demo-user",
      baseRevisionId,
      instruction,
      provider,
      model = null
    }) {
      return transaction(() => {
        const trip = getTrip(tripId, ownerUserId);
        if (!trip) return null;
        if (trip.revisionId !== baseRevisionId) throw new RevisionConflictError(trip);
        const activeRow = db.prepare(`
          SELECT * FROM agent_runs
          WHERE trip_id = ? AND status IN (
            'QUEUED', 'PLANNING', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED',
            'RESUMING', 'STOP_REQUESTED', 'UNDOING'
          )
          LIMIT 1
        `).get(tripId);
        if (activeRow) {
          return { run: null, activeRun: rowToAgentRun(db, activeRow) };
        }
        const createdAt = nowIso();
        db.prepare(`
          INSERT INTO agent_runs
            (id, trip_id, owner_user_id, base_revision_id, current_revision_id,
             result_revision_id, status, instruction, scenario, operations_json,
             provider, model, provider_response_id, summary, error_code, error_message,
             run_version, next_event_sequence, created_at, updated_at, started_at,
             completed_at)
          VALUES (
            ?, ?, ?, ?, ?, NULL, 'QUEUED', ?, NULL, '[]',
            ?, ?, NULL, NULL, NULL, NULL,
            1, 1, ?, ?, NULL, NULL
          )
        `).run(
          runId,
          tripId,
          ownerUserId,
          baseRevisionId,
          baseRevisionId,
          instruction,
          provider,
          model,
          createdAt,
          createdAt
        );
        appendAgentEventInsideTransaction(runId, "run.queued", {
          status: "QUEUED",
          baseRevisionId
        }, createdAt);
        return { run: rowToAgentRun(db, getAgentRunRow(runId)), activeRun: null };
      });
    },
    getAgentRun(runId, ownerUserId = "demo-user") {
      return rowToAgentRun(db, getAgentRunRow(runId, ownerUserId));
    },
    getAgentRunInternal(runId) {
      return rowToAgentRun(db, getAgentRunRow(runId));
    },
    listAgentRuns(tripId, ownerUserId = "demo-user", { limit = 20, offset = 0 } = {}) {
      if (!getTrip(tripId, ownerUserId)) return null;
      const items = db.prepare(`
        SELECT * FROM agent_runs
        WHERE trip_id = ? AND owner_user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(tripId, ownerUserId, limit, offset).map((row) => rowToAgentRun(db, row));
      const total = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM agent_runs
        WHERE trip_id = ? AND owner_user_id = ?
      `).get(tripId, ownerUserId).count);
      return { items, total };
    },
    listAgentEvents(
      runId,
      ownerUserId = "demo-user",
      { after = 0, limit = 100 } = {}
    ) {
      const run = getAgentRunRow(runId, ownerUserId);
      if (!run) return null;
      const events = db.prepare(`
        SELECT id, run_id, sequence, type, payload_json, created_at
        FROM agent_events
        WHERE run_id = ? AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `).all(runId, after, limit).map((row) => ({
        eventId: row.id,
        runId: row.run_id,
        sequence: row.sequence,
        type: row.type,
        payload: parseJson(row.payload_json, {}),
        createdAt: row.created_at
      }));
      return {
        runId,
        run: rowToAgentRun(db, run),
        events,
        nextCursor: events.at(-1)?.sequence ?? after,
        hasMore: events.length === limit,
        terminal: [
          "STOPPED", "COMPLETED", "FAILED", "CONFLICTED", "UNDONE"
        ].includes(run.status)
      };
    },
    listRecoverableAgentRuns() {
      return db.prepare(`
        SELECT * FROM agent_runs
        WHERE status IN (
          'QUEUED', 'PLANNING', 'RUNNING', 'PAUSE_REQUESTED',
          'RESUMING', 'STOP_REQUESTED'
        )
        ORDER BY created_at ASC
      `).all().map((row) => rowToAgentRun(db, row));
    },
    transitionAgentRun({
      runId,
      fromStatuses,
      toStatus,
      eventType = "run.status_changed",
      eventPayload = {},
      summary = null,
      errorCode = null,
      errorMessage = null
    }) {
      return transaction(() => {
        const row = getAgentRunRow(runId);
        if (!row) return null;
        if (fromStatuses && !fromStatuses.includes(row.status)) {
          return { transitioned: false, run: rowToAgentRun(db, row) };
        }
        const updatedAt = nowIso();
        const terminal = ["STOPPED", "COMPLETED", "FAILED", "CONFLICTED", "UNDONE"]
          .includes(toStatus);
        db.prepare(`
          UPDATE agent_runs
          SET status = ?,
              summary = COALESCE(?, summary),
              error_code = ?,
              error_message = ?,
              run_version = run_version + 1,
              updated_at = ?,
              started_at = CASE
                WHEN ? IN ('PLANNING', 'RUNNING', 'RESUMING')
                  THEN COALESCE(started_at, ?)
                ELSE started_at
              END,
              completed_at = CASE WHEN ? THEN ? ELSE completed_at END
          WHERE id = ?
        `).run(
          toStatus,
          summary,
          errorCode,
          errorMessage,
          updatedAt,
          toStatus,
          updatedAt,
          terminal ? 1 : 0,
          terminal ? updatedAt : null,
          runId
        );
        appendAgentEventInsideTransaction(runId, eventType, {
          fromStatus: row.status,
          status: toStatus,
          ...eventPayload
        }, updatedAt);
        return {
          transitioned: true,
          run: rowToAgentRun(db, getAgentRunRow(runId))
        };
      });
    },
    requestAgentCommand(
      runId,
      ownerUserId = "demo-user",
      command,
      { baseRevisionId = null } = {}
    ) {
      return transaction(() => {
        const row = getAgentRunRow(runId, ownerUserId);
        if (!row) return null;
        const terminalStatuses = new Set([
          "STOPPED", "COMPLETED", "FAILED", "CONFLICTED", "UNDONE"
        ]);
        let targetStatus = null;
        if (command === "pause") {
          if (row.status === "PAUSED" || row.status === "PAUSE_REQUESTED") {
            return { accepted: true, run: rowToAgentRun(db, row) };
          }
          if (["QUEUED", "PLANNING", "RUNNING", "RESUMING"].includes(row.status)) {
            targetStatus = "PAUSE_REQUESTED";
          }
        } else if (command === "resume") {
          if (row.status === "RESUMING") {
            return { accepted: true, run: rowToAgentRun(db, row) };
          }
          if (row.status === "PAUSED") {
            const trip = getTrip(row.trip_id, ownerUserId);
            if (baseRevisionId && trip.revisionId !== baseRevisionId) {
              throw new RevisionConflictError(trip);
            }
            if (trip.revisionId !== row.current_revision_id && !baseRevisionId) {
              return {
                accepted: false,
                code: "AGENT_RESUME_REVISION_REQUIRED",
                run: rowToAgentRun(db, row)
              };
            }
            if (trip.revisionId !== row.current_revision_id) {
              const rebasedAt = nowIso();
              const discardedOperationRows = db.prepare(`
                SELECT * FROM agent_operations
                WHERE run_id = ? AND status = 'PENDING'
                ORDER BY sequence ASC
              `).all(runId);
              db.prepare(`
                UPDATE agent_operations
                SET status = 'REJECTED',
                    output_json = ?,
                    error_json = ?,
                    updated_at = ?
                WHERE run_id = ? AND status = 'PENDING'
              `).run(
                JSON.stringify({
                  ok: false,
                  error: { code: "AGENT_REBASED", message: "Operation discarded during resume." }
                }),
                JSON.stringify({
                  code: "AGENT_REBASED",
                  message: "Operation discarded during resume."
                }),
                rebasedAt,
                runId
              );
              for (const discardedRow of discardedOperationRows) {
                const discardedOperation = rowToAgentOperation(
                  db.prepare(`
                    SELECT * FROM agent_operations WHERE id = ?
                  `).get(discardedRow.id)
                );
                appendAgentEventInsideTransaction(
                  runId,
                  "operation.rejected",
                  {
                    operation: operationForEvent(
                      discardedOperation,
                      trip,
                      "REJECTED"
                    ),
                    error: {
                      code: "AGENT_REBASED",
                      message: "Operation discarded during resume."
                    },
                    trip: agentTripSnapshot(trip)
                  },
                  rebasedAt
                );
              }
              db.prepare(`
                UPDATE agent_runs
                SET current_revision_id = ?, result_revision_id = ?,
                    provider_lineage = provider_lineage + 1,
                    provider_response_id = NULL, provider_conversation_json = NULL,
                    updated_at = ?
                WHERE id = ?
              `).run(trip.revisionId, trip.revisionId, rebasedAt, runId);
              appendAgentEventInsideTransaction(runId, "run.rebased", {
                fromRevisionId: row.current_revision_id,
                revisionId: trip.revisionId,
                trip: agentTripSnapshot(trip)
              }, rebasedAt);
            }
            targetStatus = "RESUMING";
          }
        } else if (command === "stop") {
          if (row.status === "STOPPED" || row.status === "STOP_REQUESTED") {
            return { accepted: true, run: rowToAgentRun(db, row) };
          }
          if (["QUEUED", "PAUSED"].includes(row.status)) targetStatus = "STOPPED";
          else if (!terminalStatuses.has(row.status) && row.status !== "UNDOING") {
            targetStatus = "STOP_REQUESTED";
          }
        }
        if (!targetStatus) {
          return {
            accepted: false,
            code: "INVALID_AGENT_COMMAND",
            run: rowToAgentRun(db, row)
          };
        }
        const updatedAt = nowIso();
        const isStopped = targetStatus === "STOPPED";
        db.prepare(`
          UPDATE agent_runs
          SET status = ?, run_version = run_version + 1, updated_at = ?,
              completed_at = CASE WHEN ? THEN ? ELSE completed_at END
          WHERE id = ?
        `).run(targetStatus, updatedAt, isStopped ? 1 : 0, isStopped ? updatedAt : null, runId);
        appendAgentEventInsideTransaction(runId, `run.${command}_requested`, {
          fromStatus: row.status,
          status: targetStatus
        }, updatedAt);
        if (isStopped) {
          appendAgentEventInsideTransaction(runId, "run.stopped", {
            status: "STOPPED"
          }, updatedAt);
        }
        return {
          accepted: true,
          run: rowToAgentRun(db, getAgentRunRow(runId))
        };
      });
    },
    settleAgentBoundary(runId) {
      return transaction(() => {
        const row = getAgentRunRow(runId);
        if (!row) return null;
        let targetStatus = null;
        let eventType = null;
        if (row.status === "PAUSE_REQUESTED") {
          targetStatus = "PAUSED";
          eventType = "run.paused";
        } else if (row.status === "STOP_REQUESTED") {
          targetStatus = "STOPPED";
          eventType = "run.stopped";
        } else if (row.status === "RESUMING") {
          targetStatus = "RUNNING";
          eventType = "run.resumed";
        }
        if (!targetStatus) return rowToAgentRun(db, row);
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_runs
          SET status = ?, run_version = run_version + 1, updated_at = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = CASE WHEN ? = 'STOPPED' THEN ? ELSE completed_at END
          WHERE id = ?
        `).run(targetStatus, updatedAt, updatedAt, targetStatus, updatedAt, runId);
        appendAgentEventInsideTransaction(runId, eventType, {
          fromStatus: row.status,
          status: targetStatus
        }, updatedAt);
        return rowToAgentRun(db, getAgentRunRow(runId));
      });
    },
    recordAgentOperation({
      runId,
      providerCallId,
      toolName,
      arguments: operationArguments,
      providerResponseId,
      providerConversationState
    }) {
      return transaction(() => {
        const runRow = getAgentRunRow(runId);
        if (!runRow) return null;
        const existing = db.prepare(`
          SELECT * FROM agent_operations
          WHERE run_id = ? AND provider_lineage = ? AND provider_call_id = ?
        `).get(runId, runRow.provider_lineage, providerCallId);
        if (existing) return rowToAgentOperation(existing);
        const createdAt = nowIso();
        const sequence = Number(db.prepare(`
          SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
          FROM agent_operations WHERE run_id = ?
        `).get(runId).next_sequence);
        const operationId = `agent-op-${randomUUID()}`;
        db.prepare(`
          INSERT INTO agent_operations (
            id, run_id, sequence, provider_lineage, provider_call_id, tool_name,
            arguments_json, status, base_revision_id, result_revision_id,
            output_json, error_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NULL, NULL, NULL, ?, ?)
        `).run(
          operationId,
          runId,
          sequence,
          runRow.provider_lineage,
          providerCallId,
          toolName,
          JSON.stringify(operationArguments),
          runRow.current_revision_id,
          createdAt,
          createdAt
        );
        db.prepare(`
          UPDATE agent_runs
          SET status = CASE
                WHEN status IN ('PLANNING', 'RESUMING') THEN 'RUNNING'
                ELSE status
              END,
              provider_response_id = ?,
              provider_conversation_json = ?,
              run_version = run_version + 1,
              updated_at = ?,
              started_at = COALESCE(started_at, ?)
          WHERE id = ?
        `).run(
          providerResponseId ?? null,
          providerConversationState == null
            ? runRow.provider_conversation_json ?? null
            : JSON.stringify(providerConversationState),
          createdAt,
          createdAt,
          runId
        );
        const recordedOperation = rowToAgentOperation(db.prepare(`
          SELECT * FROM agent_operations WHERE id = ?
        `).get(operationId));
        const trip = getTrip(runRow.trip_id, runRow.owner_user_id);
        appendAgentEventInsideTransaction(runId, "operation.started", {
          operation: operationForEvent(recordedOperation, trip, "RUNNING")
        }, createdAt);
        return recordedOperation;
      });
    },
    getPendingAgentOperation(runId) {
      return rowToAgentOperation(db.prepare(`
        SELECT * FROM agent_operations
        WHERE run_id = ? AND status = 'PENDING'
        ORDER BY sequence ASC
        LIMIT 1
      `).get(runId));
    },
    rejectAgentOperation(runId, operationId, error, output) {
      return transaction(() => {
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_operations
          SET status = 'REJECTED', output_json = ?, error_json = ?, updated_at = ?
          WHERE id = ? AND run_id = ? AND status = 'PENDING'
        `).run(
          JSON.stringify(output ?? null),
          JSON.stringify(error ?? null),
          updatedAt,
          operationId,
          runId
        );
        const rejectedOperation = rowToAgentOperation(db.prepare(`
          SELECT * FROM agent_operations WHERE id = ? AND run_id = ?
        `).get(operationId, runId));
        appendAgentEventInsideTransaction(runId, "operation.failed", {
          operation: operationForEvent(rejectedOperation, null, "FAILED"),
          error
        }, updatedAt);
        return rejectedOperation;
      });
    },
    applyAgentOperation({
      runId,
      operationId,
      stops,
      output,
      reason,
      plannerState = null,
      derivedConstraints = null
    }) {
      return transaction(() => {
        const runRow = getAgentRunRow(runId);
        if (!runRow) return null;
        const trip = getTrip(runRow.trip_id, runRow.owner_user_id);
        if (!trip) return null;
        if (trip.revisionId !== runRow.current_revision_id) {
          const updatedAt = nowIso();
          db.prepare(`
            UPDATE agent_operations
            SET status = 'FAILED', error_json = ?, updated_at = ?
            WHERE id = ? AND run_id = ? AND status = 'PENDING'
          `).run(
            JSON.stringify({
              code: "REVISION_CONFLICT",
              currentRevisionId: trip.revisionId
            }),
            updatedAt,
            operationId,
            runId
          );
          db.prepare(`
            UPDATE agent_runs
            SET status = 'CONFLICTED', error_code = 'REVISION_CONFLICT',
                error_message = ?, run_version = run_version + 1,
                updated_at = ?, completed_at = ?
            WHERE id = ?
          `).run(
            "The trip changed outside this Agent run.",
            updatedAt,
            updatedAt,
            runId
          );
          appendAgentEventInsideTransaction(runId, "run.conflicted", {
            expectedRevisionId: runRow.current_revision_id,
            currentRevisionId: trip.revisionId
          }, updatedAt);
          return {
            conflicted: true,
            trip,
            run: rowToAgentRun(db, getAgentRunRow(runId))
          };
        }
        const nextTrip = saveScheduleInsideTransaction({
          tripId: runRow.trip_id,
          ownerUserId: runRow.owner_user_id,
          baseRevisionId: runRow.current_revision_id,
          stops,
          plannerState,
          reason
        });
        const providerOutput = {
          ...(output ?? {}),
          revisionId: nextTrip.revisionId,
          revision: nextTrip.revision,
          derivedConstraints,
          trip: agentTripSnapshot(nextTrip)
        };
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_operations
          SET status = 'APPLIED', result_revision_id = ?, output_json = ?,
              error_json = NULL, updated_at = ?
          WHERE id = ? AND run_id = ? AND status = 'PENDING'
        `).run(
          nextTrip.revisionId,
          JSON.stringify(providerOutput),
          updatedAt,
          operationId,
          runId
        );
        db.prepare(`
          UPDATE agent_runs
          SET status = 'RUNNING', current_revision_id = ?, result_revision_id = ?,
              run_version = run_version + 1, updated_at = ?
          WHERE id = ?
        `).run(nextTrip.revisionId, nextTrip.revisionId, updatedAt, runId);
        const appliedOperation = rowToAgentOperation(db.prepare(`
          SELECT * FROM agent_operations WHERE id = ?
        `).get(operationId));
        appendAgentEventInsideTransaction(runId, "operation.applied", {
          operation: operationForEvent(appliedOperation, nextTrip),
          revisionId: nextTrip.revisionId,
          revision: nextTrip.revision,
          trip: agentTripSnapshot(nextTrip)
        }, updatedAt);
        return {
          conflicted: false,
          trip: nextTrip,
          operation: appliedOperation,
          run: rowToAgentRun(db, getAgentRunRow(runId))
        };
      });
    },
    completeAgentRun(
      runId,
      operationId,
      summary,
      output,
      { plannerState = null, derivedConstraints = null } = {}
    ) {
      return transaction(() => {
        const row = getAgentRunRow(runId);
        if (!row) return null;
        const currentTrip = getTrip(row.trip_id, row.owner_user_id);
        if (!currentTrip) return null;
        const completedTrip = (
          plannerState &&
          JSON.stringify(plannerState) !== JSON.stringify(currentTrip.plannerState)
        )
          ? saveScheduleInsideTransaction({
              tripId: row.trip_id,
              ownerUserId: row.owner_user_id,
              baseRevisionId: row.current_revision_id,
              stops: currentTrip.stops,
              plannerState,
              reason: "AGENT_DERIVED_CONSTRAINTS"
            })
          : currentTrip;
        const providerOutput = {
          ...(output ?? {}),
          revisionId: completedTrip.revisionId,
          revision: completedTrip.revision,
          derivedConstraints,
          trip: agentTripSnapshot(completedTrip)
        };
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_operations
          SET status = 'APPLIED', result_revision_id = ?,
              output_json = ?, error_json = NULL, updated_at = ?
          WHERE id = ? AND run_id = ? AND status = 'PENDING'
        `).run(
          completedTrip.revisionId,
          JSON.stringify(providerOutput),
          updatedAt,
          operationId,
          runId
        );
        const completedOperation = rowToAgentOperation(db.prepare(`
          SELECT * FROM agent_operations WHERE id = ?
        `).get(operationId));
        appendAgentEventInsideTransaction(runId, "operation.applied", {
          operation: operationForEvent(completedOperation, completedTrip),
          revisionId: completedTrip.revisionId,
          revision: completedTrip.revision,
          terminal: true,
          trip: agentTripSnapshot(completedTrip)
        }, updatedAt);
        db.prepare(`
          UPDATE agent_runs
          SET status = 'COMPLETED', current_revision_id = ?, result_revision_id = ?,
              summary = ?, error_code = NULL, error_message = NULL,
              run_version = run_version + 1, updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(
          completedTrip.revisionId,
          completedTrip.revisionId,
          summary,
          updatedAt,
          updatedAt,
          runId
        );
          appendAgentEventInsideTransaction(runId, "run.completed", {
            status: "COMPLETED",
            resultRevisionId: completedTrip.revisionId,
            revisionId: completedTrip.revisionId,
            revision: completedTrip.revision,
            summary,
            trip: agentTripSnapshot(completedTrip)
          }, updatedAt);
        return rowToAgentRun(db, getAgentRunRow(runId));
      });
    },
    failAgentRun(runId, errorCode, errorMessage) {
      return transaction(() => {
        const row = getAgentRunRow(runId);
        if (!row) return null;
        if (["STOPPED", "COMPLETED", "CONFLICTED", "UNDONE"].includes(row.status)) {
          return rowToAgentRun(db, row);
        }
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_runs
          SET status = 'FAILED', error_code = ?, error_message = ?,
              run_version = run_version + 1, updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(errorCode, errorMessage, updatedAt, updatedAt, runId);
        db.prepare(`
          UPDATE agent_operations
          SET status = 'FAILED', error_json = ?, updated_at = ?
          WHERE run_id = ? AND status = 'PENDING'
        `).run(JSON.stringify({ code: errorCode, message: errorMessage }), updatedAt, runId);
        appendAgentEventInsideTransaction(runId, "run.failed", {
          status: "FAILED",
          error: { code: errorCode, message: errorMessage }
        }, updatedAt);
        return rowToAgentRun(db, getAgentRunRow(runId));
      });
    },
    undoAgentRun(runId, ownerUserId = "demo-user", expectedRevisionId) {
      return transaction(() => {
        const row = getAgentRunRow(runId, ownerUserId);
        if (!row) return null;
        if (!["COMPLETED", "STOPPED", "FAILED", "CONFLICTED"].includes(row.status)) {
          return {
            accepted: false,
            code: "AGENT_RUN_NOT_UNDOABLE",
            run: rowToAgentRun(db, row)
          };
        }
        const currentTrip = getTrip(row.trip_id, ownerUserId);
        if (currentTrip.revisionId !== expectedRevisionId) {
          throw new RevisionConflictError(currentTrip);
        }
        if (currentTrip.revisionId !== row.current_revision_id) {
          return {
            accepted: false,
            code: "AGENT_UNDO_CONFLICT",
            run: rowToAgentRun(db, row),
            trip: currentTrip
          };
        }
        const runBeforeUndo = rowToAgentRun(db, row);
        const revisionCache = new Map();
        const loadRevision = (revisionId) => {
          if (!revisionId) return null;
          if (!revisionCache.has(revisionId)) {
            revisionCache.set(
              revisionId,
              this.getTripRevision(
                row.trip_id,
                revisionId,
                ownerUserId
              )
            );
          }
          return revisionCache.get(revisionId);
        };
        const inverse = reverseAppliedAgentOperations({
          currentTrip,
          operations: runBeforeUndo.operations,
          loadRevision
        });
        const updatedAt = nowIso();
        db.prepare(`
          UPDATE agent_runs
          SET status = 'UNDOING', run_version = run_version + 1, updated_at = ?
          WHERE id = ?
        `).run(updatedAt, runId);
        appendAgentEventInsideTransaction(runId, "run.undoing", {
          status: "UNDOING",
          expectedRevisionId
        }, updatedAt);
        const restoredTrip = saveScheduleInsideTransaction({
          tripId: row.trip_id,
          ownerUserId,
          baseRevisionId: currentTrip.revisionId,
          stops: inverse.stops,
          plannerState: inverse.plannerState,
          reason: `AGENT_UNDO_${runId}`
        });
        const completedAt = nowIso();
        db.prepare(`
          UPDATE agent_runs
          SET status = 'UNDONE', current_revision_id = ?, result_revision_id = ?,
              run_version = run_version + 1, updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(
          restoredTrip.revisionId,
          restoredTrip.revisionId,
          completedAt,
          completedAt,
          runId
        );
        appendAgentEventInsideTransaction(runId, "undo.applied", {
          status: "UNDONE",
          revisionId: restoredTrip.revisionId,
          revision: restoredTrip.revision,
          trip: agentTripSnapshot(restoredTrip),
          revertedOperationIds: inverse.revertedOperationIds,
          preservedOperations: inverse.preservedOperations,
          removedConstraintIds: inverse.removedConstraintIds
        }, completedAt);
        return {
          accepted: true,
          run: rowToAgentRun(db, getAgentRunRow(runId)),
          trip: restoredTrip,
          undo: {
            revertedOperationIds: inverse.revertedOperationIds,
            preservedOperations: inverse.preservedOperations,
            removedConstraintIds: inverse.removedConstraintIds
          }
        };
      });
    },
    addExecutionEvent(event) {
      db.prepare(`
        INSERT INTO execution_events
          (id, trip_id, type, client_stop_id, occurred_at, payload_json, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        event.tripId,
        event.type,
        event.clientStopId ?? null,
        event.occurredAt,
        JSON.stringify(event.payload ?? {}),
        event.recordedAt
      );
      return event;
    },
    listExecutionEvents(
      tripId,
      ownerUserId = "demo-user",
      { limit = null, offset = 0 } = {}
    ) {
      if (!getTrip(tripId, ownerUserId)) return null;
      const pagination = limit == null ? "" : "LIMIT ? OFFSET ?";
      const parameters = limit == null ? [tripId] : [tripId, limit, offset];
      return db.prepare(`
        SELECT * FROM execution_events
        WHERE trip_id = ?
        ORDER BY occurred_at, recorded_at
        ${pagination}
      `).all(...parameters).map((row) => ({
        eventId: row.id,
        tripId: row.trip_id,
        type: row.type,
        clientStopId: row.client_stop_id,
        occurredAt: row.occurred_at,
        payload: parseJson(row.payload_json, {}),
        recordedAt: row.recorded_at
      }));
    },
    countExecutionEvents(tripId, ownerUserId = "demo-user") {
      if (!getTrip(tripId, ownerUserId)) return null;
      return Number(db.prepare(`
        SELECT COUNT(*) AS count FROM execution_events WHERE trip_id = ?
      `).get(tripId).count);
    },
    addBookingRedirect(record) {
      db.prepare(`
        INSERT INTO booking_redirects
          (id, trip_id, booking_option_id, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        record.redirectId,
        record.tripId,
        record.bookingOptionId,
        record.status,
        record.createdAt
      );
      return record;
    },
    getIdempotencyRecord,
    saveIdempotencyRecord,
    executeIdempotently(input, work) {
      return transaction(() => {
        const replay = getIdempotencyRecord(
          input.ownerUserId,
          input.method,
          input.routePattern,
          input.key
        );
        if (replay) {
          if (replay.requestHash !== input.requestHash) throw new IdempotencyConflictError();
          return { replayed: true, result: replay };
        }

        const result = work();
        if (result && typeof result.then === "function") {
          throw new Error(
            "Idempotent mutation handlers must be synchronous. Use an outbox for external async work."
          );
        }
        saveIdempotencyRecord({
          ...input,
          statusCode: result.status,
          response: result.body,
          headers: result.headers ?? {}
        });
        return { replayed: false, result };
      });
    },
    cleanupExpiredIdempotencyRecords() {
      return db.prepare("DELETE FROM idempotency_records WHERE expires_at <= ?").run(nowIso()).changes;
    }
  };
}
