import { pool } from "../db.mjs";

/** @param {import('fastify').FastifyInstance} app */
export default async function wikiRoutes(app) {
  app.get("/api/maps/:id/wiki/pages", async (request, reply) => {
    const { rows: mapRows } = await pool.query("SELECT id FROM maps WHERE id = $1", [request.params.id]);
    if (!mapRows.length) return reply.code(404).send({ error: "Map not found" });

    const { rows } = await pool.query(
      `SELECT slug, type, title, raw, updated_at AS "updatedAt" FROM wiki_pages WHERE map_id = $1 ORDER BY title`,
      [request.params.id]
    );
    return rows;
  });

  app.get("/api/maps/:id/wiki/pages/:slug", async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT slug, type, title, raw, updated_at AS "updatedAt" FROM wiki_pages WHERE map_id = $1 AND slug = $2`,
      [request.params.id, request.params.slug]
    );
    if (!rows.length) return reply.code(404).send({ error: "Page not found" });
    return rows[0];
  });

  app.put("/api/maps/:id/wiki/pages/:slug", async (request, reply) => {
    const { rows: mapRows } = await pool.query("SELECT id FROM maps WHERE id = $1", [request.params.id]);
    if (!mapRows.length) return reply.code(404).send({ error: "Map not found" });

    const { title, type, raw } = request.body ?? {};
    if (typeof title !== "string" || typeof type !== "string" || typeof raw !== "string") {
      return reply.code(400).send({ error: "Body must include string fields `title`, `type`, and `raw`" });
    }

    const { rows } = await pool.query(
      `INSERT INTO wiki_pages (map_id, slug, type, title, raw)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id, slug) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title, raw = EXCLUDED.raw, updated_at = now()
       RETURNING slug, type, title, raw, updated_at AS "updatedAt"`,
      [request.params.id, request.params.slug, type, title, raw]
    );
    return rows[0];
  });

  app.delete("/api/maps/:id/wiki/pages/:slug", async (request, reply) => {
    const { rowCount } = await pool.query("DELETE FROM wiki_pages WHERE map_id = $1 AND slug = $2", [
      request.params.id,
      request.params.slug
    ]);
    if (!rowCount) return reply.code(404).send({ error: "Page not found" });
    return reply.code(204).send();
  });

  // Templates are global (not map_id-scoped) — see schema.sql's own comment on wiki_templates for why.
  app.get("/api/wiki/templates", async () => {
    const { rows } = await pool.query(
      `SELECT name, type, raw, updated_at AS "updatedAt" FROM wiki_templates ORDER BY name`
    );
    return rows;
  });

  app.put("/api/wiki/templates/:name", async (request, reply) => {
    const { type, raw } = request.body ?? {};
    if (typeof type !== "string" || typeof raw !== "string") {
      return reply.code(400).send({ error: "Body must include string fields `type` and `raw`" });
    }

    const { rows } = await pool.query(
      `INSERT INTO wiki_templates (name, type, raw)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, raw = EXCLUDED.raw, updated_at = now()
       RETURNING name, type, raw, updated_at AS "updatedAt"`,
      [request.params.name, type, raw]
    );
    return rows[0];
  });

  app.delete("/api/wiki/templates/:name", async (request, reply) => {
    const { rowCount } = await pool.query("DELETE FROM wiki_templates WHERE name = $1", [request.params.name]);
    if (!rowCount) return reply.code(404).send({ error: "Template not found" });
    return reply.code(204).send();
  });
}
