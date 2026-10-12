# Edits to `create.tsx` (3 small ones)

Line numbers are from the file you sent; search for the text instead if yours has moved.

## 1) Import — add after the other `modules/video-baker/...` imports (≈ line 57)
```ts
import { bakeAudioStudio, paramsFromStudio } from 'modules/video-baker/audioStudio';
```

## 2) `startRec` (≈ line 3082) — restart the beat from 0 exactly when recording starts
Find:
```ts
      const recording = audioRecorderInstance;
      await recording.prepareToRecordAsync();
      recording.record();
```
Replace with:
```ts
      const recording = audioRecorderInstance;
      await recording.prepareToRecordAsync();
      // STUDIO SYNC: restart the beat from 0 at the instant recording starts, so time 0 of the voice
      // file == time 0 of the beat. The audio engine mixes them on that shared timeline.
      if (selBeat && beatSnd.current) {
        try { await beatSnd.current.setPositionAsync(0); await beatSnd.current.playAsync(); setPlayBeat(true); } catch {}
      }
      recording.record();
```
(Recommended: show a small "🎧 Use earphones" hint near the record button.)

## 3) `done` (≈ line 3315) — replace the whole function
This replaces STEP 1–3 (the three dead `bake…` calls) with one call. The finished song already contains the beat, so
`beatUri` is returned as `null` — otherwise the beat would play twice.
```ts
  const done = async () => {
    await stopAll();
    setBaking(true);

    try {
      let finalVoiceUri = voiceUri;
      let beatForParent: string | null = selBeat?.url || null;
      let finalDuration = recDur;

      if (voiceUri) {
        try {
          const res = await bakeAudioStudio({
            voiceUri,
            beatUri: selBeat?.url ?? null,
            params: paramsFromStudio({
              effect: selEffect,
              studio: studioEdit,
              autoTune,
              voiceVolume: voiceVol,
              beatVolume: beatVol,
              // latencyMs: 0,   // see README_AUDIO.md "Getting the voice exactly on the beat"
            }),
          });
          finalVoiceUri = res.uri;                 // finished song: voice + beat already mixed
          finalDuration = Math.max(1, Math.round(res.durationSec));
          beatForParent = null;                    // beat is inside the song now
        } catch (e: any) {
          console.warn('Audio Studio mix failed, using the raw voice:', e);
          Alert.alert('Studio mix unavailable', (e?.message || 'Could not master the track') + '\n\nPosting your raw voice instead.');
        }
      }

      onDone({
        voiceUri: finalVoiceUri,
        beatUri: beatForParent,
        beatName: selBeat?.name || null,
        beatArtist: selBeat?.artist || null,
        voiceVolume: voiceVol, beatVolume: beatVol,
        effectName: selEffect.id !== 'none' ? selEffect.name : null,
        effectId: selEffect.id !== 'none' ? selEffect.id : null,
        effectReverb: selEffect.reverb, effectEcho: selEffect.echo, effectChorus: selEffect.chorus,
        duration: finalDuration, autoTuneEnabled: autoTune,
      });
    } finally {
      setBaking(false);
    }
  };
```
Your "Done" button already shows a spinner while `baking` is true — that is the "Mastering your track…" moment
(a few seconds). The old `bakeVoiceEffect`, `bakeStudioEdit` and `applyProfessionalAutoTune` stubs can stay or be deleted; nothing calls them any more.

### Checked in your file
- `buildMergedVoiceBeatUrl` / `buildCloudinaryAudioUrl` are **not called anywhere**, so nothing re-applies pitch or volume to the finished song after upload.
- The upload reads the file as `.m4a` and sends it to Cloudinary as before — the engine's output is an AAC `.m4a`, so no change is needed there.
