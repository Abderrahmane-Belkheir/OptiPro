#!/bin/sh
# Applies committed migrations (app/prisma/migrations/) to the database at DATABASE_URL.
#
# Uses `prisma migrate deploy`, not `migrate dev` — deploy only replays existing migration
# files and never generates new ones or prompts interactively, which is what you want on a
# server. Run this once per deploy, before (re)starting the backend, whenever
# app/prisma/migrations/ has changed since the last deploy.
#
# Usage (DATABASE_URL set in the environment):
#   sh migrate.sh

set -e
cd "$(dirname "$0")/app"
npx prisma migrate deploy
