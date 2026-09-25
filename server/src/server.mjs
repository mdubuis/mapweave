import cors from "@fastify/cors";
import Fastify from "fastify";
import mapsRoutes from "./routes/maps.mjs";
import wikiRoutes from "./routes/wiki.mjs";

const app = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 }); // Pack Cells exports can be tens of MB

// Local, single-user, no-auth tool (see MIGRATION.md) — the client (Vite dev server or a static
// build) always runs on a different origin than this API, so the browser blocks fetch() here
// without CORS headers even though curl/psql work fine. Open policy is fine given that threat model.
// @fastify/cors defaults `methods` to GET,HEAD,POST only — every route here was POST/GET/DELETE
// until wiki.mjs's PUT-based upserts, the first routes a real browser fetch() actually needed PUT
// (and DELETE, silently broken the same way until now) for.
await app.register(cors, { origin: true, methods: ["GET", "POST", "PUT", "DELETE"] });

await app.register(mapsRoutes);
await app.register(wikiRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
