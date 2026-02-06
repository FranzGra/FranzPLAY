FROM nginx:alpine
# Rimuove la config di default
RUN rm /etc/nginx/conf.d/default.conf
# La config personalizzata viene montata o copiata, 
# ma qui usiamo il mount nel docker-compose, quindi questo basta.
COPY default.conf /etc/nginx/conf.d/