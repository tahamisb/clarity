FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sim ./sim

# Business logic is Qatar-local, storage is UTC. Pin the container to UTC so
# nothing accidentally depends on the host's timezone.
ENV TZ=UTC PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "-m", "sim"]
CMD ["status"]
