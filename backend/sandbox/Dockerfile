# Base image for the agent sandbox.
# Build:  docker build -t agent-arena-sandbox:latest backend/sandbox
# The backend builds it automatically on the first agent run if it is missing.
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      coreutils \
      curl \
      git \
      jq \
      nodejs \
      npm \
      ripgrep \
      tree \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# The agent never runs as root.
RUN useradd --create-home --uid 1000 agent \
    && mkdir -p /workspace \
    && chown agent:agent /workspace

USER agent
WORKDIR /workspace

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/agent

CMD ["sleep", "infinity"]
