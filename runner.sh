#!/bin/sh
set -e

while true; do
  echo "[$(date)] pharma-normalizer runner start"
  npm start || echo "[$(date)] pharma-normalizer runner failed"
  echo "[$(date)] sleeping 300s"
  sleep 300
done

