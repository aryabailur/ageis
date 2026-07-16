FROM node:20-slim AS build
WORKDIR /srv/services/dashboard
COPY services/dashboard/package.json services/dashboard/package-lock.json* ./
RUN npm install
COPY services/dashboard ./
ARG VITE_ORCHESTRATOR_URL=http://localhost:8000
ENV VITE_ORCHESTRATOR_URL=$VITE_ORCHESTRATOR_URL
RUN npm run build

FROM node:20-slim
WORKDIR /srv
RUN npm install -g serve
COPY --from=build /srv/services/dashboard/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
