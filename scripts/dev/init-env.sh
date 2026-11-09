#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ENV_FILE="${1:-.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_EXAMPLE_FILE="${ROOT_DIR}/.env.example"

replace_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    return
  fi
  # Appended keys stay on consecutive lines: the leading "\n" this used to print
  # is what turned every generated .env into a double-spaced list. Guarantee the
  # trailing newline instead, which is the case that "\n" was really guarding.
  if [ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ]; then
    printf "\n" >> "$ENV_FILE"
  fi
  printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
}

ensure_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=.\+" "$ENV_FILE"; then
    return
  fi
  printf "${YELLOW}Adding missing %s to %s...${NC}\n" "$key" "$ENV_FILE"
  replace_env "$key" "$value"
}

migrate_env() {
  local old_key="$1"
  local new_key="$2"
  if ! grep -q "^${old_key}=" "$ENV_FILE"; then
    return
  fi
  if ! grep -q "^${new_key}=.\+" "$ENV_FILE"; then
    local value
    value="$(grep "^${old_key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
    printf "${YELLOW}Renaming %s to %s in %s...${NC}\n" "$old_key" "$new_key" "$ENV_FILE"
    replace_env "$new_key" "$value"
  fi
  sed -i.bak "/^${old_key}=/d" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
}

normalize_existing_env() {
  if grep -q '^NODE_ENV=dev$' "$ENV_FILE"; then
    printf "${YELLOW}Replacing NODE_ENV=dev with NODE_ENV=development in %s...${NC}\n" "$ENV_FILE"
    replace_env "NODE_ENV" "development"
  fi

  migrate_env "LOG_FORMAT" "APP_LOG_FORMAT"
  migrate_env "LOG_LEVEL" "APP_LOG_LEVEL"
  migrate_env "SERVICE_NAME" "APP_SERVICE_NAME"

  ensure_env "NODE_ENV" "development"
  ensure_env "APP_LOG_FORMAT" "pretty"
  ensure_env "APP_LOG_LEVEL" "info"
  ensure_env "APP_SERVICE_NAME" "kairosflow"
  ensure_env "AUTH_SECRET" "$(openssl rand -hex 32)"
  ensure_env "APP_USER_EMAIL" "admin@admin.com"
  ensure_env "APP_USER_PASSWORD" "admin"
  # PLATFORM BILLING (Phase 2) — provider/model + billing knobs used to price the
  # platform-key token meter. No API key by default: billing DISPLAY only needs
  # the provider/model; actually running an org in platform mode needs a real
  # PLATFORM_AI_API_KEY added by hand.
  ensure_env "PLATFORM_AI_PROVIDER" "claude"
  ensure_env "PLATFORM_AI_MODEL" "claude-sonnet-4-6"
  # Optional second provider, tried only when the primary rejects a call. Left
  # empty (the default) there is no fallback and the primary's error stands.
  ensure_env "PLATFORM_AI_FALLBACK_PROVIDER" ""
  ensure_env "PLATFORM_AI_FALLBACK_MODEL" ""
  ensure_env "PLATFORM_AI_FALLBACK_API_KEY" ""
  ensure_env "PLATFORM_AI_MARGIN" "1.3"
  ensure_env "PLATFORM_AI_USD_BRL" "5.2"
  ensure_env "APP_AZURE_STORAGE_CONNECTION_STRING" "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://azurite-custeio:10000/devstoreaccount1;"
}

if [ -f "$ENV_FILE" ]; then
  normalize_existing_env
  exit 0
fi

if [ ! -f "$ENV_EXAMPLE_FILE" ]; then
  printf "${YELLOW}.env.example not found at %s${NC}\n" "$ENV_EXAMPLE_FILE"
  exit 1
fi

printf "${YELLOW}No %s found — generating a local default...${NC}\n" "$ENV_FILE"

AUTH_SECRET_GENERATED=$(openssl rand -hex 32)
TOKEN_PEPPER_GENERATED=$(openssl rand -hex 32)

cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"

replace_env "AUTH_SECRET" "$AUTH_SECRET_GENERATED"
replace_env "APP_TOKEN_PEPPER" "$TOKEN_PEPPER_GENERATED"
replace_env "APP_USER_EMAIL" "admin@admin.com"
replace_env "APP_USER_PASSWORD" "admin"

printf "${GREEN}Generated %s${NC}\n" "$ENV_FILE"
printf "${GREEN}APP_AZURE_STORAGE_CONNECTION_STRING points to local Azurite.${NC}\n"
