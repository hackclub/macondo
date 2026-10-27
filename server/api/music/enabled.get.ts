import { isMusicEnabled } from "../../lib/app-settings";

// Public because the music player also runs on public pages like docs.
export default defineEventHandler(async () => {
  return { enabled: await isMusicEnabled() };
});
