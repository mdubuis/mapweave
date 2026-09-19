import cors from "@fastify/cors";
import Fastify from "fastify";
import mapsRoutes from "./routes/maps.mjs";

const app = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 }); // Pack Cells exports can be tens of MB

// Local, single-user, no-auth tool (see MIGRATION.md) — the client (Vite dev server or a static
// build) always runs on a different origin than this API, so the browser blocks fetch() here
// without CORS headers even though curl/psql work fine. Open policy is fine given that threat model.
await app.register(cors, { origin: true });

await app.register(mapsRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
