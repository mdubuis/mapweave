import Fastify from "fastify";
import mapsRoutes from "./routes/maps.mjs";

const app = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 }); // Pack Cells exports can be tens of MB

await app.register(mapsRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
