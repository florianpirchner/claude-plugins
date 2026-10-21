---
name: audio
description: Domain pack of expert-teams for text-to-speech audio production with the ElevenLabs API. Read by /expert-teams:create, modify and run when the pipeline lists audio in domains; not a skill to invoke on its own.
disable-model-invocation: true
---

# Domain pack: audio

Knowledge for pipelines that turn text into spoken audio with the [ElevenLabs](https://elevenlabs.io) text-to-speech API: narration scripts written for the ear, pronunciation, voice casting, generation, post-processing and checks. Typical results are audio guides, explainer and video voice-overs, podcast intros, e-learning lessons, audiobook chapters and app prompts. The core skills read the section they need: create and modify all of them, run only "Build and review". `<pack>` below is the directory of this file.

Two things make this pack different from the others:

- **It costs money.** ElevenLabs bills per generated character (credits) against the monthly quota of the user's plan; beyond the quota a paid plan bills extra usage or generation stops. Every regeneration of a changed or rejected take is billed again. The pack therefore reviews the text before any audio is generated, caches every generated take, and estimates the cost before each paid call. Prices, quotas and the credit cost per character of each model change; the current numbers are at <https://elevenlabs.io/pricing/api>. As a rule of thumb, the high-quality models (e.g. `eleven_multilingual_v2`, `eleven_v3`) cost about twice as much per character as the fast ones (e.g. `eleven_flash_v2_5`, `eleven_turbo_v2_5`). One minute of speech is roughly 800 to 1,000 characters.
- **It needs a secret.** The API key is read from the environment variable `ELEVENLABS_API_KEY`. It is never written into a file of the repository, a pipeline, a status file, a log or a commit message.

Claude cannot listen to audio. Checks by agents are measurable (files, durations, loudness, a transcript compared with the script); whether a voice sounds right is decided by a human who listens.

## Grill me

Settle the brief before the open points, one or two questions at a time, skipping what the brainstorming already answered:

1. **Purpose and listener:** what is the audio for, who listens where (headphones in a museum, phone speaker, car, video with music)? How long should it be in total and per piece?
2. **Source text:** is there finished text, rough material to rewrite for listening, or nothing yet? Which language(s) and accents?
3. **Voices:** one narrator or several (dialogue, characters)? A voice from the ElevenLabs library, a voice the user already has in their account (voice id), or a cloned voice? Cloning a real person's voice only with that person's documented consent.
4. **Account and budget:** which ElevenLabs plan does the user have, how many credits are left this month, and how much may this project spend (in credits or money)? May the run use paid extra usage beyond the quota? Commercial use needs a paid plan; the free plan requires attribution.
5. **Quality and model:** highest quality (multilingual v2 or v3, more credits) or fast and cheap (flash or turbo)? Which output format (e.g. `mp3_44100_128`, WAV/PCM for further editing)?
6. **Pronunciation and style:** names, brands, abbreviations, numbers, foreign words that must be pronounced in a certain way; pace, tone, pauses.
7. **Post-processing and delivery:** loudness target (e.g. -16 LUFS for podcasts and the web, -23 LUFS for broadcast), music or sound effects, file naming, where the files go. Is `ffmpeg` available?

At the end of grill me write the answers to `docs/input/audio-brief.md` (in `rules.language.docs`): purpose and listener, source text, voices, account and budget, model and format, pronunciation and style, post-processing and delivery. Never write the API key into it, only the name of the environment variable. If the file exists, show the differences and change it only with the user's consent. Add it to the pipeline's `inputs` and to `rules.readOnly`.

When looking for open points, also check: a budget that does not cover the estimated characters times the expected rounds, a cloned voice without consent, commercial use on the free plan, text written for reading (tables, footnotes, URLs, brackets) that does not work spoken, length limits per request of the chosen model, audio files that would bloat the repository.

## Base questions

- **API key:** say clearly that the key is read from the environment variable `ELEVENLABS_API_KEY` and never committed. The user sets it in their shell or in a local `.env` file; `.env` and the cache directory go into `.gitignore` in the first phase. A run that starts a generation phase without the variable stops with a clear message instead of asking for the key in the chat. Reviewers treat any key in the repository as a blocking finding, and a key that was committed once must be revoked in the ElevenLabs account, removing it from history is not enough.
- **Costs:** say clearly that generation costs money and confirm the budget from grill me. Add to `askHumanWhen`: every paid generation whose estimate exceeds the remaining budget, the first full generation after a voice test, voice cloning, use of paid extra usage, a change of model or voice that forces a regeneration of everything.
- **Language:** `docs` covers plans and briefs; `ui` covers the spoken text and therefore the language of the voice. `code` covers the generation script.
- **Check before every commit** (`preCommit`): a secret check that fails when a staged file contains `ELEVENLABS_API_KEY=` with a value or a string that looks like an ElevenLabs key (they start with `sk_`), plus the project's own checks. Mark the phases it applies to with `code: true`.
- **Audio files in git:** small projects commit the final files; large ones put them into Git LFS or keep them out of the repository (only the script, the lexicon and a manifest with checksums are committed). Ask which one.
- **Rounds:** `maxRounds` 2 for generation phases is usually enough, since every round costs credits; text phases can keep the default.
- **Human in the loop:** `as-needed` is the usual choice, with `always` for the voice casting phase, because only a human can judge how a voice sounds.
- **Worktrees and pushEveryRound:** keep the generation cache outside the worktree (e.g. `.cache/tts/` in the main checkout, or a path from the environment) so that a new round or a resumed run reuses takes instead of paying again.

## Team

- Example roles: `<pack>/agents/`: `narration-writer` (text for the ear), `voice-director` (voices, settings, pronunciation lexicon, speakability), `audio-engineer` (generation script, API, cache, cost estimate, post-processing), `audio-qa` (measurable checks of the takes, costs and secrets). Use them as inspiration, do not copy them blindly.
- The narration writer does not review its own text; the voice director reviews it for speakability, a content reviewer (e.g. from the docs or marketing pack) for facts.
- Only the audio engineer calls the ElevenLabs API. Reviewers never call paid endpoints; the optional transcript check (speech-to-text) also costs credits and runs only if the brief allows it.
- `audio-engineer` and `audio-qa` need `Bash` (script, `ffmpeg`, `ffprobe`); the writer and the director do not.

## Flow

- A typical order: narration script, then pronunciation lexicon and voice casting (in parallel), then generation, then post-processing, then a final check with a human listening. Leave out what the project does not need.
- **Script before sound.** The text is reviewed and accepted before the first full generation. Changing accepted text later means paying for those pieces again.
- **Voice test.** Voice casting generates only short samples (one or two sentences per candidate voice and setting) and ends with the user choosing; record the chosen voice id, model, settings and seed in a committed file such as `audio/voices.yaml`.
- **Generation** uses `workPackages` (`from` a YAML file written by the script phase), one package per chapter, scene or prompt, so a rejected take only regenerates that piece. Usual package types: `chapter`, `scene`, `prompt`, `voice-over`. Every package records its character count.
- **Generation script** (written by the audio engineer, e.g. `scripts/tts.mjs` or `scripts/tts.py`): reads `ELEVENLABS_API_KEY` from the environment and stops if it is missing; calls `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with header `xi-api-key`, `text`, `model_id`, `voice_settings` and the `output_format` query parameter; splits long text at paragraph or sentence ends below the model's limit per request; caches every take under a hash of text, voice, model, settings and format and never calls the API for a hash it already has; has a `--dry-run` that prints characters and estimated credits per piece and in total without calling the API; reads the remaining quota from `GET /v1/user/subscription` before a paid run; writes a manifest (`audio/manifest.yaml`: file, source piece, characters, duration, checksum) and appends the spent characters to a cost log such as `audio/costs.yaml`; never prints the key.
- **Post-processing** with `ffmpeg`: loudness normalisation to the target from the brief (`loudnorm`), trimming of silence, joining of chunks, conversion to the delivery format.
- Acceptance criteria are checkable: every piece of the script has exactly one take in the manifest, durations match the text length (about 130 to 170 words per minute unless the brief says otherwise), loudness is within 1 LU of the target, no take was generated twice for the same hash, spent characters stay within the budget, no secret in the repository, the user has listened to and accepted the voice test.
- Name outputs after their content (`narration-script.md`, `pronunciation-lexicon.yaml`, `voices.yaml`), not `report.md`.

## Build and review

Add these lines to every build and review task of the pipeline:

```
Plans and briefs in <docs>. Spoken text in <ui>, written for the listener in docs/input/audio-brief.md. Generation script in <code>.
The ElevenLabs API costs money per character. Only the audio engineer calls it, only for accepted text, only for hashes not yet in the cache, and only after a dry run whose estimate fits the remaining budget; otherwise raise a consult question for the user.
The API key comes from the environment variable ELEVENLABS_API_KEY. Never write it into any file, log, status file or message, and never ask for it.
Never clone a voice without documented consent and never invent quotes or facts in the narration.
```

Add this line to every review task:

```
Do not call paid API endpoints. A key or secret in the repository, a regeneration of an unchanged take, spending beyond the budget, a take missing from the manifest or spoken text in the wrong language is a blocking finding.
```
