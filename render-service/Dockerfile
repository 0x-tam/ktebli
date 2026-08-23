# Ktebli render-validation service: LibreOffice + poppler + a tiny Node server.
# Deploy anywhere that runs a container (Fly.io, Google Cloud Run, Railway).
# Set RENDER_SECRET, then store the URL + secret in Supabase Vault as
# render_service_url / render_service_secret.
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer poppler-utils \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
