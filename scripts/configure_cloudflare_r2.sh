#!/usr/bin/env bash
# Guide + write R2 env vars into desktop_web_host.env
# Usage: bash scripts/configure_cloudflare_r2.sh
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/biotech/config/profiles/desktop_web_host.env}"

echo "=== Cloudflare R2 setup for SuperNova ==="
echo "1) Cloudflare Dashboard → R2 → Create bucket (es. supernova-snapshots)"
echo "2) R2 → Manage R2 API Tokens → Create API token (Object Read & Write)"
echo "3) Enable public access OR custom domain on the bucket (es. cdn.supernovalpha.com)"
echo ""
read -r -p "R2 Account ID (from R2 overview): " ACCOUNT_ID
read -r -p "Bucket name [supernova-snapshots]: " BUCKET
BUCKET="${BUCKET:-supernova-snapshots}"
read -r -p "Access Key ID: " ACCESS
read -r -p "Secret Access Key: " SECRET
read -r -p "Public CDN base URL (es. https://pub-xxx.r2.dev/o or https://cdn.supernovalpha.com/o): " BASE

ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"

# Strip old lines
sed -i '/^SUPERNOVA_CDN_S3_/d' "$ENV_FILE" 2>/dev/null || true
sed -i '/^SUPERNOVA_CDN_BASE_URL=/d' "$ENV_FILE" 2>/dev/null || true

{
  echo ""
  echo "# Cloudflare R2 CDN"
  echo "SUPERNOVA_CDN_S3_ENDPOINT=${ENDPOINT}"
  echo "SUPERNOVA_CDN_S3_BUCKET=${BUCKET}"
  echo "SUPERNOVA_CDN_S3_ACCESS_KEY=${ACCESS}"
  echo "SUPERNOVA_CDN_S3_SECRET_KEY=${SECRET}"
  echo "SUPERNOVA_CDN_S3_PREFIX=o/"
  echo "SUPERNOVA_CDN_BASE_URL=${BASE%/}/"
} >> "$ENV_FILE"

echo "Wrote R2 settings to ${ENV_FILE}"
echo "Publishing now..."
cd /opt/biotech
set -a
# shellcheck disable=SC1090
# load only CDN lines safely
export SUPERNOVA_CDN_S3_ENDPOINT="$ENDPOINT"
export SUPERNOVA_CDN_S3_BUCKET="$BUCKET"
export SUPERNOVA_CDN_S3_ACCESS_KEY="$ACCESS"
export SUPERNOVA_CDN_S3_SECRET_KEY="$SECRET"
export SUPERNOVA_CDN_S3_PREFIX=o/
export SUPERNOVA_CDN_BASE_URL="${BASE%/}/"
set +a
/opt/biotech/.venv/bin/python /opt/biotech/scripts/cdn_publish_after_refresh.py
echo "Done. Restart: systemctl restart supernova-web"
echo "Then set Page Rule or Cache Rule for your CDN hostname if using a custom domain."
