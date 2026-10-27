# Macondo background music

These tracks power the in-app music player (the bar in the bottom-left of the
dashboard, shop, profile, and docs pages). **All tracks are by Sojo.**

## Current files

`Mixdown.mp3` is the one track wired into the player.

The uncompressed source (`Mixdown.wav`, ~19 MB) is kept locally but **not
committed**: `public/music/*.wav` is gitignored, so only the compressed `.mp3`
(a few MB) ships. To regenerate the mp3 from a WAV, transcode with ffmpeg:

```
ffmpeg -i Mixdown.wav -codec:a libmp3lame -b:a 192k Mixdown.mp3
```

## Adding or replacing tracks

1. Drop each track into this folder as an `.mp3` (a few MB is ideal; stay well
   under the 100 MB upload ceiling).
2. Open `app/composables/useMusicPlayer.ts` and update the `MUSIC_TRACKS`
   array so each entry's `src` points at the filename and `title` is the real
   song name. Keep `artist` as `"Sojo"`.
3. Reload. No other code changes are needed. To add another track, append a
   new entry to `MUSIC_TRACKS`.

## Notes

- The player tolerates missing or undecodable files: it shows a small "Track
  unavailable" note and still lets you skip to the next track.
