/**
 * API process entry point (spec §12; M4.B01).
 *
 * Configuration comes from the environment so deployment keeps secrets out of
 * the repository: `PORT`, `HOST` and (from M4.B02) `DATABASE_PATH`.
 */

import { startApiServer } from "./api.js";
import { DiscordAuth, discordOptionsFromEnv } from "./auth/discord.js";
import { GithubAuth, githubOptionsFromEnv } from "./auth/github.js";
import { PasskeyAuth, passkeyOptionsFromEnv } from "./auth/passkey.js";
import { Database } from "./db/database.js";
import { buildApiRoutes } from "./api.js";

export async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const database = Database.open(
    process.env.DATABASE_PATH ? { path: process.env.DATABASE_PATH } : {},
  );
  const passkey = new PasskeyAuth(passkeyOptionsFromEnv(process.env));
  const discordOptions = discordOptionsFromEnv(process.env);
  const discord = discordOptions === undefined ? undefined : new DiscordAuth(discordOptions);
  const githubOptions = githubOptionsFromEnv(process.env);
  const github = githubOptions === undefined ? undefined : new GithubAuth(githubOptions);
  const running = await startApiServer({
    port,
    host,
    logger: (message) => console.error(message),
    routes: buildApiRoutes(database, {
      passkey,
      ...(discord === undefined ? {} : { discord }),
      ...(github === undefined ? {} : { github }),
    }),
  });

  console.log(`API listening on http://${host}:${running.port}`);

  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
