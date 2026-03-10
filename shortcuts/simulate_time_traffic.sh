#!/bin/bash
# simulate_time_traffic.sh
# Sends random events every 2-5 seconds to simulate an active audience over time.

SERVER_URL="${HOST:-http://localhost:8000}/api/events"
MOODS=("Happy" "Relaxed" "Melancholy" "Excited" "Chill")
COLORS=("Red" "Blue" "Green" "Purple" "Yellow" "Amber" "Cyan")
REACTIONS=("meh" "like" "applause" "meh" "like") # weighted more towards like/meh

echo "Starting Time Traffic Simulator..."
echo "Sending random events to $SERVER_URL every few seconds."
echo "Press Ctrl+C to stop."

while true; do
  # Pick random values
  MOOD=${MOODS[$RANDOM % ${#MOODS[@]} ]}
  COLOR=${COLORS[$RANDOM % ${#COLORS[@]} ]}
  REACTION=${REACTIONS[$RANDOM % ${#REACTIONS[@]} ]}

  # Random delay between 2 and 5 seconds
  DELAY=$((RANDOM % 4 + 2))

  # Randomly decide which events to send (roughly 80% chance for each)
  SEND_MOOD=$((RANDOM % 5))
  SEND_COLOR=$((RANDOM % 5))
  SEND_REACTION=$((RANDOM % 5))

  # Send Mood
  if [ $SEND_MOOD -ne 0 ]; then
    curl -s -X POST $SERVER_URL \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "simulator@test.com",
        "userName": "SimUser",
        "category": "mood",
        "value": "'"$MOOD"'"
      }' > /dev/null
  fi

  # Send Color
  if [ $SEND_COLOR -ne 0 ]; then
    curl -s -X POST $SERVER_URL \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "simulator@test.com",
        "userName": "SimUser",
        "category": "color",
        "value": "'"$COLOR"'"
      }' > /dev/null
  fi

  # Send Reaction
  # Map reaction string to value (meh=1, like=2, applause=4)
  R_VAL=1
  if [ "$REACTION" == "like" ]; then R_VAL=2; fi
  if [ "$REACTION" == "applause" ]; then R_VAL=4; fi

  if [ $SEND_REACTION -ne 0 ]; then
    curl -s -X POST $SERVER_URL \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "simulator@test.com",
        "userName": "SimUser",
        "category": "combined_reaction",
        "value": '$R_VAL',
        "colorName": "'"$COLOR"'",
        "mood": "'"$MOOD"'",
        "reactionLabel": "'"$REACTION"'"
      }' > /dev/null

    # Also trigger the separate reaction counter type that the chart expects
    curl -s -X POST $SERVER_URL \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "simulator@test.com",
        "userName": "SimUser",
        "category": "reaction",
        "value": "'"$REACTION"'"
      }' > /dev/null
  fi

  # Log what was actually sent
  SENT_ITEMS=""
  if [ $SEND_MOOD -ne 0 ]; then SENT_ITEMS+="Mood:$MOOD "; fi
  if [ $SEND_COLOR -ne 0 ]; then SENT_ITEMS+="Color:$COLOR "; fi
  if [ $SEND_REACTION -ne 0 ]; then SENT_ITEMS+="Reaction:$REACTION "; fi
  
  if [ -z "$SENT_ITEMS" ]; then
    SENT_ITEMS="Nothing (Random skip)"
  fi

  echo "[$(date +'%H:%M:%S')] Sent event fields: [$SENT_ITEMS]. Waiting ${DELAY}s..."
  sleep $DELAY
done
