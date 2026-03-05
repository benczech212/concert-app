#!/bin/bash

# Navigate to the root of the project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Start the Node.js server
echo "Starting Concert Companion App Server..."
npm start
