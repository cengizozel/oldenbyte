#!/bin/bash
# One-time setup for the Anytype bridge: creates a venv (outside the repo, so
# builds and git never see it) and installs anytype-grpc into it. Run again
# anytime to update the library.
set -e
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/oldenbyte/anytype-bridge-venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip -q
# protobuf 7 removed FieldDescriptor.label, which anytype-grpc's generic request
# builder still uses; pin below 7 until the library migrates.
"$VENV/bin/pip" install "protobuf<7"
"$VENV/bin/pip" install "anytype-grpc @ git+https://github.com/cengizozel/anytype-grpc.git"
echo
echo "Done. Venv: $VENV"
echo "Next steps:"
echo "  1. Mint a session token (needs the Anytype app running):"
echo "       $VENV/bin/python -m anytype_grpc.auth"
echo "  2. Copy env.example to .env and fill in ANYTYPE_TOKEN and BRIDGE_TOKEN."
echo "  3. Run the bridge:  ./run.sh"
