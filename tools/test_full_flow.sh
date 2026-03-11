#!/bin/bash
# test_full_flow.sh
# Simulates the full workflow: start track, send reactions, end track, send words, start new track

SERVER_URL="${HOST:-http://localhost:8000}/api"

echo "=== Starting Full Flow Test ==="

echo "1. Starting Track 1 (First Track)"
curl -s -X POST $SERVER_URL/track \
  -H "Content-Type: application/json" \
  -d '{"id":"test-1","title":"First Track"}' > /dev/null
echo "   Wait 5s (Check frontend for Now Playing popup)"
sleep 5

MOODS=("Happy" "Sad" "Angry" "Calm" "Excited" "Anxious" "Bored")
COLORS=("Red" "Blue" "Amber" "Green" "Purple" "Yellow" "Cyan")
REACTIONS=("applause" "like" "meh")

echo "2. Sending audience reactions for Track 1 for 20s"
for i in {1..20}; do
  RANDOM_REACTION=${REACTIONS[$RANDOM % ${#REACTIONS[@]}]}
  RANDOM_COLOR=${COLORS[$RANDOM % ${#COLORS[@]}]}
  RANDOM_MOOD=${MOODS[$RANDOM % ${#MOODS[@]}]}
  
  curl -s -X POST $SERVER_URL/events \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"flowtester\",
      \"userName\": \"Tester\",
      \"category\": \"reaction\",
      \"value\": \"$RANDOM_REACTION\"
    }" > /dev/null
    
  curl -s -X POST $SERVER_URL/events \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"flowtester\",
      \"userName\": \"Tester\",
      \"category\": \"color\",
      \"value\": \"$RANDOM_COLOR\"
    }" > /dev/null

  curl -s -X POST $SERVER_URL/events \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"flowtester\",
      \"userName\": \"Tester\",
      \"category\": \"mood\",
      \"value\": \"$RANDOM_MOOD\"
    }" > /dev/null
    
  echo "   Sent random reaction/color/mood bundle $i"
  sleep 1
done

echo "3. Ending Track 1"
curl -s -X POST $SERVER_URL/track/end > /dev/null
echo "   Wait 3s (Check frontend for Word Cloud popup)"
sleep 3

echo "4. Sending words for Track 1"
curl -s -X POST $SERVER_URL/events \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "flowtester",
    "userName": "Tester",
    "category": "note",
    "value": "Epic amazing cool awesome brilliant"
  }' > /dev/null
echo "   Sent words."
sleep 3

echo "5. Starting Track 2 (Second Track)"
curl -s -X POST $SERVER_URL/track \
  -H "Content-Type: application/json" \
  -d '{"id":"test-2","title":"Second Track"}' > /dev/null
echo "   Wait 5s (Check frontend for Now Playing popup again)"
sleep 5

echo "=== Flow Test Complete ==="
