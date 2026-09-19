#!/bin/sh
# Usage: docker-entrypoint.sh [web|worker|migrate|seed]
set -e
case "${1:-web}" in
  web)     exec pnpm --filter @aigtm/web start ;;
  worker)  exec pnpm --filter @aigtm/agent-runtime worker ;;
  migrate) exec pnpm --filter @aigtm/db migrate ;;
  seed)    exec pnpm --filter @aigtm/db seed ;;
  sync)    exec pnpm --filter @aigtm/agent-runtime sync-specs ;;
  connectors) exec pnpm --filter @aigtm/connectors sync ;;
  *)       exec "$@" ;;
esac
