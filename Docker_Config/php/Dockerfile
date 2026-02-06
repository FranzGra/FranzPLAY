FROM php:8.2-fpm-alpine
RUN docker-php-ext-install mysqli pdo pdo_mysql

# Custom PHP Config
COPY uploads.ini /usr/local/etc/php/conf.d/uploads.ini

# Install Redis Extension
RUN apk add --no-cache pcre-dev $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del pcre-dev $PHPIZE_DEPS
# Imposta permessi per la cartella sessioni/immagini
RUN mkdir -p /var/www/api/sessioni/immagini_utenti && \
    chown -R www-data:www-data /var/www/api