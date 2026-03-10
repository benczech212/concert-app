#!/bin/bash

# Default to Track 1 if no argument provided
TRACK_ID=${1:-1}
TITLE=${2:-"Track $TRACK_ID"}

echo "Setting active track to: $TITLE (ID: $TRACK_ID)..."

curl -X POST ${HOST:-http://localhost:8000}/api/track \
  -H "Content-Type: application/json" \
  -d "{\"trackId\": \"$TRACK_ID\", \"title\": \"$TITLE\"}"

echo -e "\n\nTrack update broadcasted!"
