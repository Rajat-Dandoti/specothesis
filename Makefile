.PHONY: install setup build clean

install:
	npm install
	npx playwright install chromium

setup: install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example — set SCANNER_BASE_URL before running"; fi
	python3 -m venv .venv
	.venv/bin/pip install --quiet schemathesis
	npm install -g stepci

build:
	npm run build

clean:
	rm -rf dist/ .venv
