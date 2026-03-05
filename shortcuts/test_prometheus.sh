#!/bin/bash

# Fetch current prometheus metrics and filter only for the concert specific ones
echo "Fetching /metrics from Local Node server..."
echo "----------------------------------------"

curl -s http://localhost:8000/metrics | grep ^concert_

echo "----------------------------------------"
echo "Done."
