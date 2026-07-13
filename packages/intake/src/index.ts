import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3001);

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  app.listen({ port, host: "0.0.0.0" }).then(() =>
    console.log(`Finality intake listening on :${port}`)
  );
}
