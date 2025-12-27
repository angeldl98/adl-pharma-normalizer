import { Pool } from "pg";

const pool = new Pool({
  host: process.env.PGHOST || process.env.POSTGRES_HOST || "postgres",
  user: process.env.PGUSER || process.env.POSTGRES_USER || "adl",
  password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "",
  database: process.env.PGDATABASE || process.env.POSTGRES_DB || "adl_core",
  port: Number(process.env.PGPORT || "5432")
});

function clean(val) {
  if (val === undefined || val === null) return null;
  return val.toString().trim();
}

function msToIso(ms) {
  if (!ms && ms !== 0) return null;
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function computeEstadoNorm(raw) {
  const susp = raw.estado_susp;
  const rev = raw.estado_rev;
  const aut = raw.estado_aut;
  // Prioridad: REV (retirado) > SUSPENDIDO > ACTIVO
  if (rev) return { estado_norm: "RETIRADA", fecha_estado: msToIso(rev), estado_aemps: "RETIRADO" };
  if (susp) return { estado_norm: "SUSPENDIDA", fecha_estado: msToIso(susp), estado_aemps: "SUSPENDIDO" };
  return { estado_norm: "ACTIVA", fecha_estado: msToIso(aut), estado_aemps: "AUTORIZADO" };
}

async function ensureTables(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS pharma_norm`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS pharma_norm.medicamentos (
      id SERIAL PRIMARY KEY,
      raw_id INT UNIQUE,
      codigo_nacional TEXT,
      nombre_medicamento TEXT,
      laboratorio TEXT,
      estado_aemps TEXT,
      fecha_estado TIMESTAMPTZ,
      estado_norm TEXT,
      checksum TEXT UNIQUE,
      normalized_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function loadPending(client) {
  const res = await client.query(`
    SELECT id, nregistro, nombre, labtitular, labcomercializador, comerc, estado_aut, estado_rev, estado_susp, checksum, payload
    FROM pharma_raw.medicamentos r
    WHERE NOT EXISTS (
      SELECT 1 FROM pharma_norm.medicamentos n WHERE n.raw_id = r.id
    )
  `);
  return res.rows;
}

async function insertNormalized(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const { estado_norm, fecha_estado, estado_aemps } = computeEstadoNorm(row);
    const laboratorio = clean(row.labtitular) || clean(row.labcomercializador);
    await client.query(
      `
        INSERT INTO pharma_norm.medicamentos
          (raw_id, codigo_nacional, nombre_medicamento, laboratorio, estado_aemps, fecha_estado, estado_norm, checksum, normalized_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
        ON CONFLICT (raw_id) DO NOTHING
      `,
      [
        row.id,
        clean(row.nregistro),
        clean(row.nombre),
        laboratorio,
        estado_aemps,
        fecha_estado,
        estado_norm,
        row.checksum || null
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function main() {
  console.log("[info] PHARMA_NORM_START");
  const client = await pool.connect();
  try {
    await ensureTables(client);
    const pending = await loadPending(client);
    console.log(`[info] pending=${pending.length}`);
    if (pending.length === 0) {
      console.log("[info] PHARMA_NORM_OK inserted=0");
      process.exit(0);
    }
    const inserted = await insertNormalized(client, pending);
    console.log(`[info] PHARMA_NORM_OK inserted=${inserted}`);
    process.exit(0);
  } catch (err) {
    console.error(`[error] PHARMA_NORM_FAIL ${err?.message || err}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`[error] PHARMA_NORM_FAIL ${err?.message || err}`);
  process.exit(1);
});

