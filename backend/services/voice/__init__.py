"""Voice services — STT (Deepgram) e TTS (Edge, Kokoro, ElevenLabs, MiniMax)."""

from . import deepgram_client, edge_client, elevenlabs_client

__all__ = ["deepgram_client", "edge_client", "elevenlabs_client"]
