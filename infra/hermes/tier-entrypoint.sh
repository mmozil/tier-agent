#!/bin/sh
# Tier Agent — entrypoint custom pra container Hermes.
#
# Traduz env vars TIER_* em config Hermes ANTES de iniciar /init (s6-overlay).
# Roda como root, depois s6 dropa pra UID 10000 (hermes user).
set -e

HERMES_HOME=/opt/data
ENV_FILE="$HERMES_HOME/.env"

mkdir -p "$HERMES_HOME"
chown -R 10000:10000 "$HERMES_HOME"

# --- LLM provider ---
PROVIDER="${TIER_LLM_PROVIDER:-minimax}"
MODEL="${TIER_LLM_MODEL:-MiniMax-M2}"
API_KEY="${TIER_LLM_API_KEY:-}"

# Limpa overrides anteriores
sed -i '/^# === TIER overrides ===/,/^# === END TIER ===/d' "$ENV_FILE" 2>/dev/null || true

cat >> "$ENV_FILE" << EOF
# === TIER overrides === (gerado pelo entrypoint, não editar manualmente)
EOF

case "$PROVIDER" in
    minimax)
        echo "MINIMAX_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    gemini)
        echo "GEMINI_API_KEY=$API_KEY" >> "$ENV_FILE"
        echo "GOOGLE_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    anthropic)
        echo "ANTHROPIC_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    openai)
        echo "OPENAI_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    openrouter)
        echo "OPENROUTER_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    nous)
        echo "NOUS_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
    *)
        echo "[tier-entrypoint] provider '$PROVIDER' desconhecido — passando como ${PROVIDER}_API_KEY"
        echo "$(echo $PROVIDER | tr a-z A-Z)_API_KEY=$API_KEY" >> "$ENV_FILE"
        ;;
esac

# Allowlist + REST API obrigatórios pro control plane Tier conversar
echo "GATEWAY_ALLOW_ALL_USERS=false" >> "$ENV_FILE"
echo "API_SERVER_HOST=0.0.0.0" >> "$ENV_FILE"
echo "API_SERVER_KEY=tier-control-plane-internal" >> "$ENV_FILE"
echo "# === END TIER ===" >> "$ENV_FILE"

chown 10000:10000 "$ENV_FILE"
chmod 600 "$ENV_FILE"

# --- model.provider + model.default via config set ---
# Roda como hermes user (UID 10000)
su - hermes -s /bin/sh -c "/opt/hermes/.venv/bin/hermes config set model.provider '$PROVIDER' 2>&1" || true
su - hermes -s /bin/sh -c "/opt/hermes/.venv/bin/hermes config set model.default '$MODEL' 2>&1" || true
su - hermes -s /bin/sh -c "/opt/hermes/.venv/bin/hermes config set model.base_url '' 2>&1" || true

# --- Feature flags via env (gateway lê) ---
if [ -n "$TIER_FEATURE_FLAGS" ]; then
    echo "$TIER_FEATURE_FLAGS" > "$HERMES_HOME/tier-feature-flags.json"
    chown 10000:10000 "$HERMES_HOME/tier-feature-flags.json"
fi

echo "[tier-entrypoint] config aplicada: provider=$PROVIDER model=$MODEL"
echo "[tier-entrypoint] delegando pro entrypoint original Hermes"

# Delega pro entrypoint oficial: tini -g -- /opt/hermes/docker/entrypoint.sh
exec /usr/bin/tini -g -- /opt/hermes/docker/entrypoint.sh "$@"
