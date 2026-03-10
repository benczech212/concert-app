#!/bin/bash
# test_3_tracks.sh
# Simulates playing 3 distinct tracks for 5 minutes each, injecting random data and words.

SERVER_URL="${HOST:-http://localhost:8000}/api"

echo "=== Starting 5-Minute 3 Track Simulation ==="

echo "Resetting metrics..."
curl -s -X POST $SERVER_URL/metrics/reset > /dev/null

MOODS=("Happy" "Sad" "Angry" "Calm" "Excited" "Anxious" "Bored")
COLORS=("Red" "Blue" "Amber" "Green" "Purple" "Yellow" "Cyan")
REACTIONS=("applause" "like" "meh")

# Pool of words to pick from randomly
WORDS=("energetic" "wild" "fun" "amazing" "deep" "emotional" "moving" "profound" "slow" "intense" "chaotic" "loud" "crazy" "sharp" "awesome" "epic" "cool" "boring" "great" "huge" "fire" "rock" "synth" "bass" "vibes")

# Helper function to generate random words
generate_random_words() {
    local num_words=$1
    local out=""
    for (( j=1; j<=$num_words; j++ )); do
        w=${WORDS[$RANDOM % ${#WORDS[@]}]}
        out="$out $w"
    done
    echo "$out"
}

run_track() {
    local index=$1
    local id=$2
    local title=$3
    
    echo "============================="
    echo "$index. Starting Track $index ($title)"
    curl -s -X POST $SERVER_URL/track -H "Content-Type: application/json" \
      -d "{\"id\":\"$id\",\"title\":\"$title\"}" > /dev/null
    sleep 3

    echo "   Sending Data for Track $index for 300 seconds (5 minutes)..."
    for i in {1..300}; do
      # Randomly decide to send a reaction/color/mood each second depending on chance (e.g. 50% chance of an event per second)
      if [ $((RANDOM % 2)) -eq 0 ]; then
        RANDOM_REACTION=${REACTIONS[$RANDOM % ${#REACTIONS[@]}]}
        curl -s -X POST $SERVER_URL/events -H "Content-Type: application/json" \
          -d "{\"userId\": \"sim$index\", \"userName\": \"Sim\", \"category\": \"reaction\", \"value\": \"$RANDOM_REACTION\"}" > /dev/null
      fi

      if [ $((RANDOM % 2)) -eq 0 ]; then
        RANDOM_COLOR=${COLORS[$RANDOM % ${#COLORS[@]}]}
        curl -s -X POST $SERVER_URL/events -H "Content-Type: application/json" \
          -d "{\"userId\": \"sim$index\", \"userName\": \"Sim\", \"category\": \"color\", \"value\": \"$RANDOM_COLOR\"}" > /dev/null
      fi

      if [ $((RANDOM % 2)) -eq 0 ]; then
        RANDOM_MOOD=${MOODS[$RANDOM % ${#MOODS[@]}]}
        curl -s -X POST $SERVER_URL/events -H "Content-Type: application/json" \
          -d "{\"userId\": \"sim$index\", \"userName\": \"Sim\", \"category\": \"mood\", \"value\": \"$RANDOM_MOOD\"}" > /dev/null
      fi

      # Print progress every 30 seconds
      if [ $((i % 30)) -eq 0 ]; then
         echo "      ... $i seconds elapsed ..."
      fi

      sleep 1
    done

    echo "   Ending Track $index"
    curl -s -X POST $SERVER_URL/track/end > /dev/null
    sleep 2

    # Send random words
    local rnd_words=$(generate_random_words 15)
    echo "   Sending Words for Track $index: $rnd_words"
    curl -s -X POST $SERVER_URL/events -H "Content-Type: application/json" \
      -d "{\"userId\": \"sim$index\", \"category\": \"note\", \"value\": \"$rnd_words\"}" > /dev/null
    sleep 4
}

run_track 1 "trk-1" "The Upbeat Opener"
run_track 2 "trk-2" "The Slow Ballad"
run_track 3 "trk-3" "The Chaotic Finale"

echo "=== 3 Track Simulation Complete ==="
