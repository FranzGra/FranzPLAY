# Everyday commands. Run "make help" to list them.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: help run build test lint fmt check

help: ## Show this list
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

run: ## Start FranzPLAY on http://localhost:8090
	go run ./cmd/franzplay

build: ## Build the program into bin/franzplay
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/franzplay ./cmd/franzplay

test: ## Run all tests, with the race detector
	go test -race ./...

lint: ## Look for common mistakes
	golangci-lint run ./...

fmt: ## Format all code
	golangci-lint fmt ./...

check: lint test ## Everything CI checks, before you push
