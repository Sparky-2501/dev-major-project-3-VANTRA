#!/usr/bin/env bash
# Creates the Kubernetes Secret from your local .env (so secrets are never in git).
# Usage: bash k8s/create-secret.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found. Run: node scripts/make-env.js"; exit 1; }
set -a; . ./.env; set +a
kubectl create namespace vantra --dry-run=client -o yaml | kubectl apply -f -
kubectl -n vantra create secret generic vantra-secrets \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=INTERNAL_API_KEY="$INTERNAL_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
echo "secret vantra-secrets applied"
