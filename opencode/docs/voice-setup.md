# Voice Setup (TTS/STT)

Text-to-speech and speech-to-text for opencode using Piper + Ollama.

## Prerequisites

- Docker (for Ollama)
- `sox` (audio playback): `sudo apt install -y sox`
- `piper` (TTS engine): install from [rhasspy/piper](https://github.com/rhasspy/piper)

## Ollama (LLM for text normalization)

Ollama runs in Docker to normalize markdown text for speech (strips `**bold**`, converts code refs, etc.).

```bash
# Start Ollama
docker compose -f docker/compose.yaml up -d ollama

# Pull a small model (~400MB)
docker exec <container-name> ollama pull qwen2.5:0.5b
```

Verify:
```bash
curl http://localhost:11434/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:0.5b","messages":[{"role":"user","content":"Say hello"}],"max_tokens":20}'
```

## Voice Models

Piper uses ONNX voice models. Install to `~/.local/share/piper-voices/`.

| Voice | File | Vibe |
|-------|------|------|
| BT-7274 (default) | `BT7274.onnx` | Titanfall titan — deep, calm, authoritative mech |
| GlaDOS | `glados.onnx` | Portal AI — sarcastic, passive-aggressive |
| Northern English Male | `en_GB-northern_english_male-medium.onnx` | Deep British narrator |
| Lessac | `en_US-lessac-low.onnx` | Standard US male, clean |
| Scorch | `scorch.onnx` | Titanfall pilot — warm, gruff |
| Subnautica PDA | `subnautica_pda.onnx` | Sci-fi ship AI — calm, instructional |

Source: `opencode/voices/` (copy both `.onnx` and `.onnx.json` to `~/.local/share/piper-voices/`).

Quick test:
```bash
echo "Pilot, you need to see this." | piper \
  --model ~/.local/share/piper-voices/BT7274.onnx \
  --output_raw | play -t raw -r 22050 -e signed -b 16 -c 1 -q -
```

## Plugin Configuration

In `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "plugin": [
    ["@renjfk/opencode-voice", {
      "endpoint": "http://localhost:11434/v1",
      "model": "qwen2.5:0.5b"
    }]
  ]
}
```

No `apiKeyEnv` needed for local Ollama.

## Usage

| Command | Action |
|---------|--------|
| `/tts-mode` | Toggle auto TTS on/off |
| `/tts-speak` | Read last response aloud |
| `/tts-voice` | Select voice |
| `/tts-stop` | Stop playback |
| `Escape` | Stop playback (keybind) |
| `<leader>s` | Speak last response (keybind) |
| `<leader>v` | Toggle TTS (keybind) |

## How It Works

1. **Auto mode**: When enabled, TTS speaks after each assistant response
2. **Normalization**: LLM converts markdown to natural speech text
   - Strips `**bold**`, `*italic*`, `` `code` ``, links, headings
   - Splits camelCase/PascalCase identifiers into words
   - Reads file paths as just filenames
3. **Synthesis**: Piper generates raw audio from normalized text
4. **Playback**: Sox `play` outputs audio through system speakers

## Troubleshooting

- **No sound**: Check `which play` (sox) and `which piper`
- **"Asterisk asterisk" in speech**: LLM normalization issue — ensure Ollama is running
- **Voice not found**: Verify files in `~/.local/share/piper-voices/`
- **Plugin not loading**: Restart opencode, check `~/.cache/opencode/packages/@renjfk/`
