FROM python:3.11-slim
WORKDIR /srv
COPY shared/aegis_contracts /srv/shared/aegis_contracts
COPY services/_template_new_service /srv/services/_template_new_service
WORKDIR /srv/services/_template_new_service
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=8099
EXPOSE 8099
CMD ["python", "-m", "app.server"]
