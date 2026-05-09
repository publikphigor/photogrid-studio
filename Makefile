SHELL := /bin/bash
PROJECT := photogrid-studio
# Explicit -f and unset COMPOSE_FILE so a global override (e.g. an auto-dev
# compose file from another tool) doesn't shadow this project's compose files.
COMPOSE := COMPOSE_FILE= docker compose -f docker-compose.yml
COMPOSE_PROD := COMPOSE_FILE= docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help up build rebuild restart down logs clean prod-up prod-down test install-aliases env

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

up: env ## Start stack in background
	$(COMPOSE) up -d
	@PORT=$$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | head -1 | cut -d= -f2); echo "→ frontend: http://localhost:$${PORT:-8080}"

build: env ## Build images (--pull)
	$(COMPOSE) build --pull

rebuild: build ## Build then recreate (so containers pick up the new image)
	$(COMPOSE) up -d
	@PORT=$$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | head -1 | cut -d= -f2); echo "→ frontend: http://localhost:$${PORT:-8080}"

restart: ## Recreate running services with the latest built image
	$(COMPOSE) up -d --force-recreate

down: ## Stop stack
	$(COMPOSE) down

logs: ## Follow logs
	$(COMPOSE) logs -f --tail=100

clean: ## Stop and drop the image cache volume
	$(COMPOSE) down -v

prod-up: env ## Start with prod overrides
	$(COMPOSE_PROD) up -d --build

prod-down: ## Stop prod stack
	$(COMPOSE_PROD) down

test: ## Run backend (pytest) + frontend (vitest) tests
	$(COMPOSE) run --rm backend pytest
	$(COMPOSE) run --rm frontend npm run test -- --run

install-aliases: ## Install fish shell functions
	@./scripts/fish/install.fish
