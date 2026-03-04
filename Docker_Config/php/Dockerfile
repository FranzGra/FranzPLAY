FROM php:8.2-fpm-alpine
RUN docker-php-ext-install mysqli pdo pdo_mysql

# Custom PHP Config
COPY uploads.ini /usr/local/etc/php/conf.d/uploads.ini

# Install Redis Extension
RUN apk add --no-cache pcre-dev $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del pcre-dev $PHPIZE_DEPS
# Copia lo script di avvio per i permessi volume
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN apk add --no-cache dos2unix \
    && dos2unix /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

# Imposta permessi per la cartella api (Codice sorgente montato)
RUN mkdir -p /var/www/api/sessioni/immagini_utenti && \
    chown -R www-data:www-data /var/www/api

# Forza l'esecuzione dello script prima dell'avvio reale
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["php-fpm"]