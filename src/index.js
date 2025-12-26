import { Pool } from "pg";

const pool = new Pool();

function clean(val) {
  if (!val) return null;
  return val.toString().trim();
}

function normalizeEstado(status) {
  const s = (status || "").toString().toLowerCase();
  if (s.includes("act")) return "ACTIVA";
  return "CERRADA";
}

async function ensureTables(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS pharma_norm`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS pharma_norm.farmacias (
      id SERIAL PRIMARY KEY,
      raw_id INT UNIQUE,
      name TEXT,
      address TEXT,
      municipality TEXT,
      province TEXT,
      status TEXT,
      estado_norm TEXT,
      checksum TEXT UNIQUE,
      normalized_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function loadPending(client) {
  const res = await client.query(`
    SELECT id, name, address, municipality, province, status, checksum
    FROM pharma_raw r
    WHERE NOT EXISTS (
      SELECT 1 FROM pharma_norm.farmacias n WHERE n.raw_id = r.id
    )
  `);
  return res.rows;
}

async function insertNormalized(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const estado_norm = normalizeEstado(row.status);
    await client.query(
      `
        INSERT INTO pharma_norm.farmacias
          (raw_id, name, address, municipality, province, status, estado_norm, checksum, normalized_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
        ON CONFLICT (raw_id) DO NOTHING
      `,
      [
        row.id,
        clean(row.name),
        clean(row.address),
        clean(row.municipality),
        clean(row.province),
        clean(row.status),
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

