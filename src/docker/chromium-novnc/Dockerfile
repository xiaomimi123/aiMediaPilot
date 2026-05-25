FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    SCREEN_DEPTH=24

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb \
      x11vnc \
      supervisor \
      novnc \
      websockify \
      ca-certificates \
      fonts-noto-cjk \
      dumb-init \
      curl \
    && rm -rf /var/lib/apt/lists/*

RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
RUN mkdir -p /profiles

COPY entrypoint.sh /entrypoint.sh
COPY supervisord.conf /etc/supervisor/conf.d/chromium.conf
RUN chmod +x /entrypoint.sh

EXPOSE 9222 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]
