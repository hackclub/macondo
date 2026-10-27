import { createClient, type RedisClientType } from "redis";
import { useRuntimeConfig } from "#imports";

let redis: RedisClientType | null = null;
let initialized = false;

export async function getRedis(): Promise<RedisClientType | null> {
  if (initialized) return redis;
  initialized = true;

  try {
    const config = useRuntimeConfig();
    const client = createClient({ url: config.redisUrl as string }) as RedisClientType;

    client.on("error", () => {
      if (redis) {
        console.warn("[redis] Connection lost, disabling Redis");
        redis = null;
      }
    });

    await client.connect();
    redis = client;
  } catch {
    console.warn("[redis] Failed to connect, running without Redis");
  }

  return redis;
}

export default getRedis;
