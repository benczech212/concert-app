#!/bin/bash
# clear_all.sh
# Clears the events log and resets server metrics.

SERVER_URL="${HOST:-http://localhost:8000}/api"

echo "=== Clearing All Data ==="

echo "1. Resetting server metrics..."
curl -s -X POST $SERVER_URL/metrics/reset > /dev/null
echo "   Metrics reset."

echo "2. Clearing events log (events_log.jsonl)..."
# Find the root of the project (assuming this script is in shortcuts/)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"

# Clear the file contents without deleting the file
> "$PROJECT_ROOT/events_log.jsonl"
echo "   Events log cleared."

echo "=== All data cleared ==="
