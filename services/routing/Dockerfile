FROM python:3.11-slim
WORKDIR /srv
COPY shared/aegis_contracts /srv/shared/aegis_contracts
COPY services/routing /srv/services/routing
WORKDIR /srv/services/routing
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=8002
EXPOSE 8002
CMD ["python", "-m", "app.server"]
