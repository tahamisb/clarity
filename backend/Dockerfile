FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/
# Exploration JSONs + (optionally) a trained model, loaded at startup if present.
COPY artifacts/ ./artifacts/

# Build the local SQLite warehouse the whole API reads from. The generator is
# seeded, so every image gets byte-identical data.
RUN python scripts/generate_mock_db.py

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
