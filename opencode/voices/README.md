# Piper Voice Models

Custom Piper TTS voices for opencode voice output.

## Voices

| Voice | File | Vibe |
|-------|------|------|
| BT-7274 | `BT7274.onnx` | Titanfall titan — deep, calm, authoritative mech |
| GlaDOS | `glados.onnx` | Portal AI — sarcastic, passive-aggressive |
| Northern English Male | `en_GB-northern_english_male-medium.onnx` | Deep British narrator |
| HFC Male | `en_US-hfc_male-medium.onnx` | Standard US male, clean |
| Subnautica PDA | `subnautica_pda.onnx` | Sci-fi ship AI — calm, instructional |

## Usage

Voices are installed to `~/.local/share/piper/` for runtime use.
Select at runtime in opencode with `/tts-voice`.

## Quick test

```bash
echo "Pilot, you need to see this." | piper \
  --model ~/.local/share/piper/BT7274.onnx \
  --config_file ~/.local/share/piper/BT7274.onnx.json \
  --output_file /tmp/test.wav && aplay /tmp/test.wav
```

## Adding more voices

Download `.onnx` + `.onnx.json` pairs from:
- [DJMalachite/PiperVoiceModels](https://github.com/DJMalachite/PiperVoiceModels) (BT-7274, Subnautica PDA)
- [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (official catalog)
- [Home Assistant community voices](https://community.home-assistant.io/t/collections-of-pre-trained-piper-voices/915666)

Copy to both `opencode/voices/` (source of truth) and `~/.local/share/piper/` (runtime).
