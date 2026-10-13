# Everyday commands. Run "make help" to list them.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: help run build test lint fmt check web web-dev web-check e2e

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

run: ## Start FranzPLAY on http://localhost:8090
	go run ./cmd/franzplay

build: web ## Build the program, with the interface inside, into bin/franzplay
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/franzplay ./cmd/franzplay

test: ## Run all tests, with the race detector
	go test -race ./...

lint: ## Look for common mistakes
	golangci-lint run ./...

fmt: ## Format all code
	golangci-lint fmt ./...

web: ## Build the web interface (needs Node.js)
	cd web && npm ci && npm run build

web-dev: ## Start the interface in development mode on http://localhost:5173 (run "make run" too)
	cd web && npm run dev

web-check: ## Lint, type-check and test the web interface
	cd web && npm ci && npm run check

e2e: build ## Open every page and play a video in a real browser (needs ffmpeg)
	cd e2e && npm ci && npx playwright install chromium && npm run check && npx playwright test

check: lint test web-check e2e ## Everything CI checks, before you push
