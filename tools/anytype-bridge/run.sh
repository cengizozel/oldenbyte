#!/bin/bash
# Run the Anytype bridge with the env from .env (gitignored).
cd "$(dirname "$0")"
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/oldenbyte/anytype-bridge-venv"
set -a
[ -f .env ] && source .env
set +a
exec "$VENV/bin/python" bridge.py
