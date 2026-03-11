#!/bin/bash

echo "Stopping Node.js server for Concert Companion..."
pkill -f "node server.js" || echo "Server is not running."
echo "Done."
