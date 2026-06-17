FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/
# Trained model + exploration JSONs (created by the training/exploration scripts).
# Copied if present so the cancellation predictor can load at startup.
COPY artifacts/ ./artifacts/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
