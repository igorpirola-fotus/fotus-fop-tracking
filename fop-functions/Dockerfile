FROM denoland/deno:2.1.4

WORKDIR /app
COPY . .

# Pré-cacheia dependências (postgres driver) na imagem
RUN deno cache server.ts

# Deno.serve escuta na 8000 por padrão
EXPOSE 8000

# --allow-net: Postgres (fop-db) + Meta/GA4/BrasilAPI ; --allow-env: DATABASE_URL e secrets
CMD ["run", "--allow-net", "--allow-env", "server.ts"]
