const { createClient } = require("@supabase/supabase-js");

function assertConfig(value, label) {
  if (!value) {
    throw new Error(`${label} is required when STORAGE_DRIVER=supabase`);
  }
  return value;
}

function buildSessionRow(session) {
  return {
    session_id: session.sessionId,
    patient_id: session.patientId,
    body_region: session.bodyRegion,
    status: session.status,
    round: session.round,
    debounce_expires_at: session.debounceExpiresAt,
    session_data: session,
    created_at: session.createdAt,
    updated_at: session.updatedAt
  };
}

function mapSessionRow(row) {
  return row?.session_data || null;
}

function mapLedgerRow(row) {
  return {
    sessionId: row.session_id,
    type: row.type,
    payload: row.payload || {},
    at: row.at
  };
}

async function createSupabaseStore(config) {
  const client = createClient(assertConfig(config.supabaseUrl, "SUPABASE_URL"), assertConfig(config.supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: config.supabaseSchema
    }
  });

  const sessionsTable = config.supabaseSessionsTable;
  const ledgerTable = config.supabaseLedgerTable;

  return {
    kind: "supabase",
    async getSession(sessionId) {
      const { data, error } = await client.from(sessionsTable).select("session_data").eq("session_id", sessionId).maybeSingle();
      if (error) {
        throw new Error(`Supabase getSession failed: ${error.message}`);
      }
      return mapSessionRow(data);
    },
    async saveSession(session) {
      const { error } = await client.from(sessionsTable).upsert(buildSessionRow(session), { onConflict: "session_id" });
      if (error) {
        throw new Error(`Supabase saveSession failed: ${error.message}`);
      }
      return session;
    },
    async listSessions() {
      const { data, error } = await client.from(sessionsTable).select("session_data").order("updated_at", { ascending: false });
      if (error) {
        throw new Error(`Supabase listSessions failed: ${error.message}`);
      }
      return (data || []).map(mapSessionRow).filter(Boolean);
    },
    async findReusableSession({ patientId, bodyRegion = "knee", now = new Date() }) {
      const { data, error } = await client
        .from(sessionsTable)
        .select("session_data")
        .eq("patient_id", patientId)
        .eq("body_region", bodyRegion)
        .in("status", ["pending", "questioning"])
        .gte("debounce_expires_at", now.toISOString())
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(`Supabase findReusableSession failed: ${error.message}`);
      }

      return mapSessionRow(data?.[0]);
    },
    async appendLedgerEntry(sessionId, entry) {
      const { error } = await client.from(ledgerTable).insert({
        session_id: sessionId,
        type: entry.type,
        payload: entry.payload,
        at: entry.at
      });

      if (error) {
        throw new Error(`Supabase appendLedgerEntry failed: ${error.message}`);
      }

      return entry;
    },
    async getLedger(sessionId) {
      const { data, error } = await client
        .from(ledgerTable)
        .select("session_id, type, payload, at")
        .eq("session_id", sessionId)
        .order("sequence", { ascending: true });

      if (error) {
        throw new Error(`Supabase getLedger failed: ${error.message}`);
      }

      return (data || []).map(mapLedgerRow);
    }
  };
}

module.exports = {
  createSupabaseStore
};
