FROM cloakhq/cloakbrowser:latest

# cloakhq/cloakbrowser is Debian 13 (trixie) with:
#   - Patched stealth Chromium (58 C++ source-level fingerprint patches)
#   - cloakserve CDP multiplexer (/usr/local/bin/cloakserve)
#   - Xvfb already installed (/usr/bin/Xvfb)
#   - Python 3.12

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    SCREEN_DEPTH=24

RUN apt-get update && apt-get install -y --no-install-recommends \
      x11vnc \
      novnc \
      websockify \
      supervisor \
      dumb-init \
      socat \
      curl \
      fonts-noto-cjk \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /tmp/cloakserve

COPY entrypoint.sh /entrypoint.sh
COPY supervisord.conf /etc/supervisor/conf.d/chromium.conf
RUN chmod +x /entrypoint.sh

EXPOSE 9222 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]
