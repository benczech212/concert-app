#!/bin/bash
# tools/simulate_and_generate.sh
# Simulates a full track lifecycle and triggers the Gemini text generation feature

SERVER_URL="${HOST:-http://localhost:8000}/api"
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"

echo "=== 1. Resetting Metrics & Data ==="
curl -s -X POST "$SERVER_URL/metrics/reset"
echo -e "\n\n=== 2. Starting Track 'Simulation Track 1' ==="
curl -s -X POST "$SERVER_URL/track" -H "Content-Type: application/json" -d '{"title":"Simulation Track 1"}'
echo -e "\n\n=== 3. Firing Audience Reactions ==="
echo "Running full_e2e_sim.js in the background for 15 seconds..."

# We will run full_e2e_sim.js but the existing script is a full 20-minute flow.
# Let's instead use a custom quick burst of events to simulate audience reaction locally.

echo "Injecting a burst of simulated events..."
for i in {1..5}; do
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"reaction", "value":4}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"reaction", "value":2}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"color", "colorName":"Red", "value":"Red"}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"mood", "value":"Electric"}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"note", "value":"This track is absolute fire!"}' > /dev/null
  sleep 0.5
done

for i in {1..3}; do
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"color", "colorName":"Blue", "value":"Blue"}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"mood", "value":"Deep"}' > /dev/null
  curl -s -X POST "$SERVER_URL/events" -H "Content-Type: application/json" -d '{"category":"note", "value":"Feeling the bass"}' > /dev/null
  sleep 0.5
done

echo -e "=== 4. Ending Track ==="
curl -s -X POST "$SERVER_URL/track/end"

echo -e "\n\n=== 5. Triggering Show End (POST_SHOW) ==="
curl -s -X POST "$SERVER_URL/state" -H "Content-Type: application/json" -d '{"newState": "POST_SHOW"}'

echo -e "\n\nWaiting 10 seconds for Gemini to generate track names and stories..."
for i in {1..10}; do
  echo -n "."
  sleep 1
done

echo -e "\n\n=== 6. Fetching Generated Stories ==="
curl -s "$SERVER_URL/stories" | jq .

echo -e "\n\nSimulation Complete."
