FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HERMES_HOME=/tmp/kairo-hermes \
    HOME=/tmp/kairo-service

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY services/hermes-runtime/pyproject.toml ./pyproject.toml
COPY services/hermes-runtime/hermes_runtime ./hermes_runtime
RUN pip install --no-cache-dir .

RUN useradd --create-home --home-dir /home/kairo --shell /usr/sbin/nologin kairo \
    && mkdir -p /tmp/kairo-hermes /tmp/kairo-service \
    && chown -R kairo:kairo /tmp/kairo-hermes /tmp/kairo-service /app

USER kairo
EXPOSE 8080

CMD ["uvicorn", "hermes_runtime.app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
