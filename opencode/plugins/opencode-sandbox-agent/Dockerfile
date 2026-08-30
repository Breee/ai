FROM ubuntu:24.04 AS base

ARG SPIRE_VERSION=1.15.2
ARG NONO_VERSION=0.74.0
ARG OPENCODE_VERSION=1.18.23

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git jq \
    && rm -rf /var/lib/apt/lists/*

# Install SPIRE agent
RUN curl -s -N -L "https://github.com/spiffe/spire/releases/download/v${SPIRE_VERSION}/spire-${SPIRE_VERSION}-linux-amd64-musl.tar.gz" \
    | tar xz -C /opt \
    && mv /opt/spire-${SPIRE_VERSION} /opt/spire \
    && ln -s /opt/spire/bin/spire-agent /usr/local/bin/spire-agent

# Install nono (install script has v-prefix bug, download directly)
ARG NONO_VERSION=0.74.0
RUN curl -sL "https://github.com/nolabs-ai/nono/releases/download/v${NONO_VERSION}/nono-v${NONO_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    | tar xz -C /usr/local/bin nono

# Install opencode (download binary directly, install script hangs in Docker)
ARG OPENCODE_VERSION=1.18.23
RUN curl -sL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" \
    | tar xz -C /usr/local/bin opencode

# Copy agent entrypoint + SPIRE agent config
COPY agent-entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY spire-agent.conf /etc/spire/agent.conf
RUN chmod +x /usr/local/bin/agent-entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]
