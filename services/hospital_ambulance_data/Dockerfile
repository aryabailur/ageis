FROM python:3.11-slim
WORKDIR /srv
COPY shared/aegis_contracts /srv/shared/aegis_contracts
COPY services/hospital_ambulance_data /srv/services/hospital_ambulance_data
WORKDIR /srv/services/hospital_ambulance_data
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=8001
EXPOSE 8001
CMD ["python", "-m", "app.server"]
