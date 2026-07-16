FROM python:3.11-slim
WORKDIR /srv
COPY shared/aegis_contracts /srv/shared/aegis_contracts
COPY services.yaml /srv/services.yaml
COPY services/core_orchestrator /srv/services/core_orchestrator
WORKDIR /srv/services/core_orchestrator
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=8000
EXPOSE 8000
CMD ["python", "-m", "app.main"]
