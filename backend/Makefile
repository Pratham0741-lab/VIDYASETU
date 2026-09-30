# VIDYASETU developer commands. Run `make help` for the list.
# Docker targets need Docker Engine + Compose v2. test/lint/format/openapi run
# locally and need Node.js 22 and Python 3.12 (see `make install`).

COMPOSE := docker compose

# Python 3.11 = the production ml image (python:3.11-slim).
ifeq ($(OS),Windows_NT)
  PY       := py -3.11
  VENV_BIN := .venv/Scripts
else
  PY       := python3.11
  VENV_BIN := .venv/bin
endif

.DEFAULT_GOAL := help

.PHONY: help install install-api install-ml up down logs ps build migrate \
        test test-api test-ml lint lint-api lint-ml format format-api format-ml openapi

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

.env:
	cp .env.example .env
	@echo "Created .env from .env.example (local defaults)."

install: install-api install-ml ## Install api (npm ci) and ml (venv) dev dependencies

install-api:
	cd api && npm ci

install-ml:
	cd ml && $(PY) -m venv .venv && $(VENV_BIN)/python -m pip install --constraint constraints.txt -e ".[dev]"

up: .env ## Build images and start the whole stack in the background
	$(COMPOSE) up -d --build

down: ## Stop the stack (named volumes are kept)
	$(COMPOSE) down

logs: ## Follow logs (all services, or one: make logs s=api)
	$(COMPOSE) logs -f --tail=200 $(s)

ps: ## Show service status and health
	$(COMPOSE) ps

build: .env ## Build the api and ml images
	$(COMPOSE) build

migrate: .env ## Apply Prisma migrations and seed data (one-shot container)
	$(COMPOSE) run --rm db-migrate

test: test-api test-ml ## Run all tests (api unit + e2e, ml pytest)

test-api:
	cd api && npm test && npm run test:e2e

test-ml: ## ml pytest in a container built on the production image, network disabled
	$(COMPOSE) build ml
	docker build -f ml/Dockerfile.test -t vidyasetu-ml-test:local ml
	docker run --rm --network none vidyasetu-ml-test:local

test-ml-venv: ## ml pytest in a local venv (needs Tesseract on the host; see make install-ml)
	cd ml && $(VENV_BIN)/python -m pytest

lint: lint-api lint-ml ## Lint, format-check and type-check both services

lint-api:
	cd api && npm run lint && npm run format:check && npm run typecheck

lint-ml:
	cd ml && $(VENV_BIN)/ruff check . && $(VENV_BIN)/ruff format --check .

format: format-api format-ml ## Auto-format and auto-fix both services

format-api:
	cd api && npm run format && npm run lint:fix

format-ml:
	cd ml && $(VENV_BIN)/ruff format . && $(VENV_BIN)/ruff check --fix .

openapi: ## Export api/openapi.json (no server started, no dependencies needed)
	cd api && npm run openapi
