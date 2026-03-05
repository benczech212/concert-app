#!/bin/bash

echo "Starting 20 simulated 'combined_reaction' events..."
for i in {1..20}; do
  COLORS=("Red" "Blue" "Indigo" "Chartreuse" "Magenta" "White")
  MOODS=("Joy" "Melancholy" "Confusion" "Mystery" "Anger" "Chaos")
  REACTIONS=("meh" "like" "applause")
  VALUES=(1 2 4)

  # Pick random items
  COLOR=${COLORS[$RANDOM % ${#COLORS[@]}]}
  MOOD=${MOODS[$RANDOM % ${#MOODS[@]}]}
  IDX=$((RANDOM % 3))
  REACTION=${REACTIONS[$IDX]}
  VAL=${VALUES[$IDX]}

  curl -s -X POST http://localhost:8000/api/events \
    -H "Content-Type: application/json" \
    -d "{\"category\": \"combined_reaction\", \"value\": $VAL, \"colorName\": \"$COLOR\", \"mood\": \"$MOOD\", \"colorRgba\": \"#ffffff\", \"reactionLabel\": \"$REACTION\"}" > /dev/null
  echo -n "."
done

echo -e "\n\nSwitching Track to trigger Word Cloud..."
./test_track.sh 3 'Track 3'

echo "Starting 20 simulated 'note' events (text input)..."
for i in {1..20}; do
  WORDS=("Amazing" "Loud" "Beautiful" "Confusing" "Electric" "Moving" "Boring" "Sad" "Happy" "Epic")
  WORD=${WORDS[$RANDOM % ${#WORDS[@]}]}

  curl -s -X POST http://localhost:8000/api/events \
    -H "Content-Type: application/json" \
    -d "{\"category\": \"note\", \"value\": \"$WORD user $i\"}" > /dev/null
  echo -n "."
done

echo -e "\n\nSimulation complete."
