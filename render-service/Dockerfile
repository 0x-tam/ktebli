# Ktebli render-validation service: LibreOffice + poppler + a tiny Node server.
# Deploy anywhere that runs a container (Fly.io, Google Cloud Run, Railway).
# Set RENDER_SECRET, then store the URL + secret in Supabase Vault as
# render_service_url / render_service_secret.
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer poppler-utils python3 python3-venv \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/pdf-env \
    && /opt/pdf-env/bin/pip install --no-cache-dir pypdf==6.6.2
ENV PATH="/opt/pdf-env/bin:${PATH}"
WORKDIR /app
COPY server.mjs extract_pdf.py slice_pdf.py ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
