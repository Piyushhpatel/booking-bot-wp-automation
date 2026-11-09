import { createApp } from "./app";
import { config } from "./config";
import { connectDb } from "./db";
import { seedDatabase } from "./seed";
import { ensureWabaSubscription } from "./services/whatsapp";

async function main(): Promise<void> {
  await connectDb();
  if (config.seedOnBoot) await seedDatabase();
  const app = createApp();
  app.listen(config.port, () => console.log(`doc-booking listening on :${config.port}`));
  await ensureWabaSubscription();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});